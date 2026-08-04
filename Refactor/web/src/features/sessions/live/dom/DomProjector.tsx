import { useEffect, useRef } from 'react'
import type { DomDiff, DomProjectionInput, ResizeSessionResult } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import { w7sPath } from '@/lib/w7s'
import {
  CanvasViewportSync,
  measureCanvasElement,
  viewportSizesClose,
  type CanvasSize,
} from '../CanvasViewportSync'
import { DomDiffApplier } from './DomDiffApplier'
import { attachDomElementInput } from './DomElementInput'

export interface DomProjectorProps {
  width: number
  height: number
  live: boolean
  sessionId: string
  token: string
  /** API origin for Dom asset proxy (empty = same origin). */
  assetBaseUrl?: string
  attachDomDiffSink: (sink: (diff: DomDiff) => void) => () => void
  onDomInput: (input: DomProjectionInput) => void
  requestRemoteResize?: (
    size: CanvasSize,
    device: import('@/lib/speculum').SessionDeviceProfile,
  ) => Promise<ResizeSessionResult>
  viewportPolicy?: import('@/features/motor/live/deviceProfile').SessionViewportBounds
  onCanvasLayout?: (size: CanvasSize) => void
  onRemoteViewportApplied?: (size: CanvasSize) => void
  presentation?: 'immersive' | 'lab'
  className?: string
  label?: string
}

/**
 * Dom Projection surface — paints real DOM from DomDiff stream in the same
 * CSS viewport box as the video canvas host.
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
  const syncRef = useRef<CanvasViewportSync | null>(null)
  const onDomInputRef = useRef(onDomInput)
  onDomInputRef.current = onDomInput
  const requestRemoteResizeRef = useRef(requestRemoteResize)
  requestRemoteResizeRef.current = requestRemoteResize
  const onCanvasLayoutRef = useRef(onCanvasLayout)
  onCanvasLayoutRef.current = onCanvasLayout
  const onRemoteViewportAppliedRef = useRef(onRemoteViewportApplied)
  onRemoteViewportAppliedRef.current = onRemoteViewportApplied

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const resolveAsset = (hash: string) => {
      if (!hash || !sessionId || !token) return null
      const base = assetBaseUrl.replace(/\/$/, '')
      const path = w7sPath(
        `/api/sessions/${sessionId}/dom-assets/${encodeURIComponent(hash)}`,
      )
      return `${base}${path}?token=${encodeURIComponent(token)}`
    }
    const applier = new DomDiffApplier(surface, resolveAsset, () => {
      void Promise.resolve(
        onDomInputRef.current({ type: 'resync', targetId: 0, payload: '{}' }),
      ).catch(() => {})
    })
    applierRef.current = applier
    return () => {
      applier.reset()
      applierRef.current = null
    }
  }, [assetBaseUrl, sessionId, token])

  useEffect(() => {
    return attachDomDiffSink((diff) => {
      applierRef.current?.enqueue(diff)
    })
  }, [attachDomDiffSink])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !live) return
    return attachDomElementInput(surface, (input) => onDomInputRef.current(input))
  }, [live])

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

  useEffect(() => {
    const host = hostRef.current
    const request = requestRemoteResizeRef.current
    if (!host || !live || !request || !viewportPolicy) {
      syncRef.current?.dispose()
      syncRef.current = null
      return
    }

    const sync = new CanvasViewportSync({
      measure: () => measureCanvasElement(host),
      resize: (size, device) => request(size, device),
      viewportPolicy,
      onApplied: (size) => {
        onRemoteViewportAppliedRef.current?.(size)
      },
    })
    const layout = measureCanvasElement(host)
    sync.seedRemote(width, height)
    sync.observe(host)
    if (
      layout.width >= viewportPolicy.minWidth &&
      layout.height >= viewportPolicy.minHeight &&
      !viewportSizesClose(layout.width, layout.height, width, height)
    ) {
      sync.schedule(layout.width, layout.height)
    }
    syncRef.current = sync
    return () => {
      sync.dispose()
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [live, viewportPolicy, width, height])

  return (
    <div
      ref={hostRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-white',
        presentation === 'lab' && !live ? 'opacity-80' : null,
        className,
      )}
      aria-label={label}
    >
      <div
        ref={surfaceRef}
        // transform creates a containing block so remote position:fixed
        // modals/headers stay inside the projection surface (not the Speculum viewport).
        className="absolute inset-0 overflow-auto [transform:translateZ(0)]"
        data-speculum-dom-surface=""
      />
    </div>
  )
}
