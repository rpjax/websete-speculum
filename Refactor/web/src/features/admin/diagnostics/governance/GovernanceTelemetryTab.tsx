import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DiagnosticsOptions } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import {
  Activity,
  Database,
  Gauge,
  HardDrive,
  HelpCircle,
  Info,
  Radar,
  Server,
  Shield,
} from 'lucide-react'

interface GovernanceTelemetryTabProps {
  config: DiagnosticsOptions
  onChange: (next: DiagnosticsOptions) => void
}

const INTERVAL_PRESETS = [
  { seconds: 10, label: '10s', hint: 'Assertive / hot debug' },
  { seconds: 15, label: '15s', hint: 'Development' },
  { seconds: 30, label: '30s', hint: 'Production default' },
  { seconds: 60, label: '60s', hint: 'Quiet / capacity-light' },
] as const

export function GovernanceTelemetryTab({ config, onChange }: GovernanceTelemetryTabProps) {
  const t = config.telemetry
  const sectionCount = [
    t.host.enabled,
    t.apiProcess.enabled,
    t.sessions.enabled,
    t.sidecar.enabled,
    t.profiles.enabled,
    t.journal.enabled,
    t.docker.enabled,
  ].filter(Boolean).length

  function patchTelemetry(patch: Partial<DiagnosticsOptions['telemetry']>) {
    onChange({ ...config, telemetry: { ...t, ...patch } })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
        <Radar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm leading-relaxed">
          <p className="font-medium">What is telemetry here?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            On a fixed interval Speculum builds <strong className="font-medium text-foreground">one composite
            sample</strong> (
            <code className="rounded bg-muted px-1">Telemetry.SampleCollected</code>
            ) with optional sections for machine, API process, sessions, sidecar, profiles, Journal,
            and Docker. Charts live under Telemetry Monitor; this tab only chooses what goes into each sample.
          </p>
        </div>
      </div>

      <section className={cn('rounded-xl border bg-card', t.enabled ? 'border-border' : 'border-warning/30')}>
        <header className="flex items-start gap-3 border-b border-border/50 px-4 py-3.5 sm:px-5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Sampler master</h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  When off, no composite samples are emitted. Section toggles below only matter when the sampler is on.
                </p>
              </div>
              <Switch id="tel-enabled" checked={t.enabled} onCheckedChange={(enabled) => patchTelemetry({ enabled })} />
            </div>
          </div>
        </header>

        <div className={cn('space-y-4 p-4 sm:p-5', !t.enabled && 'opacity-60')}>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-sm font-medium">Sample interval</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                  How often a new composite sample is taken (1–3600s). Faster intervals fill Journal quicker.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="mb-2.5 text-[11px] text-muted-foreground leading-relaxed">
              One sample every N seconds across the whole process, not per session.
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.seconds}
                  type="button"
                  disabled={!t.enabled}
                  onClick={() => patchTelemetry({ intervalSeconds: p.seconds })}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
                    t.intervalSeconds === p.seconds
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/30',
                  )}
                >
                  {p.label}
                  <span className="ml-1 opacity-60">· {p.hint.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                className="h-9 w-24 text-sm"
                min={1}
                max={3600}
                disabled={!t.enabled}
                value={t.intervalSeconds}
                onChange={(e) =>
                  patchTelemetry({
                    intervalSeconds: Math.min(3600, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
              />
              <span className="text-xs text-muted-foreground">
                seconds · ~{Math.round(3600 / Math.max(1, t.intervalSeconds)).toLocaleString()} samples / hour
              </span>
            </div>
          </div>

          {!t.enabled && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning leading-relaxed">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sampler is off in the draft. Telemetry Monitor will go quiet after Save until you re-enable.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border/50 px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Sample sections</h3>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                Each section is a slice of the same composite sample. Off sections are omitted from the payload.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {sectionCount} of 7 included
            </span>
          </div>
        </header>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <SectionCard
            icon={<Server className="h-3.5 w-3.5" />}
            title="Machine"
            summary="Host CPU, memory, disk, and network"
            detail="Machine CPU, CPU count, available memory, disk capacity, and optional load/swap/network overlays."
            checked={t.host.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ host: { ...t.host, enabled: v } })}
          />
          <SectionCard
            icon={<Activity className="h-3.5 w-3.5" />}
            title="API process"
            summary="Speculum.Api process and CLR"
            detail="Process CPU, working set, threads, and optional private-memory / GC / thread-pool overlays."
            checked={t.apiProcess.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ apiProcess: { ...t.apiProcess, enabled: v } })}
          />
          <SectionCard
            icon={<Activity className="h-3.5 w-3.5" />}
            title="Sessions"
            summary="Live browsing load and capacity"
            detail="Live session totals, capacity used, FPS aggregates, and optional per-session identity overlays."
            checked={t.sessions.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ sessions: { ...t.sessions, enabled: v } })}
          />
          <SectionCard
            icon={<Radar className="h-3.5 w-3.5" />}
            title="Sidecar"
            summary="Browser-process health"
            detail="Sidecar process, event-loop, browser/page totals, bridge queues, and faulted session summary."
            checked={t.sidecar.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, enabled: v } })}
          />
          <SectionCard
            icon={<Database className="h-3.5 w-3.5" />}
            title="Profiles"
            summary="Stored profile/database footprint"
            detail="Profile totals and optional storage footprint from the shared Speculum database."
            checked={t.profiles.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ profiles: { ...t.profiles, enabled: v } })}
          />
          <SectionCard
            icon={<HardDrive className="h-3.5 w-3.5" />}
            title="Journal"
            summary="Telemetry write pressure"
            detail="Queue depth, dropped facts, persist failures, and degraded state for the Journal sink used by Telemetry."
            checked={t.journal.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ journal: { ...t.journal, enabled: v } })}
          />
          <SectionCard
            icon={<Database className="h-3.5 w-3.5" />}
            title="Docker"
            summary="Container runtime overlay"
            detail="Docker runtime info and optional per-container inventory from the configured endpoint."
            checked={t.docker.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ docker: { ...t.docker, enabled: v } })}
            className="sm:col-span-2"
          />
        </div>
      </section>

      <Accordion type="single" collapsible>
        <AccordionItem value="identity" className="rounded-xl border border-border bg-card">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline sm:px-5">
            <div className="flex items-start gap-3 text-left">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold">Collection and overlay opt-ins</p>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Machine paths and sampling first; the other sections add detail or identity as needed
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 border-t border-border/50 px-4 pb-5 pt-4 sm:px-5">
            <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                The costly option is <strong className="font-medium text-foreground">Sessions · per-session</strong>.
                It emits one <code className="rounded bg-muted px-1">Telemetry.SessionSampleCollected</code> per live
                session every interval. Production usually keeps that off.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <TelemetrySettingsCard title="Machine collection" disabled={!t.enabled || !t.host.enabled}>
                <label className="block text-[11px] text-muted-foreground">proc path</label>
                <Input className="mt-1 h-8 text-xs" value={t.host.procPath} onChange={(e) => patchTelemetry({ host: { ...t.host, procPath: e.target.value } })} />
                <label className="mt-2 block text-[11px] text-muted-foreground">disk path</label>
                <Input className="mt-1 h-8 text-xs" value={t.host.diskPath ?? ''} placeholder="Default" onChange={(e) => patchTelemetry({ host: { ...t.host, diskPath: e.target.value || null } })} />
                <NumberField label="Sample interval (ms)" value={t.host.sampleIntervalMs} disabled={!t.enabled || !t.host.enabled} onChange={(sampleIntervalMs) => patchTelemetry({ host: { ...t.host, sampleIntervalMs } })} />
              </TelemetrySettingsCard>
              <TelemetrySettingsCard title="API process collection" disabled={!t.enabled || !t.apiProcess.enabled}>
                <NumberField label="Sample interval (ms)" value={t.apiProcess.sampleIntervalMs} disabled={!t.enabled || !t.apiProcess.enabled} onChange={(sampleIntervalMs) => patchTelemetry({ apiProcess: { ...t.apiProcess, sampleIntervalMs } })} />
              </TelemetrySettingsCard>
              <TelemetrySettingsCard title="Sidecar / Docker collection" disabled={!t.enabled}>
                <NumberField label="Sidecar timeout (ms)" value={t.sidecar.timeoutMs} disabled={!t.enabled || !t.sidecar.enabled} onChange={(timeoutMs) => patchTelemetry({ sidecar: { ...t.sidecar, timeoutMs } })} />
                <NumberField label="Docker timeout (ms)" value={t.docker.timeoutMs} disabled={!t.enabled || !t.docker.enabled} onChange={(timeoutMs) => patchTelemetry({ docker: { ...t.docker, timeoutMs } })} />
                <label className="mt-2 block text-[11px] text-muted-foreground">Docker endpoint</label>
                <Input className="mt-1 h-8 text-xs" value={t.docker.endpoint} onChange={(e) => patchTelemetry({ docker: { ...t.docker, endpoint: e.target.value } })} />
              </TelemetrySettingsCard>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <OptInCard title="Machine · load average" body="Include one-, five-, and fifteen-minute machine load averages." checked={t.host.includeLoadAverage} disabled={!t.enabled || !t.host.enabled} onChange={(v) => patchTelemetry({ host: { ...t.host, includeLoadAverage: v } })} />
              <OptInCard title="Machine · swap" body="Include used and total machine swap." checked={t.host.includeSwap} disabled={!t.enabled || !t.host.enabled} onChange={(v) => patchTelemetry({ host: { ...t.host, includeSwap: v } })} />
              <OptInCard title="Machine · disk I/O" body="Include disk read and write throughput for the configured volume." checked={t.host.includeDiskIo} disabled={!t.enabled || !t.host.enabled} onChange={(v) => patchTelemetry({ host: { ...t.host, includeDiskIo: v } })} />
              <OptInCard title="Machine · network" body="Include aggregate receive and transmit throughput." checked={t.host.includeNetwork} disabled={!t.enabled || !t.host.enabled} onChange={(v) => patchTelemetry({ host: { ...t.host, includeNetwork: v } })} />
              <OptInCard title="API process · private memory" body="Include process-private committed memory." checked={t.apiProcess.includePrivateMemory} disabled={!t.enabled || !t.apiProcess.enabled} onChange={(v) => patchTelemetry({ apiProcess: { ...t.apiProcess, includePrivateMemory: v } })} />
              <OptInCard title="API process · GC" body="Include CLR heap and generation counters." checked={t.apiProcess.includeGarbageCollection} disabled={!t.enabled || !t.apiProcess.enabled} onChange={(v) => patchTelemetry({ apiProcess: { ...t.apiProcess, includeGarbageCollection: v } })} />
              <OptInCard title="API process · thread pool" body="Include busy workers and queued work items." checked={t.apiProcess.includeThreadPool} disabled={!t.enabled || !t.apiProcess.enabled} onChange={(v) => patchTelemetry({ apiProcess: { ...t.apiProcess, includeThreadPool: v } })} />
              <OptInCard title="Sessions · session IDs" body="List live session IDs in the sample to correlate charts with sessions." checked={t.sessions.includeSessionIds} disabled={!t.enabled || !t.sessions.enabled} onChange={(v) => patchTelemetry({ sessions: { ...t.sessions, includeSessionIds: v } })} />
              <OptInCard title="Sessions · per-session rows" body="Emit one Telemetry.SessionSampleCollected per live session on each tick." checked={t.sessions.includePerSession} disabled={!t.enabled || !t.sessions.enabled} onChange={(v) => patchTelemetry({ sessions: { ...t.sessions, includePerSession: v } })} />
              <OptInCard title="Sessions · URL host" body="Include each session's current URL hostname." checked={t.sessions.includeUrlHost} disabled={!t.enabled || !t.sessions.enabled} onChange={(v) => patchTelemetry({ sessions: { ...t.sessions, includeUrlHost: v } })} />
              <OptInCard title="Sidecar · process" body="Include sidecar CPU, RSS, heap, PID, and uptime." checked={t.sidecar.includeProcess} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeProcess: v } })} />
              <OptInCard title="Sidecar · event loop" body="Include sidecar event-loop delay and utilization." checked={t.sidecar.includeEventLoop} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeEventLoop: v } })} />
              <OptInCard title="Sidecar · chrome" body="Include open browser/page counts from the sidecar." checked={t.sidecar.includeChrome} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeChrome: v } })} />
              <OptInCard title="Sidecar · queues" body="Include sidecar bridge queue depths that are actually supported by the sidecar." checked={t.sidecar.includeQueues} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeQueues: v } })} />
              <OptInCard title="Sidecar · sessions summary" body="Include registered/open/faulted session totals from the sidecar." checked={t.sidecar.includeSessionsSummary} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeSessionsSummary: v } })} />
              <OptInCard title="Sidecar · faulted IDs" body="List faulted session IDs from the sidecar summary." checked={t.sidecar.includeFaultedIds} disabled={!t.enabled || !t.sidecar.enabled} onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeFaultedIds: v } })} />
              <OptInCard title="Profiles · storage bytes" body="Include the unified Speculum database footprint." checked={t.profiles.includeStorageBytes} disabled={!t.enabled || !t.profiles.enabled} onChange={(v) => patchTelemetry({ profiles: { ...t.profiles, includeStorageBytes: v } })} />
              <OptInCard title="Journal · pressure detail" body="Include persist failures, admission failures, queue pressure, and drain-state detail for the Telemetry sink." checked={t.journal.includePressure} disabled={!t.enabled || !t.journal.enabled} onChange={(v) => patchTelemetry({ journal: { ...t.journal, includePressure: v } })} />
              <OptInCard title="Docker · runtime" body="Include Docker runtime version/OS/container totals." checked={t.docker.includeRuntime} disabled={!t.enabled || !t.docker.enabled} onChange={(v) => patchTelemetry({ docker: { ...t.docker, includeRuntime: v } })} />
              <OptInCard title="Docker · containers" body="Include per-container state and resource snapshots." checked={t.docker.includeContainers} disabled={!t.enabled || !t.docker.enabled} onChange={(v) => patchTelemetry({ docker: { ...t.docker, includeContainers: v } })} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function TelemetrySettingsCard({ title, disabled, children }: { title: string; disabled: boolean; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/10 p-3', disabled && 'opacity-50')}>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function NumberField({
  label,
  value,
  disabled,
  min = 100,
  step = 100,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  min?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="mt-2 block text-[11px] text-muted-foreground">
      {label}
      <Input
        className="mt-1 h-8 w-28 text-xs"
        type="number"
        min={min}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      />
    </label>
  )
}

function SectionCard({
  icon,
  title,
  summary,
  detail,
  checked,
  disabled,
  onChange,
  className,
}: {
  icon: ReactNode
  title: string
  summary: string
  detail: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col rounded-lg border p-3.5 transition-colors',
        checked && !disabled ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-muted/10',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-[11px] text-muted-foreground">{summary}</p>
          </div>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </label>
  )
}

function OptInCard({
  title,
  body,
  checked,
  disabled,
  onChange,
}: {
  title: string
  body: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-3', disabled && 'cursor-not-allowed opacity-50')}>
      <Switch className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </label>
  )
}
