import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionViewport } from '@/features/sessions/live/SessionViewport'
import {
  parseClientNavigation,
  toClientAddressBar,
} from '@/features/sessions/live/sessionCoords'
import { LabDebugTools } from './LabDebugTools'
import { LabToolbar } from './LabToolbar'
import { useLabSession } from './useLabSession'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * Session lab: shared {@link useLiveSession} + {@link SessionViewport}
 * plus debug chrome. Product path identical to `/live`; only observation UI and
 * the configurations editor differ.
 */
export default function SessionLabPage() {
  const [address, setAddress] = useState('www.google.com')
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

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground">
        <header className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <span className="text-xs font-semibold tracking-widest text-muted-foreground">
                SPECULUM
              </span>
              <h1 className="text-lg font-semibold">Session lab</h1>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Same session client as production — chrome is debug-only.
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
          />
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <section className="flex min-h-0 flex-col gap-2">
            <div className="relative min-h-[20rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card lg:min-h-0">
              <SessionViewport
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
              />
              {!session.isLive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="max-w-sm rounded-md bg-background/90 px-4 py-3 text-center text-sm text-muted-foreground">
                    Start a session to stream frames. Focus the canvas, then move, click, scroll,
                    type, or touch — inputs share the production data plane.
                  </p>
                </div>
              )}
              {session.isLive && session.touchPrimary && (
                <Button
                  type="button"
                  size="sm"
                  className="absolute bottom-3 right-3 shadow"
                  onClick={() => session.openKeyboard()}
                >
                  Keyboard
                </Button>
              )}
            </div>
          </section>

          <aside className="min-h-[24rem] min-w-0 lg:min-h-0">
            <LabDebugTools
              stats={session.stats}
              status={session.status}
              live={session.isLive}
              entries={session.entries}
              consoleLines={session.consoleLines}
              journal={session.journal}
              origins={session.origins}
              connectionId={session.connectionId}
              profileId={session.profileId}
              sessionId={session.sessionId}
              wireDisabled={session.isLive}
              onRunConsoleCommand={session.runConsoleCommand}
              onClearConsole={session.clearConsole}
              onEvaluate={session.evaluate}
              onApplyOrigins={session.applyOrigins}
              onForgetProfile={session.forgetProfile}
            />
          </aside>
        </div>
      </div>
    </TooltipProvider>
  )
}
