import type { PageProjectionDiff, PageProjectionIntent, MirrorMode, SessionFrame, SessionInput } from '@/lib/speculum'
import { cn } from '@/lib/utils'
import type { CanvasSize } from './CanvasViewportSync'
import { DomProjector, type DomProjectorProps } from './dom/DomProjector'
import { SessionViewport, type SessionViewportProps } from './SessionViewport'

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
  className,
  ...viewportProps
}: SessionMirrorSurfaceProps) {
  const hostClass = cn(SESSION_MEASURE_HOST_CLASS, className)

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
