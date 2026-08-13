import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageProjectionDiff, PageProjectionIntent, MirrorMode, SessionFrame, SessionInput } from '@/lib/speculum'
import { appendSessionBindingQuery } from '@/lib/speculum/sessionBindingAuth'
import { cn } from '@/lib/utils'
import { API_URL } from '@/lib/env'
import {
  fetchClientConfig,
  readPageProjectionClientKnobs,
  FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS,
  type PageProjectionClientKnobs,
} from '@/lib/clientConfig'
import type { CanvasSize } from './CanvasViewportSync'
import { SessionViewport, type SessionViewportProps } from './SessionViewport'
import { SurfaceHost, type SurfaceHostHandle } from './page/surface'
import { ProjectionClient } from './page/ProjectionClient'
import type { PageProjectionClientState } from './page/clientState'
import { useMeasureHostSync } from './useMeasureHostSync'
import { measureCanvasElement } from './CanvasViewportSync'
import type { SessionViewportBounds } from './sessionViewportPolicy'
import type {
  PageProjectionApplierProbe,
  PageProjectionDiffEndedSink,
  PageProjectionDiffObserveEvent,
  PageProjectionLifecycleSink,
} from './sessionObservation'

/**
 * Redesigned engine (docs/page-projection/spec/engine-redesign.md) — live V2 path.
 * Binary §5.5 diffs → `ProjectionClient.ingest`. OOB resync returns length-prefixed
 * binary parts (§5.7.2) — never a JSON→binary adapter (AGENTS.md ad-hoc ban).
 */
export { SurfaceHost, ProjectionClient }

/** Shared CSS box for Video and Dom — measure host must not diverge across modes. */
export const SESSION_MEASURE_HOST_CLASS =
  'relative h-full min-h-0 min-w-0 w-full overflow-hidden'

export type SessionMirrorSurfaceProps = Omit<SessionViewportProps, 'attachFrameSink' | 'onInput'> & {
  mirrorMode: MirrorMode
  sessionId: string | null
  token: string | null
  assetBaseUrl?: string
  attachFrameSink: (sink: (frame: SessionFrame) => void) => () => void
  attachPageProjectionDiffSink: (sink: (diff: PageProjectionDiff) => void) => () => void
  attachPageProjectionLifecycleSink?: (
    sink: PageProjectionLifecycleSink,
  ) => () => void
  attachPageProjectionDiffEndedSink?: (
    sink: PageProjectionDiffEndedSink,
  ) => () => void
  onInput: (input: SessionInput) => void
  onDomInput: (input: PageProjectionIntent) => void
  onDiffObserve?: (event: PageProjectionDiffObserveEvent) => void
  registerApplierProbe?: (probe: PageProjectionApplierProbe | null) => void
  /** Optional override; otherwise loaded from public client-config PageProjection knobs. */
  pageProjectionKnobs?: PageProjectionClientKnobs
}

/** Coerces a wire `PageProjectionDiff.body` into ingest-ready bytes; `null` when absent/empty. */
function toIngestBytes(body: PageProjectionDiff['body']): Uint8Array | null {
  if (body == null) return null
  if (body instanceof Uint8Array) return body.byteLength > 0 ? body : null
  if (body instanceof ArrayBuffer) return body.byteLength > 0 ? new Uint8Array(body) : null
  if (Array.isArray(body)) return body.length > 0 ? Uint8Array.from(body) : null
  return null
}

/** Split HTTP OOB resync body: repeating `[u32 LE length][part bytes]`. */
export function splitLengthPrefixedParts(buf: ArrayBuffer): Uint8Array[] {
  const view = new DataView(buf)
  const parts: Uint8Array[] = []
  let o = 0
  const bytes = new Uint8Array(buf)
  while (o + 4 <= view.byteLength) {
    const len = view.getUint32(o, true)
    o += 4
    if (len === 0 || o + len > view.byteLength) break
    parts.push(bytes.subarray(o, o + len))
    o += len
  }
  return parts
}

interface PageProjectionV2SurfaceProps {
  width: number
  height: number
  className?: string
  live: boolean
  sessionId: string | null
  token: string | null
  assetBaseUrl?: string
  attachPageProjectionDiffSink: (sink: (diff: PageProjectionDiff) => void) => () => void
  attachPageProjectionDiffEndedSink?: (
    sink: PageProjectionDiffEndedSink,
  ) => () => void
  onDomInput: (input: PageProjectionIntent) => void
  onDiffObserve?: (event: PageProjectionDiffObserveEvent) => void
  knobs?: PageProjectionClientKnobs
  requestRemoteResize?: SessionViewportProps['requestRemoteResize']
  viewportPolicy?: SessionViewportBounds
  onCanvasLayout?: (size: CanvasSize) => void
  onRemoteViewportApplied?: (size: CanvasSize) => void
}

/**
 * Live v2 surface: double-buffered `SurfaceHost` fed by `ProjectionClient`.
 * Local-first interaction re-attaches on every `SurfaceHost.onSwap`.
 */
function PageProjectionV2Surface({
  width,
  height,
  className,
  live,
  sessionId,
  token,
  assetBaseUrl,
  attachPageProjectionDiffSink,
  attachPageProjectionDiffEndedSink,
  onDomInput,
  onDiffObserve,
  knobs: knobsProp,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
}: PageProjectionV2SurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceHandleRef = useRef<SurfaceHostHandle | null>(null)
  const clientRef = useRef<ProjectionClient | null>(null)
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
  const sessionRef = useRef({ sessionId, token, assetBaseUrl })
  sessionRef.current = { sessionId, token, assetBaseUrl }
  const resyncAttemptRef = useRef(0)
  const resyncInFlightRef = useRef<Promise<void> | null>(null)
  const lastSequenceRef = useRef(0)
  const [knobs, setKnobs] = useState<PageProjectionClientKnobs>(
    knobsProp ?? FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS,
  )

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
    const host = hostRef.current
    if (!host) return
    const reportLayout = () => {
      const measureHost =
        (host.querySelector('[data-pp-surface-host]') as HTMLElement | null) ?? host
      onCanvasLayoutRef.current?.(measureCanvasElement(measureHost))
    }
    reportLayout()
    const observer = new ResizeObserver(reportLayout)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const bindSurfaceHandle = useCallback((handle: SurfaceHostHandle | null) => {
    surfaceHandleRef.current = handle
    if (handle) {
      clientRef.current?.attachSurface(handle)
    }
  }, [])

  useLayoutEffect(() => {
    const handle = surfaceHandleRef.current
    if (handle) {
      clientRef.current?.attachSurface(handle)
    }
  })

  useEffect(() => {
    if (knobsProp) {
      setKnobs(knobsProp)
      return
    }
    let cancelled = false
    void fetchClientConfig(API_URL)
      .then((cfg) => {
        if (!cancelled) setKnobs(readPageProjectionClientKnobs(cfg))
      })
      .catch(() => {
        /* keep fallback — operational PreStart already failed closed elsewhere */
      })
    return () => {
      cancelled = true
    }
  }, [knobsProp])

  const runOobResync = async (reason: string, generation: number) => {
    const attempt = ++resyncAttemptRef.current
    const expected = lastSequenceRef.current
    let sid = sessionRef.current.sessionId
    let tok = sessionRef.current.token
    let baseUrl = sessionRef.current.assetBaseUrl
    if (!sid || !tok) {
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_resync_failed',
        reason: 'auth_token_missing',
        generation,
        expectedSequence: expected,
        tClient: performance.now(),
        level: 'warn',
        extra: { phase: 'wait_binding', priorReason: reason },
      })
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        await new Promise((r) => window.setTimeout(r, 50))
        if (attempt !== resyncAttemptRef.current) return
        sid = sessionRef.current.sessionId
        tok = sessionRef.current.token
        baseUrl = sessionRef.current.assetBaseUrl
        if (sid && tok) break
      }
      if (!sid || !tok) {
        onDiffObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_resync_failed',
          reason: 'auth_token_missing',
          generation,
          expectedSequence: expected,
          tClient: performance.now(),
          level: 'warn',
          extra: { phase: 'binding_timeout', priorReason: reason },
        })
        return
      }
    }
    onDiffObserveRef.current?.({
      kind: 'pageProjection',
      hop: 'client_resync_request',
      reason,
      generation,
      expectedSequence: expected,
      tClient: performance.now(),
      level: 'wire',
    })
    try {
      const base = baseUrl?.replace(/\/$/, '') || window.location.origin
      const url = appendSessionBindingQuery(
        new URL(`/w7s/api/sessions/${sid}/page-projection/resync`, base),
        sid,
        tok,
      )
      url.searchParams.set('generation', String(generation))
      url.searchParams.set('sequence', String(Math.max(0, expected)))
      const res = await fetch(url.toString(), { method: 'POST' })
      if (!res.ok) {
        onDiffObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_resync_failed',
          generation,
          expectedSequence: expected,
          tClient: performance.now(),
          level: 'warn',
          extra: { httpStatus: res.status, reason },
        })
        return
      }
      if (attempt !== resyncAttemptRef.current) return
      const buf = await res.arrayBuffer()
      if (attempt !== resyncAttemptRef.current) return
      const parts = splitLengthPrefixedParts(buf)
      const client = clientRef.current
      if (!client || parts.length === 0) {
        onDiffObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_resync_failed',
          generation,
          expectedSequence: expected,
          tClient: performance.now(),
          level: 'warn',
          extra: { errorCode: 'resync_payload_invalid', phase: 'parse' },
        })
        return
      }
      for (const part of parts) client.ingest(part)
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_resync_applied',
        generation,
        expectedSequence: expected,
        tClient: performance.now(),
        level: 'wire',
        extra: { partCount: parts.length },
      })
    } catch (err) {
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_resync_failed',
        generation,
        expectedSequence: expected,
        tClient: performance.now(),
        level: 'warn',
        extra: { message: err instanceof Error ? err.message.slice(0, 240) : 'fetch_error' },
      })
    }
  }

  const requestResync = (reason: string, generation: number) => {
    if (resyncInFlightRef.current) return
    resyncInFlightRef.current = runOobResync(reason, generation).finally(() => {
      resyncInFlightRef.current = null
    })
  }

  const sendClientState = async (state: PageProjectionClientState) => {
    const { sessionId: sid, token: tok, assetBaseUrl: baseUrl } = sessionRef.current
    if (!sid || !tok) return
    try {
      const base = baseUrl?.replace(/\/$/, '') || window.location.origin
      const url = appendSessionBindingQuery(
        new URL(`/w7s/api/sessions/${sid}/page-projection/client-state`, base),
        sid,
        tok,
      )
      await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: state.visibility,
          appliedThroughSequence: state.appliedThroughSequence,
          queuedFrames: state.queuedFrames,
          applyP50Ms: state.applyP50Ms,
          applyP95Ms: state.applyP95Ms,
          overrunCount: state.overrunCount,
        }),
      })
    } catch {
      /* control channel is best-effort — never desync on report failure */
    }
  }

  useEffect(() => {
    const client = new ProjectionClient({
      sendIntent: (intent) => {
        onDomInputRef.current({
          generation: intent.generation,
          type: intent.type,
          anchor: null,
          targetId: intent.nodeId ?? null,
          timestampClient: intent.timestampClient,
          payload: intent.payload,
        })
      },
      sendClientState,
      getViewportSize: () => viewportRef.current,
      clientStateMs: knobs.clientStateMs,
      applyBudgetMs: knobs.applyBudgetMs,
      sessionId: sessionRef.current.sessionId,
      token: sessionRef.current.token,
      assetBaseUrl: sessionRef.current.assetBaseUrl,
      getSessionId: () => sessionRef.current.sessionId,
      getToken: () => sessionRef.current.token,
      getAssetBaseUrl: () =>
        sessionRef.current.assetBaseUrl?.replace(/\/$/, '') || window.location.origin,
      onDesync: (reason, generation) => {
        onDiffObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_desync',
          reason,
          generation,
          dropped: true,
          tClient: performance.now(),
          level: 'warn',
        })
        requestResync(reason, generation)
      },
    })
    clientRef.current = client
    client.attachVisibility(document)
    client.start()
    return () => {
      client.stop()
      clientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knobs.clientStateMs, knobs.applyBudgetMs])

  useEffect(() => {
    return attachPageProjectionDiffSink((diff) => {
      const bytes = toIngestBytes(diff.body)
      if (!bytes) return
      if (Number.isFinite(diff.sequence)) lastSequenceRef.current = Math.max(lastSequenceRef.current, Number(diff.sequence))
      clientRef.current?.ingest(bytes)
    })
  }, [attachPageProjectionDiffSink])

  useEffect(() => {
    if (!attachPageProjectionDiffEndedSink) return
    return attachPageProjectionDiffEndedSink(() => {
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_desync',
        reason: 'wire_stall',
        dropped: true,
        tClient: performance.now(),
        level: 'warn',
      })
      requestResync('wire_stall', 0)
    })
  }, [attachPageProjectionDiffEndedSink])

  // Heavy establishes can finish before the data-stream sink is attached (or be
  // DropAll'd). If FMP never arms, request OOB resync from the mirror once.
  useEffect(() => {
    if (!sessionId) return
    const timer = window.setTimeout(() => {
      const host = hostRef.current
      const armed =
        host?.getAttribute('data-speculum-armed') === 'true' ||
        Boolean(host?.querySelector('[data-speculum-armed="true"]'))
      if (armed) return
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_desync',
        reason: 'establish_miss',
        dropped: true,
        tClient: performance.now(),
        level: 'warn',
      })
      requestResync('establish_miss', 1)
    }, Math.max(20_000, knobs.swapTimeoutMs * 8))
    return () => window.clearTimeout(timer)
  }, [sessionId, knobs.swapTimeoutMs])

  return (
    <div ref={hostRef} className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <SurfaceHost
        ref={bindSurfaceHandle}
        width={width}
        height={height}
        className="absolute inset-0 h-full w-full"
        swapTimeoutMs={knobs.swapTimeoutMs}
        onSwap={(doc) => clientRef.current?.attachInteraction(doc.documentElement)}
      />
    </div>
  )
}

/**
 * Mode-exclusive mirror surface. The measure host for the selected mode mounts
 * before Start (Dom does not wait for sessionId/token) so StartSession geometry
 * is exactly the surface that stays mounted.
 */
export function SessionMirrorSurface({
  mirrorMode,
  sessionId,
  token,
  assetBaseUrl,
  attachFrameSink,
  attachPageProjectionDiffSink,
  attachPageProjectionDiffEndedSink,
  onInput,
  onDomInput,
  onDiffObserve,
  pageProjectionKnobs,
  className,
  ...viewportProps
}: SessionMirrorSurfaceProps) {
  const hostClass = cn(SESSION_MEASURE_HOST_CLASS, className)

  if (mirrorMode === 'pageProjection') {
    return (
      <PageProjectionV2Surface
        width={viewportProps.width}
        height={viewportProps.height}
        className={hostClass}
        live={viewportProps.live}
        sessionId={sessionId}
        token={token}
        assetBaseUrl={assetBaseUrl}
        attachPageProjectionDiffSink={attachPageProjectionDiffSink}
        attachPageProjectionDiffEndedSink={attachPageProjectionDiffEndedSink}
        onDomInput={onDomInput}
        onDiffObserve={onDiffObserve}
        knobs={pageProjectionKnobs}
        requestRemoteResize={viewportProps.requestRemoteResize}
        viewportPolicy={viewportProps.viewportPolicy}
        onCanvasLayout={viewportProps.onCanvasLayout}
        onRemoteViewportApplied={viewportProps.onRemoteViewportApplied}
      />
    )
  }

  return (
    <SessionViewport
      {...viewportProps}
      className={hostClass}
      attachFrameSink={attachFrameSink}
      onInput={onInput}
    />
  )
}

export type { CanvasSize }
