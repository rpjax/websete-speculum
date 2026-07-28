import {

  Cable,

  Code2,

  Gauge,

  ListTree,

  ScrollText,

  Settings2,

  TerminalSquare,

} from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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



interface LabDebugToolsProps {

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



const TOOLS = [

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

    blurb: 'Facts the API admitted (catalog truth).',

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

    blurb: 'Get StartSession ready — browse target, capacity, and lab probes.',

  },

  {

    value: 'wire',

    label: 'Wire',

    icon: Cable,

    blurb: 'Hub / transport origins and session identity.',

  },

] as const



/**

 * Semantic debug toolbox around the shared session viewport.

 * One job per tab; labels describe what the stream means, not just a dump.

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

  const jsBridgeEnabled = status ? status.jsBridgeEnabled : null



  return (

    <Tabs defaultValue="stream" className="flex h-full min-h-0 flex-col">

      <div className="space-y-2">

        <div>

          <p className="text-xs font-semibold tracking-wide text-foreground">Debug tools</p>

          <p className="text-[11px] text-muted-foreground">

            Observe the same session the canvas drives — stream health, admitted facts, wire

            identity.

          </p>

        </div>

        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">

          {TOOLS.map((tool) => {

            const Icon = tool.icon

            return (

              <TabsTrigger key={tool.value} value={tool.value} className="gap-1.5">

                <Icon className="h-3.5 w-3.5" />

                {tool.label}

              </TabsTrigger>

            )

          })}

        </TabsList>

      </div>



      {TOOLS.map((tool) => (

        <TabsContent

          key={tool.value}

          value={tool.value}

          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"

        >

          {tool.value !== 'console' && (

            <p className="mb-3 shrink-0 text-[11px] text-muted-foreground">{tool.blurb}</p>

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

