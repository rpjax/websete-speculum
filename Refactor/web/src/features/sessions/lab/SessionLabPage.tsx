import { useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  loadLabDebugDockOpen,
  saveLabDebugDockOpen,
} from '@/features/sessions/live/sessionConfig'
import {
  parseClientNavigation,
} from '@/features/sessions/live/sessionCoords'
import { resolveLabNavigateWire } from '@/features/sessions/live/sessionUrlSync'
import { LabCanvasStage } from './LabCanvasStage'
import { LabDebugDock } from './LabDebugDock'
import { LabToolbar } from './LabToolbar'
import { useLabSession } from './useLabSession'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Session lab (`/` / `/lab`): canvas + Debug dock.
 * Dock sizes to its content (page scrolls) — no clipped inner pane.
 * Immersive prod preview (canvas only) is `/live`.
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
    // currentUrl is already address-bar display (SyncUrl/status projection).
    setAddress(session.currentUrl)
  }, [session.currentUrl])

  const handleStart = () => {
    const { path, query } = parseClientNavigation(address)
    void session.start(path, query)
  }

  const handleNavigate = () => {
    const wire = resolveLabNavigateWire({
      address,
      currentUrl: session.currentUrl,
      navigateHref: session.navigateHref,
    })
    const { path, query } = parseClientNavigation(wire)
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
      <div
        className={
          debugOpen
            ? 'flex min-h-dvh flex-col gap-3 bg-background p-3 text-foreground'
            : 'flex h-dvh flex-col gap-3 overflow-hidden bg-background p-3 text-foreground'
        }
      >
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
              ? 'flex flex-col gap-3 lg:flex-row lg:items-start'
              : 'flex min-h-0 flex-1 flex-col overflow-hidden'
          }
        >
          <LabCanvasStage
            className={
              debugOpen
                ? 'relative h-[min(45dvh,22rem)] w-full shrink-0 overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-3 lg:h-[calc(100dvh-5.5rem)] lg:min-w-0 lg:flex-[3]'
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
              className="flex w-full shrink-0 flex-col rounded-lg border border-border bg-card lg:min-w-[22rem] lg:flex-[2]"
              onCollapse={() => setDebugDock(false)}
              {...debugToolsProps}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
