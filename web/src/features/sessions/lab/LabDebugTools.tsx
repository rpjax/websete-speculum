import {
  Code2,
  Download,
  Gauge,
  ListTree,
  ScrollText,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  loadLabDebugTab,
  saveLabDebugTab,
  type LabDebugTab,
} from '@/features/sessions/live/sessionConfig'
import { LabConsolePanel } from './LabConsolePanel'
import { LabEngineConfigPanel } from './LabEngineConfigPanel'
import { LabEvalPanel } from './LabEvalPanel'
import { LabEventFeed } from './LabEventFeed'
import { LabJournalFeed } from './LabJournalFeed'
import { buildLabFrontLogExport, downloadLabFrontLogJson } from './labLogExport'
import { LabTelemetryPanel } from './LabTelemetryPanel'
import type { JournalFeed } from './useJournalFeed'
import type { LabOrigins } from './labConfig'
import type { LabConsoleLine } from './labConsole'
import type { LabLogEntry } from './labLog'
import type { LabStats } from './useLabSession'
import type { EvalResult, SessionStatus } from '@/lib/speculum'

export interface LabDebugToolsProps {
  stats: LabStats
  status: SessionStatus | null
  live: boolean
  entries: LabLogEntry[]
  consoleLines: LabConsoleLine[]
  journal: JournalFeed
  origins: LabOrigins
  connectionId: string | null
  profileId: string | null
  sessionId: string | null
  onRunConsoleCommand: (code: string) => Promise<void>
  onClearConsole: () => void
  onEvaluate: (code: string) => Promise<EvalResult | void>
  onForgetProfile: () => void
  /** Telemetry.ClientObservation.isEnabled from client-config. */
  observationEnabled?: boolean
  onClientConfigApplied?: () => void
}

const TOOLS: {
  value: LabDebugTab
  label: string
  icon: typeof Gauge
  blurb: string
}[] = [
  {
    value: 'stream',
    label: 'Stream',
    icon: Gauge,
    blurb: 'Frame rate, lag, and unary status snapshot.',
  },
  {
    value: 'activity',
    label: 'Activity',
    icon: ListTree,
    blurb: 'Client-side hub / data-plane events from this tab.',
  },
  {
    value: 'journal',
    label: 'Journal',
    icon: ScrollText,
    blurb: 'Admitted facts (domain narrative + Telemetry hops). Filter input path here while debugging delay.',
  },
  {
    value: 'console',
    label: 'Console',
    icon: TerminalSquare,
    blurb: 'Chrome DevTools Console — remote console.* + JsBridge prompt.',
  },
  {
    value: 'eval',
    label: 'Eval',
    icon: Code2,
    blurb: 'One-shot JsBridge evaluate with an explicit result pane.',
  },
  {
    value: 'config',
    label: 'Config',
    icon: Settings2,
    blurb: 'Session readiness, Telemetry sampling, and the full Telemetry.Sessions event catalog.',
  },
]

/**
 * Semantic debug toolbox around the shared session viewport.
 * One job per tab; last tab persisted for delay workflows.
 */
export function LabDebugTools({
  stats,
  status,
  live,
  entries,
  consoleLines,
  journal,
  origins,
  connectionId,
  profileId,
  sessionId,
  onRunConsoleCommand,
  onClearConsole,
  onEvaluate,
  onForgetProfile,
  observationEnabled = false,
  onClientConfigApplied,
}: LabDebugToolsProps) {
  const [tab, setTab] = useState<LabDebugTab>(loadLabDebugTab)
  const jsBridgeEnabled = status ? status.jsBridgeEnabled : null

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = value as LabDebugTab
        setTab(next)
        saveLabDebugTab(next)
      }}
      className="flex flex-col"
    >
      <div className="mb-3 flex items-center gap-2">
        <TabsList className="flex h-auto flex-1 flex-nowrap justify-start gap-1 overflow-x-auto bg-card [scrollbar-width:thin]">
          {TOOLS.map((tool) => {
            const Icon = tool.icon
            return (
              <TabsTrigger
                key={tool.value}
                value={tool.value}
                className="shrink-0 gap-1.5 px-2.5 text-xs sm:px-3 sm:text-sm"
                title={tool.blurb}
              >
                <Icon className="h-3.5 w-3.5" />
                {tool.label}
              </TabsTrigger>
            )
          })}
        </TabsList>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 text-xs"
          disabled={entries.length === 0 && consoleLines.length === 0}
          title="Export Activity + Console as a single JSON file"
          onClick={() =>
            downloadLabFrontLogJson(buildLabFrontLogExport(entries, consoleLines, sessionId))
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export JSON
        </Button>
      </div>

      {TOOLS.map((tool) => (
        <TabsContent
          key={tool.value}
          value={tool.value}
          className="mt-0 data-[state=inactive]:hidden"
        >
          {tool.value !== 'console' && (
            <p className="mb-3 text-[11px] text-muted-foreground">{tool.blurb}</p>
          )}
          {tool.value === 'stream' && (
            <LabTelemetryPanel stats={stats} status={status} live={live} />
          )}
          {tool.value === 'activity' && (
            <LabEventFeed
              entries={entries}
              observationEnabled={observationEnabled}
            />
          )}
          {tool.value === 'journal' && <LabJournalFeed feed={journal} />}
          {tool.value === 'console' && (
            <LabConsolePanel
              live={live}
              jsBridgeEnabled={jsBridgeEnabled}
              lines={consoleLines}
              onClear={onClearConsole}
              onRunCommand={onRunConsoleCommand}
            />
          )}
          {tool.value === 'eval' && (
            <LabEvalPanel
              live={live}
              jsBridgeEnabled={jsBridgeEnabled}
              onEvaluate={onEvaluate}
            />
          )}
          {tool.value === 'config' && (
            <div className="space-y-4">
              <LabEngineConfigPanel
                hubOrigin={origins.hubOrigin}
                sessionLive={live}
                onClientConfigApplied={onClientConfigApplied}
              />
              <div className="space-y-3 border-t border-border pt-3">
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Connection</dt>
                  <dd className="truncate font-mono">{connectionId ?? '—'}</dd>
                  <dt className="text-muted-foreground">Profile</dt>
                  <dd className="truncate font-mono">{profileId ?? 'created on first start'}</dd>
                  <dt className="text-muted-foreground">Session</dt>
                  <dd className="truncate font-mono">{sessionId ?? '—'}</dd>
                </dl>
                <Button size="sm" variant="outline" onClick={onForgetProfile} disabled={live}>
                  Forget profile
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
