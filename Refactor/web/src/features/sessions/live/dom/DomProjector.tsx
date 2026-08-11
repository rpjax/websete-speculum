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
  /** Diff uni-stream EOF while session live → T8 OOB resync. */
  attachPageProjectionDiffEndedSink?: (
    sink: (info: { reason: 'wire_stall' }) => void,
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
      | 'client_epoch_arm'
      | 'client_disarm'
      | 'client_surface_probe'
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
  attachPageProjectionDiffEndedSink,
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
  /** Ring of recent apply lag samples (ms) — client_surface_probe lagMsP50. */
  const recentLagsRef = useRef<number[]>([])
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
    /**
     * Arm hop pair: `client_arm` stays for back-compat; `client_epoch_arm` is the
     * PageEpoch-parity name (pageEpochId is not on the wire yet — generation-only).
     */
    const emitArm = (reason: string, generation: number) => {
      const tClient = performance.now()
      onDiffObserveRef.current?.({
        kind: 'dom',
        hop: 'client_arm',
        reason,
        armed: true,
        generation,
        tClient,
      })
      onDiffObserveRef.current?.({
        kind: 'dom',
        hop: 'client_epoch_arm',
        reason,
        armed: true,
        generation,
        tClient,
        extra: { generation: String(generation) },
      })
    }
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
        if (!res.ok) {
          let errorCode: string | null = null
          let phase: string | null = null
          let message: string | null = null
          try {
            const errBody = (await res.json()) as {
              errorCode?: string
              phase?: string
              message?: string
            }
            errorCode = errBody.errorCode ?? null
            phase = errBody.phase ?? null
            message = errBody.message ?? null
          } catch {
            /* non-JSON */
          }
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_resync_failed',
            generation: gen,
            expectedSequence: expected,
            tClient: performance.now(),
            level: 'warn',
            extra: {
              httpStatus: res.status,
              errorCode,
              phase,
              message: message?.slice(0, 240) ?? null,
            },
          })
          return
        }
        // Stale response from a superseded attempt — drop.
        if (attempt !== resyncAttempt) return
        const body = (await res.json()) as {
          generation?: number
          coversThroughSequence?: number
          root?: DomNode
          sheets?: CssomSheet[]
        }
        if (!body.root || !Array.isArray(body.sheets)) {
          onDiffObserveRef.current?.({
            kind: 'dom',
            hop: 'client_resync_failed',
            generation: gen,
            expectedSequence: expected,
            tClient: performance.now(),
            level: 'warn',
            extra: { errorCode: 'resync_payload_invalid', phase: 'parse' },
          })
          return
        }
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
          kind: 'dom',
          hop: 'client_resync_apply',
          generation: snapGen,
          sequence: covers,
          sheetCount: sheets.length,
          ruleCount,
          seeded: seededSheetCount > 0,
          tClient: tApply,
          lagMs: tApply - tReq,
          extra: { seededSheetCount, joint: true },
        })
        // D12: arm only when drain left us synced. Gap after OOB keeps desynced;
        // onDesync already scheduled coalesce retry via requestOobResync.
        if (!applier.isDesynced()) {
          armedRef.current = true
          emitArm('resync', snapGen)
        } else {
          armedRef.current = false
        }
      } catch (err) {
        onDiffObserveRef.current?.({
          kind: 'dom',
          hop: 'client_resync_failed',
          generation: applier.getGeneration(),
          expectedSequence: expected,
          tClient: performance.now(),
          level: 'warn',
          extra: {
            errorCode: 'resync_exception',
            phase: 'fetch',
            message: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
          },
        })
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
        // Drain may leave a T8 gap after apply — ensure one follow-up even if
        // onDesync raced before coalesce attached.
        if (applier.isDesynced()) {
          window.setTimeout(() => {
            if (!applier.isDesynced() || resyncInFlight) return
            requestOobResync(lastResyncExpected)
          }, 200)
        }
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
        // Observe hop is emitted inside runOobResync (avoid double client_resync_request).
        requestOobResync(expected)
      },
      (generation) => {
        // Live document/install establish — only arm when not desynced.
        if (applier.isDesynced()) {
          armedRef.current = false
          return
        }
        armedRef.current = true
        emitArm('document_or_install', generation)
      },
      (diff) => {
        const tClient = performance.now()
        const timestamp = diff.timestamp != null ? Number(diff.timestamp) : null
        const lagMs = pageProjectionLagMs(timestamp)
        if (lagMs != null) {
          const lags = recentLagsRef.current
          lags.push(lagMs)
          if (lags.length > 50) lags.shift()
        }
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
      if (phase === 'queue_dropped') {
        const applier = applierRef.current
        if (!applier || !live || !sessionId || !token) return
        applier.noteWireCut('queue_dropped')
        return
      }
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
  }, [attachPageProjectionLifecycleSink, live, sessionId, token])

  useEffect(() => {
    if (!attachPageProjectionDiffEndedSink) return
    return attachPageProjectionDiffEndedSink(() => {
      const applier = applierRef.current
      if (!applier || !live || !sessionId || !token) return
      applier.noteWireCut('wire_stall')
    })
  }, [attachPageProjectionDiffEndedSink, live, sessionId, token])

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

  // client_surface_probe — periodic surface health sample (~5s) while armed for input;
  // observePageProjectionDiffApply gates the actual trace write on pageProjectionDiff.
  useEffect(() => {
    if (!live || !sessionId || !token) return
    const interval = window.setInterval(() => {
      const surface = surfaceRef.current
      const applier = applierRef.current
      if (!surface || !applier) return
      const htmlLen = surface.innerHTML.length
      const ownedRules = applier.getOwnedRuleCount()
      const imgs = surface.querySelectorAll('img')
      const vw = window.innerWidth
      const vh = window.innerHeight
      let imgCount = 0
      let brokenImgs = 0
      let brokenImgsInViewport = 0
      imgs.forEach((img) => {
        imgCount += 1
        const broken = img.complete && img.naturalWidth === 0 && !!img.getAttribute('src')
        if (!broken) return
        brokenImgs += 1
        const rect = img.getBoundingClientRect()
        if (rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw) {
          brokenImgsInViewport += 1
        }
      })
      const lags = recentLagsRef.current
      const lagMsP50 = lags.length > 0 ? median(lags) : null
      onDiffObserveRef.current?.({
        kind: 'dom',
        hop: 'client_surface_probe',
        generation: applier.getGeneration(),
        sequence: applier.getLastSequence(),
        armed: armedRef.current,
        tClient: performance.now(),
        extra: { htmlLen, ownedRules, imgCount, brokenImgs, brokenImgsInViewport, lagMsP50 },
      })
    }, 5000)
    return () => window.clearInterval(interval)
  }, [live, sessionId, token])

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

/** Approx p50 over the recent-apply lag ring (client_surface_probe lagMsP50). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
