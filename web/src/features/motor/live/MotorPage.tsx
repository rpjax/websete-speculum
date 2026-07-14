import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMotorHub } from './useMotorHub'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function statusTone(status: string): 'success' | 'warning' | 'destructive' | 'muted' {
  if (status === 'connected') return 'success'
  if (status === 'connecting') return 'warning'
  if (status === 'error') return 'destructive'
  return 'muted'
}

export default function MotorPage() {
  const { canvasRef, viewportRef, urlBarRef, ui, connect, goBack, goForward } = useMotorHub()
  const showFps =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname.endsWith('.localhost')
  const showDiag =
    import.meta.env.DEV || new URLSearchParams(window.location.search).get('diag') === '1'

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">SPECULUM</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={ui.navDisabled}
                onClick={goBack}
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={ui.navDisabled}
                onClick={goForward}
                aria-label="Forward"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Input
            ref={urlBarRef}
            className="flex-1"
            placeholder="—"
            spellCheck={false}
            disabled={ui.navDisabled}
            aria-label="Address bar"
          />
          <Badge variant={statusTone(ui.status)}>{ui.statusText}</Badge>
          {showFps && ui.fps !== null && (
            <span className="min-w-[52px] text-right text-xs tabular-nums text-muted-foreground">
              {ui.fps} fps
            </span>
          )}
        </div>

        {showDiag && (
          <div className="shrink-0 border-b border-border bg-sidebar px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
            {ui.correlationId && <span className="mr-3">corr={ui.correlationId.slice(0, 12)}</span>}
            {ui.connectionId && <span className="mr-3">conn={ui.connectionId.slice(0, 12)}</span>}
            {ui.persistedSessionId && (
              <span className="mr-3">persisted={ui.persistedSessionId.slice(0, 12)}</span>
            )}
            {ui.sidecarSessionId && <span>sidecar={ui.sidecarSessionId.slice(0, 8)}</span>}
          </div>
        )}

        <div ref={viewportRef} className="relative min-h-0 flex-1 touch-none">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full cursor-default touch-none"
          />
          {ui.showOverlay && (
            <div
              className={cn(
                'absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/85',
              )}
            >
              <div className="max-w-sm space-y-2 px-6 text-center">
                <p className="text-base font-medium">
                  {ui.status === 'connecting' ? 'Connecting to remote browser…' : 'Remote browser not connected'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {ui.status === 'error'
                    ? ui.statusText || 'Connection failed. Retry when the motor and sidecar are ready.'
                    : 'Connect to start a live session on this motor.'}
                </p>
              </div>
              {ui.status !== 'connecting' && (
                <Button onClick={() => void connect()}>
                  {ui.status === 'error' ? 'Retry connection' : 'Connect'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
