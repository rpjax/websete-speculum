import { API_URL } from '@/lib/env'
import {
  SessionMirrorSurface,
  type SessionMirrorSurfaceProps,
} from '@/features/sessions/live/SessionMirrorSurface'

type LabCanvasStageProps = Pick<
  SessionMirrorSurfaceProps,
  | 'width'
  | 'height'
  | 'live'
  | 'attachFrameSink'
  | 'attachDomDiffSink'
  | 'onInput'
  | 'onDomInput'
  | 'onDiffObserve'
  | 'requestRemoteResize'
  | 'viewportPolicy'
  | 'onCanvasLayout'
  | 'onRemoteViewportApplied'
  | 'touchPrimary'
  | 'editingActive'
  | 'keyboardNonce'
  | 'deviceScaleFactor'
  | 'maxEncodeScale'
> & {
  mirrorMode: import('@/lib/speculum').MirrorMode
  sessionId: string | null
  token: string | null
  /** Extra class on the stage shell (flex sizing from parent). */
  className?: string
}

/**
 * Session mirror stage — primary Lab surface (video canvas or Dom projector).
 */
export function LabCanvasStage({
  mirrorMode,
  sessionId,
  token,
  width,
  height,
  live,
  attachFrameSink,
  attachDomDiffSink,
  onInput,
  onDomInput,
  onDiffObserve,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
  touchPrimary,
  editingActive,
  keyboardNonce,
  deviceScaleFactor,
  maxEncodeScale,
  className,
}: LabCanvasStageProps) {
  return (
    <div
      className={
        className
        ?? 'relative min-h-[20rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card'
      }
    >
      <SessionMirrorSurface
        mirrorMode={mirrorMode}
        sessionId={sessionId}
        token={token}
        assetBaseUrl={API_URL}
        width={width}
        height={height}
        live={live}
        attachFrameSink={attachFrameSink}
        attachDomDiffSink={attachDomDiffSink}
        onInput={onInput}
        onDomInput={onDomInput}
        onDiffObserve={onDiffObserve}
        requestRemoteResize={requestRemoteResize}
        viewportPolicy={viewportPolicy}
        onCanvasLayout={onCanvasLayout}
        onRemoteViewportApplied={onRemoteViewportApplied}
        touchPrimary={touchPrimary}
        editingActive={editingActive}
        keyboardNonce={keyboardNonce}
        deviceScaleFactor={deviceScaleFactor}
        maxEncodeScale={maxEncodeScale}
      />
      {!live && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm rounded-md bg-background/90 px-4 py-3 text-center text-sm text-muted-foreground">
            Start a session to stream the mirror. Focus the surface, then interact —
            inputs share the production data plane.
          </p>
        </div>
      )}
    </div>
  )
}
