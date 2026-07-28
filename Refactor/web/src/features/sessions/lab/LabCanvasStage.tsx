import { Button } from '@/components/ui/button'
import {
  SessionViewport,
  type SessionViewportProps,
} from '@/features/sessions/live/SessionViewport'

type LabCanvasStageProps = Pick<
  SessionViewportProps,
  | 'width'
  | 'height'
  | 'live'
  | 'attachFrameSink'
  | 'onInput'
  | 'requestRemoteResize'
  | 'viewportPolicy'
  | 'onCanvasLayout'
  | 'onRemoteViewportApplied'
  | 'touchPrimary'
  | 'editingActive'
  | 'keyboardNonce'
> & {
  onOpenKeyboard: () => void
  /** Extra class on the stage shell (flex sizing from parent). */
  className?: string
}

/**
 * Session canvas stage — primary Lab surface. Empty/live overlays only.
 */
export function LabCanvasStage({
  width,
  height,
  live,
  attachFrameSink,
  onInput,
  requestRemoteResize,
  viewportPolicy,
  onCanvasLayout,
  onRemoteViewportApplied,
  touchPrimary,
  editingActive,
  keyboardNonce,
  onOpenKeyboard,
  className,
}: LabCanvasStageProps) {
  return (
    <div
      className={
        className
        ?? 'relative min-h-[20rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card'
      }
    >
      <SessionViewport
        width={width}
        height={height}
        live={live}
        attachFrameSink={attachFrameSink}
        onInput={onInput}
        requestRemoteResize={requestRemoteResize}
        viewportPolicy={viewportPolicy}
        onCanvasLayout={onCanvasLayout}
        onRemoteViewportApplied={onRemoteViewportApplied}
        touchPrimary={touchPrimary}
        editingActive={editingActive}
        keyboardNonce={keyboardNonce}
      />
      {!live && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm rounded-md bg-background/90 px-4 py-3 text-center text-sm text-muted-foreground">
            Start a session to stream frames. Focus the canvas, then move, click, scroll, type, or
            touch — inputs share the production data plane.
          </p>
        </div>
      )}
      {live && touchPrimary && (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-3 right-3 shadow"
          onClick={onOpenKeyboard}
        >
          Keyboard
        </Button>
      )}
    </div>
  )
}
