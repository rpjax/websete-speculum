import { useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SmokeCanvas } from './SmokeCanvas'
import { SmokeConsolePanel } from './SmokeConsolePanel'
import { SmokeEventFeed } from './SmokeEventFeed'
import { SmokeJournalFeed } from './SmokeJournalFeed'
import { SmokeTelemetryPanel } from './SmokeTelemetryPanel'
import { SmokeToolbar } from './SmokeToolbar'
import { SmokeWireSettings } from './SmokeWireSettings'
import { useSmokeSession } from './useSmokeSession'

const VIEWPORT = { width: 1280, height: 720 }

/**
 * End-to-end smoke surface for the refactored wire: SignalR control plane,
 * WebTransport data plane, every input type and live stream telemetry.
 */
export default function SessionSmokePage() {
  const [path, setPath] = useState('/')
  const session = useSmokeSession(VIEWPORT)

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground">
        <header className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-xs font-semibold tracking-widest text-muted-foreground">
              SPECULUM
            </span>
            <h1 className="text-lg font-semibold">Session smoke</h1>
          </div>
          <SmokeToolbar
            phase={session.phase}
            path={path}
            currentUrl={session.currentUrl}
            onPathChange={setPath}
            onStart={() => void session.start(path)}
            onStop={() => void session.stop()}
            onStatus={() => void session.pollStatus()}
            onHistory={(direction) => session.sendInput({ type: direction })}
          />
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="flex min-h-0 flex-col gap-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
              <SmokeCanvas
                width={VIEWPORT.width}
                height={VIEWPORT.height}
                live={session.isLive}
                attachFrameSink={session.attachFrameSink}
                onInput={session.sendInput}
              />
              {!session.isLive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="max-w-sm rounded-md bg-background/90 px-4 py-3 text-center text-sm text-muted-foreground">
                    Start a session to stream frames. Click the canvas first, then move, scroll,
                    type or touch — every input type is forwarded on the user-input pipe.
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Mouse move / down / up · wheel · key down / up · type · text · touch · history —
              focus the canvas for keyboard input.
            </p>
          </section>

          <aside className="min-w-0">
            <Tabs defaultValue="telemetry">
              <TabsList>
                <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
                <TabsTrigger value="events">Events</TabsTrigger>
                <TabsTrigger value="journal">Journal</TabsTrigger>
                <TabsTrigger value="console">Console</TabsTrigger>
                <TabsTrigger value="wire">Wire</TabsTrigger>
              </TabsList>
              <TabsContent value="telemetry">
                <SmokeTelemetryPanel
                  stats={session.stats}
                  status={session.status}
                  live={session.isLive}
                />
              </TabsContent>
              <TabsContent value="events">
                <SmokeEventFeed entries={session.entries} />
              </TabsContent>
              <TabsContent value="journal">
                <SmokeJournalFeed feed={session.journal} />
              </TabsContent>
              <TabsContent value="console">
                <SmokeConsolePanel
                  live={session.isLive}
                  onEvaluate={(code) => void session.evaluate(code)}
                  onSendText={(text) => session.sendInput({ type: 'text', text, source: 'smoke' })}
                />
              </TabsContent>
              <TabsContent value="wire">
                <SmokeWireSettings
                  origins={session.origins}
                  connectionId={session.connectionId}
                  profileId={session.profileId}
                  sessionId={session.sessionId}
                  disabled={session.isLive}
                  onApply={session.applyOrigins}
                  onForgetProfile={session.forgetProfile}
                />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  )
}
