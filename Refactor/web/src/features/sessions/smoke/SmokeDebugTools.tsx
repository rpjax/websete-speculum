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

import { SmokeConsolePanel } from './SmokeConsolePanel'

import { SmokeEngineConfigPanel } from './SmokeEngineConfigPanel'

import { SmokeEvalPanel } from './SmokeEvalPanel'

import { SmokeEventFeed } from './SmokeEventFeed'

import { SmokeJournalFeed } from './SmokeJournalFeed'

import { SmokeTelemetryPanel } from './SmokeTelemetryPanel'

import { SmokeWireSettings } from './SmokeWireSettings'

import type { JournalFeed } from './useJournalFeed'

import type { SmokeOrigins } from './smokeConfig'

import type { SmokeConsoleLine } from './smokeConsole'

import type { SmokeLogEntry } from './smokeLog'

import type { SmokeStats } from './useSmokeSession'

import type { EvalResult, SessionStatus } from '@/lib/speculum'



interface SmokeDebugToolsProps {

  stats: SmokeStats

  status: SessionStatus | null

  live: boolean

  entries: SmokeLogEntry[]

  consoleLines: SmokeConsoleLine[]

  journal: JournalFeed

  origins: SmokeOrigins

  connectionId: string | null

  profileId: string | null

  sessionId: string | null

  wireDisabled: boolean

  onRunConsoleCommand: (code: string) => Promise<void>

  onClearConsole: () => void

  onEvaluate: (code: string) => Promise<EvalResult | void>

  onApplyOrigins: (next: SmokeOrigins) => void

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

    blurb: 'Dev backdoor — Hosting + Navigation allowlist via IConfigurationService.',

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

export function SmokeDebugTools({

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

}: SmokeDebugToolsProps) {

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

            <SmokeTelemetryPanel stats={stats} status={status} live={live} />

          )}

          {tool.value === 'activity' && <SmokeEventFeed entries={entries} />}

          {tool.value === 'journal' && <SmokeJournalFeed feed={journal} />}

          {tool.value === 'console' && (

            <SmokeConsolePanel

              live={live}

              jsBridgeEnabled={jsBridgeEnabled}

              lines={consoleLines}

              onClear={onClearConsole}

              onRunCommand={onRunConsoleCommand}

            />

          )}

          {tool.value === 'eval' && (

            <SmokeEvalPanel

              live={live}

              jsBridgeEnabled={jsBridgeEnabled}

              onEvaluate={onEvaluate}

            />

          )}

          {tool.value === 'config' && (

            <SmokeEngineConfigPanel hubOrigin={origins.hubOrigin} sessionLive={live} />

          )}

          {tool.value === 'wire' && (

            <SmokeWireSettings

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

