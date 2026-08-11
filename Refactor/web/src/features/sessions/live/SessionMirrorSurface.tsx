import { useEffect, useRef } from 'react'
import type { PageProjectionDiff, PageProjectionIntent, MirrorMode, SessionFrame, SessionInput } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import type { CanvasSize } from './CanvasViewportSync'
import { DomProjector, type DomProjectorProps } from './dom/DomProjector'
import { SessionViewport, type SessionViewportProps } from './SessionViewport'
import { SurfaceHost, type SurfaceHostHandle } from './page/surface'
import { ProjectionClient } from './page/ProjectionClient'

/**
 * Redesigned engine (docs/page-projection-engine-redesign.md) — live cutover §9 Phase C3.
 * `engine="v2"` mounts the double-buffered `SurfaceHost` behind a real `ProjectionClient`:
 * `attachPageProjectionDiffSink` diffs whose `plane`/`operation` are empty carry an opaque
 * §5.5 binary `body` (PP-WIRE-1 — the API relays it without parsing) and feed straight into
 * `client.ingest`. V1 JSON-body diffs (`plane` `dom`/`cssom`) are ignored on this path; there
 * is and must never be a JSON→binary adapter here (AGENTS.md ad-hoc ban).
 *
 * The OOB `PageProjection.Resync` HTTP response is still the V1 JSON snapshot
 * (`root`/`sheets` — see `DomProjector`); no binary-wire resync exists yet, so adapting that
 * snapshot into `ingest()`'s binary reader would be exactly the forbidden ad-hoc bridge.
 * `onDesync` therefore only reports the defect via `onDiffObserve` until a real binary OOB
 * resync wire lands — never call it "recovered".
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
  attachPageProjectionLifecycleSink?: DomProjectorProps['attachPageProjectionLifecycleSink']
  attachPageProjectionDiffEndedSink?: DomProjectorProps['attachPageProjectionDiffEndedSink']
  onInput: (input: SessionInput) => void
  onDomInput: (input: PageProjectionIntent) => void
  onDiffObserve?: DomProjectorProps['onDiffObserve']
  registerApplierProbe?: DomProjectorProps['registerApplierProbe']
  /**
   * Cutover switch (§9 Phase C3). Default `'v2'` — the redesigned `SurfaceHost` +
   * `ProjectionClient` binary wire. `'v1'` keeps `DomProjector` (the JSON-body engine)
   * for paths/tests that still need it ahead of its removal (C5).
   */
  engine?: 'v1' | 'v2'
}

/** Coerces a wire `PageProjectionDiff.body` into ingest-ready bytes; `null` when absent/empty. */
function toIngestBytes(body: PageProjectionDiff['body']): Uint8Array | null {
  if (body == null) return null
  if (body instanceof Uint8Array) return body.byteLength > 0 ? body : null
  if (body instanceof ArrayBuffer) return body.byteLength > 0 ? new Uint8Array(body) : null
  if (Array.isArray(body)) return body.length > 0 ? Uint8Array.from(body) : null
  return null
}

interface PageProjectionV2SurfaceProps {
  width: number
  height: number
  className?: string
  attachPageProjectionDiffSink: (sink: (diff: PageProjectionDiff) => void) => () => void
  attachPageProjectionDiffEndedSink?: DomProjectorProps['attachPageProjectionDiffEndedSink']
  onDomInput: (input: PageProjectionIntent) => void
  onDiffObserve?: DomProjectorProps['onDiffObserve']
}

/**
 * Live v2 surface (§9 Phase C3): double-buffered `SurfaceHost` fed by `ProjectionClient`.
 * Local-first interaction (§5.9) re-attaches to whichever buffer document just became
 * active on every swap (`SurfaceHost.onSwap`, §5.8.5) — the two iframes alternate active/
 * standby across establish/resync, so a single one-shot attach would go stale.
 */
function PageProjectionV2Surface({
  width,
  height,
  className,
  attachPageProjectionDiffSink,
  attachPageProjectionDiffEndedSink,
  onDomInput,
  onDiffObserve,
}: PageProjectionV2SurfaceProps) {
  const surfaceHandleRef = useRef<SurfaceHostHandle>(null)
  const clientRef = useRef<ProjectionClient | null>(null)
  const viewportRef = useRef({ width, height })
  viewportRef.current = { width, height }
  const onDomInputRef = useRef(onDomInput)
  onDomInputRef.current = onDomInput
  const onDiffObserveRef = useRef(onDiffObserve)
  onDiffObserveRef.current = onDiffObserve

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
      // No client → server control channel transport exists yet (§5.9.5) —
      // PageProjectionOptions.ClientStateMs configures a report interval, not a wire path.
      sendClientState: () => {},
      getViewportSize: () => viewportRef.current,
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
      },
    })
    clientRef.current = client
    if (surfaceHandleRef.current) client.attachSurface(surfaceHandleRef.current)
    client.attachVisibility(document)
    client.start()
    return () => {
      client.stop()
      clientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return attachPageProjectionDiffSink((diff) => {
      const bytes = toIngestBytes(diff.body)
      if (!bytes) return // V1 JSON-body diff — no JSON→binary adapter on the v2 path (PP-WIRE-1).
      clientRef.current?.ingest(bytes)
    })
  }, [attachPageProjectionDiffSink])

  useEffect(() => {
    if (!attachPageProjectionDiffEndedSink) return
    return attachPageProjectionDiffEndedSink(() => {
      // No binary-wire OOB resync exists yet (see module-level comment) — surface the
      // stall, never fabricate a recovery.
      onDiffObserveRef.current?.({
        kind: 'pageProjection',
        hop: 'client_desync',
        reason: 'wire_stall',
        dropped: true,
        tClient: performance.now(),
        level: 'warn',
      })
    })
  }, [attachPageProjectionDiffEndedSink])

  return (
    <SurfaceHost
      ref={surfaceHandleRef}
      width={width}
      height={height}
      className={className}
      onSwap={(doc) => clientRef.current?.attachInteraction(doc.documentElement)}
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
  attachPageProjectionDiffSink,
  attachPageProjectionLifecycleSink,
  attachPageProjectionDiffEndedSink,
  onInput,
  onDomInput,
  onDiffObserve,
  registerApplierProbe,
  engine = 'v2',
  className,
  ...viewportProps
}: SessionMirrorSurfaceProps) {
  const hostClass = cn(SESSION_MEASURE_HOST_CLASS, className)

  if (mirrorMode === 'pageProjection' && engine === 'v2') {
    return (
      <PageProjectionV2Surface
        width={viewportProps.width}
        height={viewportProps.height}
        className={hostClass}
        attachPageProjectionDiffSink={attachPageProjectionDiffSink}
        attachPageProjectionDiffEndedSink={attachPageProjectionDiffEndedSink}
        onDomInput={onDomInput}
        onDiffObserve={onDiffObserve}
      />
    )
  }

  if (mirrorMode === 'pageProjection') {
    return (
      <DomProjector
        width={viewportProps.width}
        height={viewportProps.height}
        live={viewportProps.live}
        sessionId={sessionId}
        token={token}
        assetBaseUrl={assetBaseUrl}
        attachPageProjectionDiffSink={attachPageProjectionDiffSink}
        attachPageProjectionLifecycleSink={attachPageProjectionLifecycleSink}
        attachPageProjectionDiffEndedSink={attachPageProjectionDiffEndedSink}
        onDomInput={onDomInput}
        onDiffObserve={onDiffObserve}
        registerApplierProbe={registerApplierProbe}
        requestRemoteResize={viewportProps.requestRemoteResize}
        viewportPolicy={viewportProps.viewportPolicy}
        onCanvasLayout={viewportProps.onCanvasLayout}
        onRemoteViewportApplied={viewportProps.onRemoteViewportApplied}
        presentation={viewportProps.presentation}
        className={hostClass}
        label={viewportProps.label}
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
