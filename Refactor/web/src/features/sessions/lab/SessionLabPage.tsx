import { useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  loadLabDebugDockOpen,
  saveLabDebugDockOpen,
} from '@/features/sessions/live/sessionConfig'
import {
  parseClientNavigation,
  toClientAddressBar,
} from '@/features/sessions/live/sessionCoords'
import { LabCanvasStage } from './LabCanvasStage'
import { LabDebugDock } from './LabDebugDock'
import { LabToolbar } from './LabToolbar'
import { useLabSession } from './useLabSession'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Session lab (`/lab`, or `/` under Vite DEV): canvas + optional debug dock.
 * Production product surface is immersive `/` + `/live` — canvas only.
 */
export default function SessionLabPage() {
  const [address, setAddress] = useState('www.google.com')
  const [debugOpen, setDebugOpen] = useState(loadLabDebugDockOpen)
  const addressFocusedRef = useRef(false)
  const session = useLabSession(VIEWPORT)

  useEffect(() => {
    if (!session.currentUrl || addressFocusedRef.current) {
      return
    }
    setAddress(toClientAddressBar(session.currentUrl))
  }, [session.currentUrl])

  const handleStart = () => {
    const { path, query } = parseClientNavigation(address)
    void session.start(path, query)
  }

  const handleNavigate = () => {
    const { path, query } = parseClientNavigation(address)
    void session.navigate(path, query)
  }

  const setDebugDock = (open: boolean) => {
    setDebugOpen(open)
    saveLabDebugDockOpen(open)
  }

  const debugToolsProps = {
    stats: session.stats,
    status: session.status,
    live: session.isLive,
    entries: session.entries,
    consoleLines: session.consoleLines,
    journal: session.journal,
    origins: session.origins,
    connectionId: session.connectionId,
    profileId: session.profileId,
    sessionId: session.sessionId,
    wireDisabled: session.isLive,
    onRunConsoleCommand: session.runConsoleCommand,
    onClearConsole: session.clearConsole,
    onEvaluate: session.evaluate,
    onApplyOrigins: session.applyOrigins,
    onForgetProfile: session.forgetProfile,
  }

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col gap-3 bg-background p-3 text-foreground">
        <header className="shrink-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <span className="text-xs font-semibold tracking-widest text-muted-foreground">
                SPECULUM
              </span>
              <h1 className="text-base font-semibold">Session lab</h1>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Canvas is the product surface — Debug opens Journal, Config, Wire, and the rest.
            </p>
          </div>
          <LabToolbar
            phase={session.phase}
            address={address}
            currentUrl={session.currentUrl}
            onAddressChange={setAddress}
            onAddressFocusChange={(focused) => {
              addressFocusedRef.current = focused
            }}
            onStart={handleStart}
            onStop={() => void session.stop()}
            onNavigate={handleNavigate}
            onStatus={() => void session.pollStatus()}
            onHistory={(direction) => session.sendInput({ type: direction })}
            debugAvailable
            debugOpen={debugOpen}
            onDebugOpenChange={setDebugDock}
          />
        </header>

        <div
          className={
            debugOpen
              ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden transition-[gap] duration-200 xl:flex-row'
              : 'flex min-h-0 flex-1 flex-col overflow-hidden'
          }
        >
          <LabCanvasStage
            className={
              debugOpen
                ? 'relative min-h-0 min-w-0 flex-[3] overflow-hidden rounded-lg border border-border bg-card xl:min-w-[28rem]'
                : 'relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card'
            }
            width={session.remoteViewport.width}
            height={session.remoteViewport.height}
            live={session.isLive}
            attachFrameSink={session.attachFrameSink}
            onInput={session.sendInput}
            requestRemoteResize={session.requestRemoteResize}
            viewportPolicy={session.viewportPolicy ?? undefined}
            onCanvasLayout={session.onCanvasLayout}
            onRemoteViewportApplied={session.onRemoteViewportApplied}
            touchPrimary={session.touchPrimary}
            editingActive={session.editing != null}
            keyboardNonce={session.keyboardNonce}
            onOpenKeyboard={() => session.openKeyboard()}
          />

          {debugOpen && (
            <LabDebugDock
              className="flex min-h-0 min-w-0 flex-[2] flex-col overflow-hidden rounded-lg border border-border bg-card xl:min-w-[22rem]"
              onCollapse={() => setDebugDock(false)}
              {...debugToolsProps}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
