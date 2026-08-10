import { useEffect, useRef } from 'react'
import type {
  CssomSheet,
  DomNode,
  PageProjectionDiff,
  PageProjectionIntent,
  ResizeSessionResult,
  SessionNotification,
} from '@/lib/speculum'
import { NotificationKind } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import { measureCanvasElement, type CanvasSize } from '../CanvasViewportSync'
import { appendSessionAuth, appendSessionBindingQuery } from '@/lib/speculum/sessionBindingAuth'
import { PageProjectionDiffApplier, pageProjectionLagMs } from './PageProjectionDiffApplier'
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
  attachPageProjectionDiffSink: (sink: (diff: PageProjectionDiff) => void) => () => void
  /** Correctness: generation_bumped disarms until document/install (SoftNav ignored). */
  attachPageProjectionLifecycleSink?: (
    sink: (notification: SessionNotification) => void,
  ) => () => void
  onDomInput: (input: PageProjectionIntent) => void
  /** Optional override for OOB `PageProjection.Resync` after a desync (I2/T8). */
  onRequestResync?: () => void
  /** Opt-in apply/drop/desync/resync/arm hops for front observation ring. */
  onDiffObserve?: (event: {
    kind: string
    hop:
      | 'client_apply'
      | 'client_drop'
      | 'client_desync'
      | 'client_resync_request'
      | 'client_resync_apply'
      | 'client_arm'
      | 'client_disarm'
      | 'programmaticSuppress'
      | `cssom/${string}`
      | (string & {})
    reason?: string
    generation?: number | null
    sequence?: number | null
    expectedSequence?: number | null
    remount?: boolean
    seeded?: boolean
    sheetCount?: number
    ruleCount?: number
    dropped?: boolean
    armed?: boolean
    timestamp?: number | null
    tClient?: number
    lagMs?: number | null
    level?: 'info' | 'wire' | 'warn' | 'error'
    target?: string | null
    extra?: Record<string, unknown>
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
  /** Registers applier generation/seq/desync for syncUrl correlation (observe-only). */
  registerApplierProbe?: (
    probe: (() => { generation: number; lastSequence: number; desynced: boolean }) | null,
  ) => void
}

/**
 * Dom Projection surface — paints real DOM from PageProjectionDiff stream.
 * Host mounts before Start (layout-only); token arms apply/input after Start.
 */
export function DomProjector({
  width,
  height,
  live,
  sessionId,
  token,
  assetBaseUrl = '',
  attachPageProjectionDiffSink,
  attachPageProjectionLifecycleSink,
  onDomInput,
  onRequestResync,
  onDiffObserve,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
  presentation = 'lab',
  className,
  label = 'Page',
  registerApplierProbe,
}: DomProjectorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const applierRef = useRef<PageProjectionDiffApplier | null>(null)
  const armedRef = useRef(false)
  const viewportRef = useRef({ width, height })
  viewportRef.current = { width, height }
  const onDomInputRef = useRef(onDomInput)
  onDomInputRef.current = onDomInput
  const onRequestResyncRef = useRef(onRequestResync)
  onRequestResyncRef.current = onRequestResync
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
    /** Assigned before desync callbacks run; closures capture the binding. */
    let applier!: PageProjectionDiffApplier
    /** T8 singleflight — coalesce overlapping desync into one in-flight POST. */
    let resyncInFlight: Promise<void> | null = null
    let resyncAttempt = 0
    let lastResyncExpected = 0
    const runOobResync = async (expected: number) => {
      lastResyncExpected = expected
      if (!sessionId || !token) return
      const attempt = ++resyncAttempt
      const tReq = performance.now()
      onDiffObserveRef.current?.({
        kind: 'dom',
        hop: 'client_resync_request',
        generation: applier.getGeneration(),
        expectedSequence: expected,
        tClient: tReq,
        level: 'wire',
      })
      try {
        const gen = applier.getGeneration()
        const base = assetBaseUrl?.replace(/\/$/, '') || window.location.origin
        const url = appendSessionBindingQuery(
          new URL(`/w7s/api/sessions/${sessionId}/page-projection/resync`, base),
          sessionId,
          token,
        )
        url.searchParams.set('generation', String(gen))
        url.searchParams.set('sequence', String(Math.max(0, expected - 1)))
        const res = await fetch(url.toString(), { method: 'POST' })
        if (!res.ok) return
        // Stale response from a superseded attempt — drop.
        if (attempt !== resyncAttempt) return
        const body = (await res.json()) as {
          generation?: number
          coversThroughSequence?: number
          root?: DomNode
          sheets?: CssomSheet[]
        }
        if (!body.root || !Array.isArray(body.sheets)) return
        if (attempt !== resyncAttempt) return
        const sheets = body.sheets
        const snapGen = Number(body.generation ?? 0)
        const covers = Number(body.coversThroughSequence ?? 0)
        // Ignore older watermark than the applier already holds after a newer snap.
        if (snapGen < applier.getGeneration()) return
        let ruleCount = 0
        let seededSheetCount = 0
        for (const sheet of sheets) {
          const rules = sheet.rules ?? []
          ruleCount += rules.length
          if (rules.some((r) => String(r.id ?? '').startsWith('seed:'))) {
            seededSheetCount += 1
          }
        }
        applier.applyOobResync({
          generation: snapGen,
          coversThroughSequence: covers,
          root: body.root,
          sheets,
        })
        const tApply = performance.now()
        onDiffObserveRef.current?.({
          kind: 'cssom',
          hop: 'client_resync_apply',
          generation: snapGen,
          sequence: covers,
          sheetCount: sheets.length,
          ruleCount,
          seeded: seededSheetCount > 0,
          tClient: tApply,
          lagMs: tApply - tReq,
          extra: { seededSheetCount },
        })
        // D12: arm only when drain left us synced.
        if (!applier.isDesynced()) {
          armedRef.current = true
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_arm',
            reason: 'resync',
            armed: true,
            generation: snapGen,
            tClient: performance.now(),
          })
        } else {
          armedRef.current = false
        }
      } catch {
        /* stay disarmed */
      }
    }
    const requestOobResync = (expected: number) => {
      lastResyncExpected = expected
      if (resyncInFlight) {
        // Coalesce: after the in-flight attempt settles, retry once if still desynced.
        void resyncInFlight.finally(() => {
          if (!applier.isDesynced() || resyncInFlight) return
          window.setTimeout(() => {
            if (!applier.isDesynced() || resyncInFlight) return
            resyncInFlight = runOobResync(lastResyncExpected).finally(() => {
              resyncInFlight = null
            })
          }, 200)
        })
        return
      }
      resyncInFlight = runOobResync(expected).finally(() => {
        resyncInFlight = null
      })
    }
    applier = new PageProjectionDiffApplier(
      surface,
      appendAuth,
      ({ expected, got, reason, generation, phase, selector, matchCount, operation, plane }) => {
        const tClient = performance.now()
        // Desync: input stays disarmed until joint OOB Resync applies (C8/D12).
        if (armedRef.current) {
          armedRef.current = false
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_disarm',
            reason: 'desync',
            armed: false,
            generation: generation ?? applier.getGeneration(),
            tClient,
            level: 'warn',
          })
        }
        onDiffObserveRef.current?.({
          kind: plane ?? 'dom',
          hop: 'client_desync',
          reason,
          expectedSequence: expected,
          sequence: got,
          generation: generation ?? applier.getGeneration(),
          dropped: true,
          tClient,
          level: 'warn',
          target: operation ?? null,
          extra: {
            phase: phase ?? null,
            matchCount: matchCount ?? null,
            ...(selector
              ? {
                  selectorKind: selector.kind,
                  selectorQuery: selector.query,
                  selectorIndex: selector.index ?? null,
                }
              : {}),
          },
        })
        const requestResync = onRequestResyncRef.current
        if (requestResync) {
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_resync_request',
            reason: 'owner_override',
            generation: applier.getGeneration(),
            expectedSequence: expected,
            tClient,
            level: 'wire',
            extra: {
              hintGeneration: applier.getGeneration(),
              hintSequence: expected,
            },
          })
          requestResync()
          return
        }
        // Default OOB PageProjection.Resync (I2/T8) — never an input intent.
        onDiffObserveRef.current?.({
          kind: 'dom',
          hop: 'client_resync_request',
          reason: 'owner_override',
          generation: applier.getGeneration(),
          expectedSequence: expected,
          tClient,
          level: 'wire',
          extra: {
            hintGeneration: applier.getGeneration(),
            hintSequence: expected,
          },
        })
        requestOobResync(expected)
      },
      (generation) => {
        // Live document/install establish — only arm when not desynced.
        if (applier.isDesynced()) {
          armedRef.current = false
          return
        }
        armedRef.current = true
        onDiffObserveRef.current?.({
          kind: 'dom',
          hop: 'client_arm',
          reason: 'document_or_install',
          armed: true,
          generation,
          tClient: performance.now(),
        })
      },
      (diff) => {
        const tClient = performance.now()
        const timestamp = diff.timestamp != null ? Number(diff.timestamp) : null
        const lagMs = pageProjectionLagMs(timestamp)
        const plane = String(diff.plane ?? 'unknown')
        const operation = diff.operation != null ? String(diff.operation) : null
        const isCssom = plane === 'cssom'
        onDiffObserveRef.current?.({
          kind: isCssom && operation ? `cssom:${operation}` : plane,
          hop: isCssom && operation ? `cssom/${operation}` : 'client_apply',
          generation: diff.generation != null ? Number(diff.generation) : applier.getGeneration(),
          sequence: diff.sequence != null ? Number(diff.sequence) : null,
          timestamp,
          tClient,
          lagMs,
          remount: diff.plane === 'dom' && diff.operation === 'document',
          target: operation,
          // Raw sheets — observer gates + counts (near-zero when Diff plane off).
          extra: diff.install?.sheets?.length
            ? {
                installSheets: diff.install.sheets,
                sheetCount: diff.install.sheets.length,
                ruleCount: diff.install.sheets.reduce(
                  (n, s) => n + (s.rules?.length ?? 0),
                  0,
                ),
              }
            : undefined,
        })
      },
      (reason, diff, extra) => {
        const tClient = performance.now()
        onDiffObserveRef.current?.({
          kind: String(diff.plane ?? 'dom'),
          hop: 'client_drop',
          reason,
          generation: diff.generation != null ? Number(diff.generation) : null,
          sequence: diff.sequence != null ? Number(diff.sequence) : null,
          dropped: true,
          tClient,
          level: 'warn',
          target: diff.operation != null ? String(diff.operation) : null,
          extra,
        })
      },
    )
    applierRef.current = applier
    registerApplierProbe?.(() => ({
      generation: applier.getGeneration(),
      lastSequence: applier.getLastSequence(),
      desynced: applier.isDesynced(),
    }))
    return () => {
      applier.reset()
      applierRef.current = null
      armedRef.current = false
      registerApplierProbe?.(null)
    }
  }, [assetBaseUrl, sessionId, token, registerApplierProbe])

  useEffect(() => {
    return attachPageProjectionDiffSink((diff) => {
      const applier = applierRef.current
      if (!applier) {
        onDiffObserveRef.current?.({
          kind: 'dom',
          hop: 'client_drop',
          reason: 'client_applier_unready',
          sequence: diff.sequence != null ? Number(diff.sequence) : null,
          generation: diff.generation != null ? Number(diff.generation) : null,
          dropped: true,
          tClient: performance.now(),
          level: 'warn',
          extra: {
            reason: 'client_applier_unready',
            plane: diff.plane ?? null,
            operation: diff.operation ?? null,
          },
        })
        return
      }
      const wireGen = Number(diff.generation ?? 0)
      const localGen = applier.getGeneration()
      const establishes =
        (diff.plane === 'dom' && diff.operation === 'document')
        || (diff.plane === 'cssom' && diff.operation === 'install')
      // Disarm immediately when Virtual bumps ahead of Projected — do not stamp
      // stale generation on intents (CdpDropped generation_stale).
      if (wireGen > 0 && localGen > 0 && wireGen > localGen && !establishes) {
        if (armedRef.current) {
          armedRef.current = false
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_disarm',
            reason: 'wire_gen_ahead',
            armed: false,
            generation: wireGen,
            tClient: performance.now(),
            level: 'warn',
          })
        } else {
          armedRef.current = false
        }
      }
      // Arm only after document/install applies (onGeneration), never on enqueue.
      applier.enqueue(diff)
    })
  }, [attachPageProjectionDiffSink])

  useEffect(() => {
    if (!attachPageProjectionLifecycleSink) return
    return attachPageProjectionLifecycleSink((notification) => {
      if (notification.kind !== NotificationKind.PageProjectionLifecycle) return
      const phase = String(notification.phase ?? '')
      // SoftNav is observe-only — never disarm/remount.
      if (phase === 'soft_nav_observed') return
      if (phase !== 'generation_bumped') return
      const toGen = Number(notification.domGeneration ?? 0)
      const localGen = applierRef.current?.getGeneration() ?? 0
      if (!(toGen > 0 && (localGen === 0 || toGen > localGen))) return
      if (!armedRef.current) {
        armedRef.current = false
        return
      }
      armedRef.current = false
      onDiffObserveRef.current?.({
        kind: 'dom',
        hop: 'client_disarm',
        reason: 'generation_bumped',
        armed: false,
        generation: toGen,
        tClient: performance.now(),
        level: 'warn',
        extra: {
          fromGeneration: notification.domFromGeneration ?? null,
          bumpReason: notification.reason ?? null,
          url: notification.url ?? null,
        },
      })
    })
  }, [attachPageProjectionLifecycleSink])

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
        isArmed: () => armedRef.current && !(applierRef.current?.isDesynced() ?? false),
        onProgrammaticScrollSuppress: (target) => {
          onDiffObserveRef.current?.({
            kind: 'scroll',
            hop: 'programmaticSuppress',
            target: target === 'viewport' ? 'viewport' : target,
            generation: applierRef.current?.getGeneration() ?? null,
            tClient: performance.now(),
          })
        },
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
