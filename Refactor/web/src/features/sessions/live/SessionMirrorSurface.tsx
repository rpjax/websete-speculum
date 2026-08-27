import { useEffect, useRef, useState } from 'react'
import {
  ProjectionClient,
  createProjectionClient,
} from '@speculum/page-projection/projected/ProjectionClient'
import { attachProjectedInputCapture } from '@speculum/page-projection/projected/input/projectedInputCapture'
import { ScrollEchoGate } from '@speculum/page-projection/projected/input/scrollEchoGate'
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame'
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes'
import type { PageProjectionFrame, PageProjectionIntent, MirrorMode, SessionFrame, SessionInput } from '@/lib/speculum'
import { appendSessionBindingQuery } from '@/lib/speculum/sessionBindingAuth'
import { cn } from '@/lib/utils'
import { API_URL } from '@/lib/env'
import {
  fetchClientConfig,
  readPageProjectionClientKnobs,
  FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS,
  type PageProjectionClientKnobs,
} from '@/lib/clientConfig'
import {
  ViewportSync,
  measureHostElement,
  type ViewportSize,
} from '@speculum/page-projection/projected'
import type { SessionDeviceProfile } from '@/lib/speculum'
import type { CanvasSize } from './CanvasViewportSync'
import { SessionViewport, type SessionViewportProps } from './SessionViewport'
import type { SessionViewportBounds } from './sessionViewportPolicy'
import type {
  PageProjectionApplierProbe,
  PageProjectionFrameEndedSink,
  PageProjectionFrameObserveEvent,
  PageProjectionLifecycleSink,
} from './sessionObservation'

/**
 * Live PageProjection surface — hub frames → package {@link ProjectionClient}.
 * Resync is trigger-only (`RequestResync`); frames arrive on the Diff/Frames stream.
 */
export { ProjectionClient }

/** Shared CSS box for Video and Dom — measure host must not diverge across modes. */
export const SESSION_MEASURE_HOST_CLASS =
  'relative h-full min-h-0 min-w-0 w-full overflow-hidden'

export type SessionMirrorSurfaceProps = Omit<SessionViewportProps, 'attachFrameSink' | 'onInput'> & {
  mirrorMode: MirrorMode
  sessionId: string | null
  token: string | null
  assetBaseUrl?: string
  attachFrameSink: (sink: (frame: SessionFrame) => void) => () => void
  attachPageProjectionFrameSink: (sink: (diff: PageProjectionFrame) => void) => () => void
  attachPageProjectionLifecycleSink?: (
    sink: PageProjectionLifecycleSink,
  ) => () => void
  attachPageProjectionFrameEndedSink?: (
    sink: PageProjectionFrameEndedSink,
  ) => () => void
  onInput: (input: SessionInput) => void
  onDomInput: (input: PageProjectionIntent) => void
  onFrameObserve?: (event: PageProjectionFrameObserveEvent) => void
  registerApplierProbe?: (probe: PageProjectionApplierProbe | null) => void
  pageProjectionKnobs?: PageProjectionClientKnobs
}

function toIngestBytes(body: PageProjectionFrame['body']): Uint8Array | null {
  if (body == null) return null
  if (body instanceof Uint8Array) return body.byteLength > 0 ? body : null
  if (body instanceof ArrayBuffer) return body.byteLength > 0 ? new Uint8Array(body) : null
  if (Array.isArray(body)) return body.length > 0 ? Uint8Array.from(body) : null
  return null
}

function intentToWire(intent: UnifiedIntent): PageProjectionIntent {
  const payload: Record<string, unknown> = {}
  if (intent.type === 'move' || intent.type === 'down' || intent.type === 'up') {
    payload.x = intent.x
    payload.y = intent.y
    if (intent.button) payload.button = intent.button
  } else if (intent.type === 'keyDown' || intent.type === 'keyUp') {
    payload.key = intent.key
    payload.code = intent.code
    if (intent.modifiers) payload.modifiers = intent.modifiers
  } else if (intent.type === 'scrollSet') {
    payload.scrollX = intent.scrollX
    payload.scrollY = intent.scrollY
  } else if (intent.type === 'setFiles') {
    payload.files = intent.files
  }
  // `nodeId`/`contextId` on `down`/`up` — sparse-cdp id-addressed click; `null`/`1` when unresolved.
  const pointerNodeId =
    (intent.type === 'down' || intent.type === 'up') && intent.nodeId != null ? intent.nodeId : null
  const pointerContextId = intent.type === 'down' || intent.type === 'up' ? (intent.contextId ?? 1) : 1
  return {
    generation: 0,
    type: intent.type,
    anchor: null,
    targetId:
      intent.type === 'scrollSet' || intent.type === 'setFiles' ? intent.nodeId : pointerNodeId,
    timestampClient: intent.timestampClient ?? null,
    payload: JSON.stringify(payload),
    contextId:
      intent.type === 'scrollSet' || intent.type === 'setFiles' ? intent.contextId : pointerContextId,
    schemaVersion: intent.schemaVersion,
    viewportW: 'viewportW' in intent ? intent.viewportW : null,
    viewportH: 'viewportH' in intent ? intent.viewportH : null,
    census: null,
  }
}

interface PageProjectionV2SurfaceProps {
  width: number
  height: number
  className?: string
  live: boolean
  sessionId: string | null
  token: string | null
  assetBaseUrl?: string
  attachPageProjectionFrameSink: (sink: (diff: PageProjectionFrame) => void) => () => void
  attachPageProjectionFrameEndedSink?: (
    sink: PageProjectionFrameEndedSink,
  ) => () => void
  onDomInput: (input: PageProjectionIntent) => void
  onFrameObserve?: (event: PageProjectionFrameObserveEvent) => void
  knobs?: PageProjectionClientKnobs
  requestRemoteResize?: SessionViewportProps['requestRemoteResize']
  viewportPolicy?: SessionViewportBounds
  onCanvasLayout?: (size: CanvasSize) => void
  onRemoteViewportApplied?: (size: CanvasSize) => void
}

function PageProjectionV2Surface({
  width,
  height,
  className,
  live,
  sessionId,
  token,
  assetBaseUrl,
  attachPageProjectionFrameSink,
  attachPageProjectionFrameEndedSink,
  onDomInput,
  onFrameObserve,
  knobs: knobsProp,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
}: PageProjectionV2SurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<ProjectionClient | null>(null)
  const inputDetachRef = useRef<(() => void) | null>(null)
  const viewportRef = useRef({ width, height })
  viewportRef.current = { width, height }
  const onDomInputRef = useRef(onDomInput)
  onDomInputRef.current = onDomInput
  const onFrameObserveRef = useRef(onFrameObserve)
  onFrameObserveRef.current = onFrameObserve
  const onCanvasLayoutRef = useRef(onCanvasLayout)
  onCanvasLayoutRef.current = onCanvasLayout
  const onRemoteViewportAppliedRef = useRef(onRemoteViewportApplied)
  onRemoteViewportAppliedRef.current = onRemoteViewportApplied
  const sessionRef = useRef({ sessionId, token, assetBaseUrl })
  sessionRef.current = { sessionId, token, assetBaseUrl }
  const resyncInFlightRef = useRef(false)
  const lastSequenceRef = useRef(0)
  const [knobs, setKnobs] = useState<PageProjectionClientKnobs>(
    knobsProp ?? FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS,
  )
  const viewportSyncRef = useRef<ViewportSync | null>(null)
  const requestRemoteResizeRef = useRef(requestRemoteResize)
  requestRemoteResizeRef.current = requestRemoteResize

  useEffect(() => {
    const host = hostRef.current
    const request = requestRemoteResizeRef.current
    if (!host || !live || !request || !viewportPolicy) {
      viewportSyncRef.current?.dispose()
      viewportSyncRef.current = null
      return
    }

    const sync = new ViewportSync({
      measure: () => measureHostElement(host),
      resize: async (size: ViewportSize, device) => {
        const result = await request(size, device as SessionDeviceProfile)
        return {
          applied: result.applied,
          width: result.width,
          height: result.height,
          message: result.message ?? undefined,
          errorCode: result.errorCode ?? undefined,
        }
      },
      viewportPolicy,
      onApplied: (size) => {
        clientRef.current?.setCssSize(size.width, size.height)
        viewportRef.current = size
        onRemoteViewportAppliedRef.current?.(size)
      },
    })
    // Apply local stage to seed immediately (ViewportSync.seedRemote also notifies onApplied).
    clientRef.current?.setCssSize(width, height)
    viewportRef.current = { width, height }
    sync.seedRemote(width, height)
    sync.observe(host)
    viewportSyncRef.current = sync

    return () => {
      sync.dispose()
      if (viewportSyncRef.current === sync) {
        viewportSyncRef.current = null
      }
    }
    // seed width/height bind once; remote ack updates via prop effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [live, viewportPolicy])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reportLayout = () => {
      onCanvasLayoutRef.current?.(measureHostElement(host))
    }
    reportLayout()
    const observer = new ResizeObserver(reportLayout)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    clientRef.current?.setCssSize(width, height)
    viewportRef.current = { width, height }
  }, [width, height])

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
        /* keep fallback */
      })
    return () => {
      cancelled = true
    }
  }, [knobsProp])

  /** Trigger-only RequestResync — frames arrive on the live stream. */
  const triggerResync = async (reason: string, generation: number, contextId?: number) => {
    if (resyncInFlightRef.current) return
    resyncInFlightRef.current = true
    try {
      let { sessionId: sid, token: tok, assetBaseUrl: baseUrl } = sessionRef.current
      if (!sid || !tok) {
        const deadline = Date.now() + 5_000
        while (Date.now() < deadline) {
          await new Promise((r) => window.setTimeout(r, 50))
          sid = sessionRef.current.sessionId
          tok = sessionRef.current.token
          baseUrl = sessionRef.current.assetBaseUrl
          if (sid && tok) break
        }
      }
      if (!sid || !tok) {
        onFrameObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_resync_failed',
          reason: 'auth_token_missing',
          generation,
          tClient: performance.now(),
          level: 'warn',
        })
        return
      }
      onFrameObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_resync_request',
        reason,
        generation,
        tClient: performance.now(),
        level: 'wire',
      })
      const base = baseUrl?.replace(/\/$/, '') || window.location.origin
      const url = appendSessionBindingQuery(
        new URL(`/w7s/api/sessions/${sid}/page-projection/resync`, base),
        sid,
        tok,
      )
      url.searchParams.set('generation', String(generation))
      url.searchParams.set('sequence', String(Math.max(0, lastSequenceRef.current)))
      if (contextId != null) url.searchParams.set('contextId', String(contextId))
      const res = await fetch(url.toString(), { method: 'POST' })
      if (!res.ok) {
        onFrameObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_resync_failed',
          generation,
          tClient: performance.now(),
          level: 'warn',
          extra: { httpStatus: res.status, reason },
        })
      }
      // Body ignored — sealed path delivers establish/resync on the Frames stream.
    } catch {
      onFrameObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_resync_failed',
        generation,
        tClient: performance.now(),
        level: 'warn',
        extra: { reason },
      })
    } finally {
      resyncInFlightRef.current = false
    }
  }

  const bindInput = (client: ProjectionClient) => {
    inputDetachRef.current?.()
    inputDetachRef.current = null
    const root = client.document.documentElement
    if (!root) return
    // expect() before programmatic Projected scroll apply when that path exists.
    const scrollEcho = new ScrollEchoGate()
    const rootWin = client.document.defaultView
    const detachRoot = attachProjectedInputCapture(
      root,
      client.getLiveRegistry(),
      (intent) => onDomInputRef.current(intentToWire(intent)),
      {
        contextId: CONTEXT_ID_ROOT,
        getGeneration: () => client.getGeneration(),
        getViewportSize: () => viewportRef.current,
        getRootWindow: () => rootWin,
        isArmed: () => client.isArmed,
        onMarkPropDirty: (id) => client.markPropDirty(id),
        consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
        getSessionId: () => sessionRef.current.sessionId,
        getToken: () => sessionRef.current.token,
        getAssetBaseUrl: () =>
          sessionRef.current.assetBaseUrl?.replace(/\/$/, '') || window.location.origin,
      },
    )
    const nestedDetachers: Array<() => void> = []
    client.forEachNestedInputSurface((info) => {
      const nestedDoc = info.surface.contentDocument
      const nestedSurface = nestedDoc?.documentElement
      if (!nestedSurface || nestedSurface.nodeType !== 1) return
      nestedDetachers.push(
        attachProjectedInputCapture(
          nestedSurface,
          info.registry,
          (intent) => onDomInputRef.current(intentToWire(intent)),
          {
            contextId: info.contextId,
            getGeneration: info.getGeneration,
            getViewportSize: () => viewportRef.current,
            getRootWindow: () => rootWin,
            isArmed: info.isArmed,
            onMarkPropDirty: info.markPropDirty,
            consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
            getSessionId: () => sessionRef.current.sessionId,
            getToken: () => sessionRef.current.token,
            getAssetBaseUrl: () =>
              sessionRef.current.assetBaseUrl?.replace(/\/$/, '') || window.location.origin,
          },
        ),
      )
    })
    inputDetachRef.current = () => {
      detachRoot()
      for (const d of nestedDetachers) d()
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const client = createProjectionClient({
      surfaceHost: host,
      width,
      height,
      getToken: () => sessionRef.current.token,
      getAssetBaseUrl: () =>
        sessionRef.current.assetBaseUrl?.replace(/\/$/, '') || window.location.origin,
      onArmed: () => {
        bindInput(client)
        onFrameObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_arm',
          tClient: performance.now(),
          level: 'wire',
        })
      },
      onDesync: (reason) => {
        onFrameObserveRef.current?.({
          kind: 'pageProjection',
          hop: 'client_desync',
          reason,
          dropped: true,
          tClient: performance.now(),
          level: 'warn',
        })
      },
      onRequestResync: (info) => {
        void triggerResync(info.reason, info.generation, info.contextId)
      },
    })
    clientRef.current = client
    if (width > 0 && height > 0) {
      client.setCssSize(width, height)
    }
    return () => {
      inputDetachRef.current?.()
      inputDetachRef.current = null
      client.reset()
      clientRef.current = null
      host.replaceChildren()
    }
    // width/height seed surface once; resize is remote via measure host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return attachPageProjectionFrameSink((diff) => {
      const bytes = toIngestBytes(diff.body)
      if (!bytes) return
      if (Number.isFinite(diff.sequence)) {
        lastSequenceRef.current = Math.max(lastSequenceRef.current, Number(diff.sequence))
      }
      clientRef.current?.ingest(bytes)
      if (clientRef.current?.isArmed) bindInput(clientRef.current)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachPageProjectionFrameSink])

  useEffect(() => {
    if (!attachPageProjectionFrameEndedSink) return
    return attachPageProjectionFrameEndedSink(() => {
      onFrameObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_desync',
        reason: 'wire_stall',
        dropped: true,
        tClient: performance.now(),
        level: 'warn',
      })
      void triggerResync('wire_stall', 0)
    })
  }, [attachPageProjectionFrameEndedSink])

  useEffect(() => {
    if (!sessionId) return
    const timer = window.setTimeout(() => {
      const client = clientRef.current
      if (client?.isArmed) return
      onFrameObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_desync',
        reason: 'establish_miss',
        dropped: true,
        tClient: performance.now(),
        level: 'warn',
      })
      void triggerResync('establish_miss', 1)
    }, Math.max(20_000, knobs.swapTimeoutMs * 8))
    return () => window.clearTimeout(timer)
  }, [sessionId, knobs.swapTimeoutMs])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      data-pp-surface-host
    />
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
  attachPageProjectionFrameSink,
  attachPageProjectionFrameEndedSink,
  onInput,
  onDomInput,
  onFrameObserve,
  pageProjectionKnobs,
  className,
  ...viewportProps
}: SessionMirrorSurfaceProps) {
  const hostClass = cn(SESSION_MEASURE_HOST_CLASS, className)

  if (mirrorMode === 'pageProjection') {
    return (
      <PageProjectionV2Surface
        className={hostClass}
        live={Boolean(sessionId)}
        sessionId={sessionId}
        token={token}
        assetBaseUrl={assetBaseUrl}
        attachPageProjectionFrameSink={attachPageProjectionFrameSink}
        attachPageProjectionFrameEndedSink={attachPageProjectionFrameEndedSink}
        onDomInput={onDomInput}
        onFrameObserve={onFrameObserve}
        knobs={pageProjectionKnobs}
        width={viewportProps.width}
        height={viewportProps.height}
        requestRemoteResize={viewportProps.requestRemoteResize}
        viewportPolicy={viewportProps.viewportPolicy}
        onCanvasLayout={viewportProps.onCanvasLayout}
        onRemoteViewportApplied={viewportProps.onRemoteViewportApplied}
      />
    )
  }

  return (
    <SessionViewport
      className={hostClass}
      attachFrameSink={attachFrameSink}
      onInput={onInput}
      {...viewportProps}
    />
  )
}
