import type { DomDiff, DomProjectionInput, MirrorMode, SessionFrame, SessionInput } from '@/lib/speculum'
import type { CanvasSize } from './CanvasViewportSync'
import { DomProjector } from './dom/DomProjector'
import { SessionViewport, type SessionViewportProps } from './SessionViewport'

export type SessionMirrorSurfaceProps = Omit<SessionViewportProps, 'attachFrameSink' | 'onInput'> & {
  mirrorMode: MirrorMode
  sessionId: string | null
  token: string | null
  assetBaseUrl?: string
  attachFrameSink: (sink: (frame: SessionFrame) => void) => () => void
  attachDomDiffSink: (sink: (diff: DomDiff) => void) => () => void
  onInput: (input: SessionInput) => void
  onDomInput: (input: DomProjectionInput) => void
}

/**
 * Mode-exclusive mirror surface: VideoStreaming canvas or DomProjection DOM.
 */
export function SessionMirrorSurface({
  mirrorMode,
  sessionId,
  token,
  assetBaseUrl,
  attachFrameSink,
  attachDomDiffSink,
  onInput,
  onDomInput,
  ...viewportProps
}: SessionMirrorSurfaceProps) {
  if (mirrorMode === 'domProjection' && sessionId && token) {
    return (
      <DomProjector
        width={viewportProps.width}
        height={viewportProps.height}
        live={viewportProps.live}
        sessionId={sessionId}
        token={token}
        assetBaseUrl={assetBaseUrl}
        attachDomDiffSink={attachDomDiffSink}
        onDomInput={onDomInput}
        requestRemoteResize={viewportProps.requestRemoteResize}
        viewportPolicy={viewportProps.viewportPolicy}
        onCanvasLayout={viewportProps.onCanvasLayout}
        onRemoteViewportApplied={viewportProps.onRemoteViewportApplied}
        presentation={viewportProps.presentation}
        className={viewportProps.className}
        label={viewportProps.label}
      />
    )
  }

  return (
    <SessionViewport
      {...viewportProps}
      attachFrameSink={attachFrameSink}
      onInput={onInput}
    />
  )
}

export type { CanvasSize }
