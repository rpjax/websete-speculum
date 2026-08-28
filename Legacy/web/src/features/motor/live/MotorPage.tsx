import { ChevronLeft, ChevronRight, Keyboard } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useMotorHub } from './useMotorHub'
import { MOCK_MODE } from '@/lib/env'
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

type ImeInputMode = NonNullable<ComponentProps<'textarea'>['inputMode']>

function toImeInputMode(raw: string | undefined): ImeInputMode {
  const allowed: ImeInputMode[] = [
    'none', 'text', 'tel', 'url', 'email', 'numeric', 'decimal', 'search',
  ]
  return (allowed.includes(raw as ImeInputMode) ? raw : 'text') as ImeInputMode
}

function MockMotorPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">SPECULUM</span>
        <Button variant="outline" size="icon" disabled aria-label="Back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" disabled aria-label="Forward">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Input className="flex-1" placeholder="https://www.example.com/" spellCheck={false} disabled aria-label="Address bar" />
        <Badge variant="muted">Mock</Badge>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/85')}>
          <div className="max-w-sm space-y-2 px-6 text-center">
            <p className="text-base font-medium">Mock mode active</p>
            <p className="text-sm text-muted-foreground">
              Motor live browsing requires a running backend with SignalR.
              Use the Admin and Setup surfaces to develop UI with mocked data.
            </p>
          </div>
          <Button variant="outline" onClick={() => { window.location.href = '/admin' }}>
            Go to Admin
          </Button>
        </div>
      </div>
    </div>
  )
}

function RealMotorPage() {
  const {
    canvasRef, viewportRef, urlBarRef, imeRef, ui,
    connect, goBack, goForward, openVirtualKeyboard,
  } = useMotorHub()
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
          {ui.showKeyboard && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => openVirtualKeyboard()}
                  aria-label="Show keyboard"
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show keyboard</TooltipContent>
            </Tooltip>
          )}
          <Badge variant={statusTone(ui.status)}>{ui.statusText}</Badge>
          {showFps && ui.fps !== null && (
            <span className="min-w-[52px] text-right text-xs tabular-nums text-muted-foreground">
              {ui.fps} fps
            </span>
          )}
        </div>

        {ui.resizeWarning && (
          <div
            role="status"
            className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          >
            {ui.resizeWarning}
          </div>
        )}

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
          <textarea
            ref={imeRef}
            aria-label="Remote text input"
            inputMode={toImeInputMode(ui.editing?.inputMode)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="pointer-events-none absolute h-px w-px opacity-0"
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

export default function MotorPage() {
  return MOCK_MODE ? <MockMotorPage /> : <RealMotorPage />
}
