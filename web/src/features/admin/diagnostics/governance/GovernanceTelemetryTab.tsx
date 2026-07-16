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
    t.motor.enabled,
    t.sidecar.enabled,
    t.persistence.enabled,
    t.pipeline.enabled,
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
            On a fixed interval the host builds <strong className="font-medium text-foreground">one composite
            sample</strong> (
            <code className="rounded bg-muted px-1">Telemetry.SampleCollected</code>
            ) with optional sections — host, motor, sidecar, persistence, pipeline. That is separate from
            lifecycle <em>events</em> on Coverage. Charts live under Telemetry Monitor; this tab only chooses
            what goes into each sample.
          </p>
        </div>
      </div>

      {/* Master */}
      <section
        className={cn(
          'rounded-xl border bg-card',
          t.enabled ? 'border-border' : 'border-warning/30',
        )}
      >
        <header className="flex items-start gap-3 border-b border-border/50 px-4 py-3.5 sm:px-5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Sampler master</h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  When off, no composite samples are emitted — section toggles below have no effect until
                  the sampler is on again.
                </p>
              </div>
              <Switch
                id="tel-enabled"
                checked={t.enabled}
                onCheckedChange={(enabled) => patchTelemetry({ enabled })}
              />
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
                  How often a new composite sample is taken (1–3600s). Faster intervals fill the event store
                  quicker — pair with Budgets if you go aggressive.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="mb-2.5 text-[11px] text-muted-foreground leading-relaxed">
              One sample every N seconds across the whole process — not per session.
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

      {/* Sections */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border/50 px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Sample sections</h3>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                Each section is a slice of the same composite sample. Off sections are omitted from the
                payload — they do not emit separate events.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {sectionCount} of 5 included
            </span>
          </div>
        </header>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <SectionCard
            icon={<Server className="h-3.5 w-3.5" />}
            title="Host"
            summary="Machine health under Speculum"
            detail="CPU%, working set, GC gens, thread pool depth, disk free — shared process view, not per browser."
            checked={t.host.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ host: { enabled: v } })}
          />
          <SectionCard
            icon={<Activity className="h-3.5 w-3.5" />}
            title="Motor"
            summary="Live browsing capacity & FPS"
            detail="Session counts by phase, avg/min/max FPS, input/frame queue depth, capacity %. Answers “is the motor healthy right now?”"
            checked={t.motor.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ motor: { ...t.motor, enabled: v } })}
          />
          <SectionCard
            icon={<Radar className="h-3.5 w-3.5" />}
            title="Sidecar"
            summary="Browser process connectivity"
            detail="How many sidecars are connected vs faulted. Lightweight aggregate — turn on identity opt-ins below if you need faulted IDs."
            checked={t.sidecar.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, enabled: v } })}
          />
          <SectionCard
            icon={<Database className="h-3.5 w-3.5" />}
            title="Persistence"
            summary="Stored session footprint"
            detail="Counts of persisted sessions, cookies, history, expiring-soon. Useful for restore/capacity planning."
            checked={t.persistence.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ persistence: { ...t.persistence, enabled: v } })}
          />
          <SectionCard
            icon={<HardDrive className="h-3.5 w-3.5" />}
            title="Pipeline"
            summary="Diagnostics back-pressure"
            detail="Event-store bytes used, drops, overflow, probe-in-flight, degraded/elevate flags. The self-view of the diagnostics pipeline."
            checked={t.pipeline.enabled}
            disabled={!t.enabled}
            onChange={(v) => patchTelemetry({ pipeline: { ...t.pipeline, enabled: v } })}
            className="sm:col-span-2"
          />
        </div>
      </section>

      {/* Identity */}
      <Accordion type="single" collapsible>
        <AccordionItem value="identity" className="rounded-xl border border-border bg-card">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline sm:px-5">
            <div className="flex items-start gap-3 text-left">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold">Identity & detail opt-ins</p>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Extra fields inside sections — Production skips per-session rows for perf
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 border-t border-border/50 px-4 pb-5 pt-4 sm:px-5">
            <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                These enrich an already-enabled section. Most are cheap. The costly one is{' '}
                <strong className="font-medium text-foreground">Motor · per-session</strong> — it
                emits one <code className="rounded bg-muted px-1">SessionSampleCollected</code> per
                live session every interval. Production keeps that off; session IDs and URL host stay on.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <OptInCard
                title="Motor · session IDs"
                body="List live connection IDs in the sample. Helps map charts to sessions; increases payload size."
                checked={t.motor.includeSessionIds}
                disabled={!t.enabled || !t.motor.enabled}
                onChange={(v) => patchTelemetry({ motor: { ...t.motor, includeSessionIds: v } })}
              />
              <OptInCard
                title="Motor · per-session rows"
                body="Embed a compact projection per live session (phase, FPS, queues) and emit one SessionSampleCollected per session each tick — the expensive identity option."
                checked={t.motor.includePerSession}
                disabled={!t.enabled || !t.motor.enabled}
                onChange={(v) => patchTelemetry({ motor: { ...t.motor, includePerSession: v } })}
              />
              <OptInCard
                title="Motor · URL host"
                body="Include the hostname of each session’s current URL in the composite sample (cheap; useful for allowlist issues)."
                checked={t.motor.includeUrlHost}
                disabled={!t.enabled || !t.motor.enabled}
                onChange={(v) => patchTelemetry({ motor: { ...t.motor, includeUrlHost: v } })}
              />
              <OptInCard
                title="Sidecar · faulted IDs"
                body="List which sessions have a faulted sidecar. Turn on when chasing browser process crashes."
                checked={t.sidecar.includeFaultedIds}
                disabled={!t.enabled || !t.sidecar.enabled}
                onChange={(v) => patchTelemetry({ sidecar: { ...t.sidecar, includeFaultedIds: v } })}
              />
              <OptInCard
                title="Persistence · store bytes"
                body="Include on-disk store size for the session archive. Helps correlate disk growth with Budgets."
                checked={t.persistence.includeBytes}
                disabled={!t.enabled || !t.persistence.enabled}
                onChange={(v) =>
                  patchTelemetry({ persistence: { ...t.persistence, includeBytes: v } })
                }
              />
              <OptInCard
                title="Pipeline · breaker pressure"
                body="Include recent drop / slow-write counters that feed the Degraded circuit. Useful when diagnosing StorageOverflow."
                checked={t.pipeline.includeBreakerPressure}
                disabled={!t.enabled || !t.pipeline.enabled}
                onChange={(v) =>
                  patchTelemetry({ pipeline: { ...t.pipeline, includeBreakerPressure: v } })
                }
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
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
        checked && !disabled
          ? 'border-primary/40 bg-primary/5'
          : 'border-border/60 bg-muted/10',
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
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-3',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Switch
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </label>
  )
}
