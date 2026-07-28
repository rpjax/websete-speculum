import {
  Cable,
  Code2,
  Gauge,
  ListTree,
  ScrollText,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import { useState } from 'react'
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
import { LabTelemetryPanel } from './LabTelemetryPanel'
import { LabWireSettings } from './LabWireSettings'
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
  wireDisabled: boolean
  onRunConsoleCommand: (code: string) => Promise<void>
  onClearConsole: () => void
  onEvaluate: (code: string) => Promise<EvalResult | void>
  onApplyOrigins: (next: LabOrigins) => void
  onForgetProfile: () => void
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
  {
    value: 'wire',
    label: 'Wire',
    icon: Cable,
    blurb: 'Hub / transport origins, identity, and client_sent input-path hop.',
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
  wireDisabled,
  onRunConsoleCommand,
  onClearConsole,
  onEvaluate,
  onApplyOrigins,
  onForgetProfile,
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
      <TabsList className="mb-3 flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto bg-card [scrollbar-width:thin]">
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
          {tool.value === 'activity' && <LabEventFeed entries={entries} />}
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
            <LabEngineConfigPanel hubOrigin={origins.hubOrigin} sessionLive={live} />
          )}
          {tool.value === 'wire' && (
            <LabWireSettings
              origins={origins}
              connectionId={connectionId}
              profileId={profileId}
              sessionId={sessionId}
              disabled={wireDisabled}
              onApply={onApplyOrigins}
              onForgetProfile={onForgetProfile}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
