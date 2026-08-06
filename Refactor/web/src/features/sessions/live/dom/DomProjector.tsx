import { useEffect, useRef } from 'react'
import type { DomDiff, DomProjectionInput, ResizeSessionResult } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import { measureCanvasElement, type CanvasSize } from '../CanvasViewportSync'
import { appendSessionAuth } from '@/lib/speculum/sessionBindingAuth'
import { DomDiffApplier } from './DomDiffApplier'
import { attachDomElementInput } from './DomElementInput'
import { useMeasureHostSync } from '../useMeasureHostSync'
import type { SessionViewportBounds } from '../sessionViewportPolicy'

export interface DomProjectorProps {
  width: number
  height: number
  live: boolean
  /** Null until Start returns — host still mounts for pre-Start measure. */
  sessionId: string | null
  /** Null until Start returns — assets/input arm only when present. */
  token: string | null
  /** API origin for Dom asset proxy (empty = same origin). */
  assetBaseUrl?: string
  attachDomDiffSink: (sink: (diff: DomDiff) => void) => () => void
  onDomInput: (input: DomProjectionInput) => void
  /** Opt-in apply/drop hops for front observation ring. */
  onDiffObserve?: (event: {
    kind: string
    hop: 'client_apply' | 'client_drop'
    reason?: 'sequence_gap' | 'generation_mismatch'
    generation?: number | null
    sequence?: number | null
    expectedSequence?: number | null
    remount?: boolean
    dropped?: boolean
    timestamp?: number | null
    tClient?: number
    lagMs?: number | null
    level?: 'info' | 'wire' | 'warn' | 'error'
    target?: string | null
  }) => void
  requestRemoteResize?: (
    size: CanvasSize,
    device: import('@/lib/speculum').SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  viewportPolicy?: SessionViewportBounds
  onCanvasLayout?: (size: CanvasSize) => void
  onRemoteViewportApplied?: (size: CanvasSize) => void
  presentation?: 'immersive' | 'lab'
  className?: string
  label?: string
}

/**
 * Dom Projection surface — paints real DOM from DomDiff stream.
 * Host mounts before Start (layout-only); token arms apply/input after Start.
 */
export function DomProjector({
  width,
  height,
  live,
  sessionId,
  token,
  assetBaseUrl = '',
  attachDomDiffSink,
  onDomInput,
  onDiffObserve,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
  presentation = 'lab',
  className,
  label = 'Page',
}: DomProjectorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const applierRef = useRef<DomDiffApplier | null>(null)
  const armedRef = useRef(false)
  const viewportRef = useRef({ width, height })
  viewportRef.current = { width, height }
  const onDomInputRef = useRef(onDomInput)
  onDomInputRef.current = onDomInput
  const onDiffObserveRef = useRef(onDiffObserve)
  onDiffObserveRef.current = onDiffObserve
  const onCanvasLayoutRef = useRef(onCanvasLayout)
  onCanvasLayoutRef.current = onCanvasLayout
  const onRemoteViewportAppliedRef = useRef(onRemoteViewportApplied)
  onRemoteViewportAppliedRef.current = onRemoteViewportApplied

  useMeasureHostSync({
    hostRef,
    live,
    requestRemoteResize,
    viewportPolicy,
    seedWidth: width,
    seedHeight: height,
    onApplied: (size) => {
      onRemoteViewportAppliedRef.current?.(size)
    },
  })

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !token) {
      applierRef.current?.reset()
      applierRef.current = null
      armedRef.current = false
      return
    }
    const appendAuth = (url: string) => appendSessionAuth(url, token, assetBaseUrl)
    armedRef.current = false
    const applier = new DomDiffApplier(
      surface,
      appendAuth,
      (expected, got) => {
        const tClient = performance.now()
        onDiffObserveRef.current?.({
          kind: 'diff',
          hop: 'client_drop',
          reason: 'sequence_gap',
          expectedSequence: expected,
          sequence: got,
          dropped: true,
          tClient,
          level: 'warn',
        })
        void Promise.resolve(
          onDomInputRef.current({ type: 'resync', payload: '{}' }),
        ).catch(() => {})
      },
      (generation) => {
        armedRef.current = true
        void generation
      },
      (diff) => {
        const tClient = performance.now()
        const timestamp = diff.timestamp != null ? Number(diff.timestamp) : null
        const lagMs =
          timestamp != null && Number.isFinite(timestamp) ? tClient - timestamp : null
        onDiffObserveRef.current?.({
          kind: String(diff.kind ?? 'unknown'),
          hop: 'client_apply',
          generation: diff.generation != null ? Number(diff.generation) : null,
          sequence: diff.sequence != null ? Number(diff.sequence) : null,
          timestamp,
          tClient,
          lagMs,
          remount: diff.kind === 'diff' && diff.target === 'document',
          target: diff.target != null ? String(diff.target) : null,
        })
      },
      (reason, diff) => {
        const tClient = performance.now()
        onDiffObserveRef.current?.({
          kind: String(diff.kind ?? 'diff'),
          hop: 'client_drop',
          reason,
          generation: diff.generation != null ? Number(diff.generation) : null,
          sequence: diff.sequence != null ? Number(diff.sequence) : null,
          dropped: true,
          tClient,
          level: 'warn',
          target: diff.target != null ? String(diff.target) : null,
        })
      },
    )
    applierRef.current = applier
    return () => {
      applier.reset()
      applierRef.current = null
      armedRef.current = false
    }
  }, [assetBaseUrl, sessionId, token])

  useEffect(() => {
    return attachDomDiffSink((diff) => {
      if (diff.kind === 'diff' && diff.target === 'document') armedRef.current = true
      applierRef.current?.enqueue(diff)
    })
  }, [attachDomDiffSink])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !live || !sessionId || !token) return
    return attachDomElementInput(
      surface,
      (input) => onDomInputRef.current(input),
      {
        sessionId,
        token,
        assetBaseUrl,
        getViewportSize: () => viewportRef.current,
        getGeneration: () => applierRef.current?.getGeneration() ?? 0,
        applier: applierRef.current,
        isArmed: () => armedRef.current,
      },
    )
  }, [live, sessionId, token, assetBaseUrl, width, height])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reportLayout = () => {
      onCanvasLayoutRef.current?.(measureCanvasElement(host))
    }
    reportLayout()
    const observer = new ResizeObserver(reportLayout)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      className={cn(
        // Host sizing comes from SESSION_MEASURE_HOST_CLASS via className.
        presentation === 'lab' && !live ? 'bg-muted/40 opacity-80' : null,
        presentation === 'immersive' && !live ? 'bg-neutral-100' : null,
        className,
      )}
      aria-label={label}
    >
      <div
        ref={surfaceRef}
        // transform creates a containing block so remote position:fixed
        // modals/headers stay inside the projection surface (not the Speculum viewport).
        // Body stand-in often sets overflow-x:hidden; keep X clipped so carousel
        // tracks don't expand the projection page. Y scrolls like a document.
        className="absolute inset-0 overflow-x-hidden overflow-y-auto [transform:translateZ(0)]"
        data-speculum-dom-surface=""
      />
    </div>
  )
}
