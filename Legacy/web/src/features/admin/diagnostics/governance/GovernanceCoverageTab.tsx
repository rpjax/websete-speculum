import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DiagnosticsOptions, EffectiveCapabilities } from '@/lib/diagnosticsApi'
import {
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  CONFIG_DOMAIN_LABELS,
  DOMAIN_COLORS,
  DOMAIN_DESCRIPTIONS,
  DOMAIN_LABELS,
  summarizeCapabilities,
} from '@/lib/diagnosticsConstants'
import { cn } from '@/lib/utils'
import {
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  Layers,
  Lock,
  Radar,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import { DOMAIN_GROUPS, type ConfigDomainGroup } from './governanceDefaults'
import { explainMismatch, type MismatchReason } from './resolveEffectivePreview'

interface GovernanceCoverageTabProps {
  config: DiagnosticsOptions
  onChange: (next: DiagnosticsOptions) => void
  effective: EffectiveCapabilities | undefined
  overlays: { degraded: boolean; elevateActive: boolean }
}

/** Domain-specific impact — not the generic capability glossary (shown once above). */
const TOGGLE_IMPACT: Record<string, Record<string, { title: string; whenOn: string; whenOff: string }>> = {
  motor: {
    Metric: {
      title: 'Metrics',
      whenOn: 'Keep FPS, capacity, and queue gauges for live sessions.',
      whenOff: 'Motor gauges stop updating — Timeline still has events if Events stay on.',
    },
    Event: {
      title: 'Events',
      whenOn: 'Record session lifecycle, navigate, export, drain beats on the Timeline.',
      whenOff: 'Act→Assert stories thin out — avoid in CI / Assertive profiles.',
    },
    Snapshot: {
      title: 'Snapshots',
      whenOn: 'Allow full session state snapshots used by export / investigate paths.',
      whenOff: 'Deep session snapshots become unavailable for this domain.',
    },
  },
  sidecar: {
    Metric: {
      title: 'Metrics',
      whenOn: 'Track sidecar connect/fault aggregates.',
      whenOff: 'Less visibility into browser-process health.',
    },
    Event: {
      title: 'Events',
      whenOn: 'Record DiagProbe requested/completed/timeout/rejected beats.',
      whenOff: 'Probe stories disappear from Timeline — keep on in Production so Elevate investigations leave a trail.',
    },
  },
  browserQuery: {
    Probe: {
      title: 'Browser Query',
      whenOn: 'Allow cookies, DOM, storage, and JS evaluate probes on live sessions.',
      whenOff: 'Deep inspection blocked unless you Elevate (temporary override).',
    },
  },
  persisted: {
    Snapshot: {
      title: 'Snapshots',
      whenOn: 'Allow reading persisted session detail / state under diagnostics gates.',
      whenOff: 'Persisted detail queries return probe_level_insufficient.',
    },
  },
}

const MISMATCH_COPY: Record<Exclude<MismatchReason, null>, string> = {
  degraded: 'Degraded caps this domain to Metric only. Recover in the Runtime bar to restore configured capabilities.',
  elevate: 'Elevate is forcing this on temporarily. It reverts when elevation expires or you clear it.',
  config: 'Live runtime differs from this draft switch — Save to apply, or an overlay is active.',
}

export function GovernanceCoverageTab({
  config,
  onChange,
  effective,
  overlays,
}: GovernanceCoverageTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm leading-relaxed">
          <p className="font-medium">What coverage controls</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Each <strong className="font-medium text-foreground">domain</strong> (Motor, Sidecar, …) can emit
            signal kinds called <strong className="font-medium text-foreground">capabilities</strong> (Metrics,
            Events, Snapshots, Browser Query). The switch is your <em>configured</em> intent; the badge is what is{' '}
            <em>live</em> after Degraded / Elevate. This is separate from the Telemetry sampler tab.
          </p>
        </div>
      </div>

      {(overlays.degraded || overlays.elevateActive) && (
        <div className="space-y-2">
          {overlays.degraded && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive leading-relaxed">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Degraded</strong> is active — live capabilities are capped to Metrics only, even if
                switches below say On. Recover in the Runtime bar; Saving config alone will not clear it.
              </span>
            </div>
          )}
          {overlays.elevateActive && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs text-primary leading-relaxed">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Elevate</strong> is active — Browser Query and Sidecar events are forced on live,
                even if their configured switches are Off.
              </span>
            </div>
          )}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border/50 px-4 py-3 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Capability glossary
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Read once — toggle rows below describe domain impact, not this glossary again.
          </p>
        </header>
        <div className="grid gap-px border-b border-border/40 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
          {(['Metric', 'Event', 'Snapshot', 'Probe'] as const).map((cap) => (
            <div key={cap} className="bg-card px-4 py-3">
              <span className="text-xs font-semibold text-primary">{CAPABILITY_LABELS[cap]}</span>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {CAPABILITY_DESCRIPTIONS[cap]}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-foreground">Configured</span>
            Your draft switch — Save to publish
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-semibold text-blue-400">Live</span>
            What the runtime actually allows now
          </span>
        </div>
      </section>

      <div className="space-y-3">
        {DOMAIN_GROUPS.map(({ group, effectiveKey }) => {
          const iconColor = DOMAIN_COLORS[effectiveKey] ?? 'text-muted-foreground'
          const eff = effective?.[effectiveKey]
          const effSummary = summarizeCapabilities(eff)
          return (
            <section key={group} className="rounded-xl border border-border bg-card">
              <header className="flex items-start gap-3 border-b border-border/50 px-4 py-3.5 sm:px-5">
                <div className={cn('mt-0.5', iconColor)}>
                  {effSummary.off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">
                    {CONFIG_DOMAIN_LABELS[group] ?? DOMAIN_LABELS[effectiveKey] ?? group}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {DOMAIN_DESCRIPTIONS[effectiveKey]}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    effSummary.off
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-success/15 text-success',
                  )}
                >
                  {effSummary.off ? 'Nothing live' : `${effSummary.enabled.length} live`}
                </span>
              </header>
              <DomainCapabilityRows
                group={group}
                config={config}
                effective={eff}
                overlays={overlays}
                onChange={onChange}
              />
            </section>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ReadOnlyDomainCard
          domainKey="Telemetry"
          icon={<Radar className="h-4 w-4" />}
          configured={config.telemetry.enabled}
          effective={effective?.Telemetry?.Metric ?? false}
          hint="Sampler on/off and sections live on the Telemetry tab — not toggled here."
        />
        <ReadOnlyDomainCard
          domainKey="DiagnosticsSelf"
          icon={<Lock className="h-4 w-4" />}
          configured
          effective={effective?.DiagnosticsSelf?.Metric ?? true}
          hint="ConfigApplied, Elevate, Degraded, Recover — always recorded while the pipeline is enabled."
          alwaysOn
        />
      </div>
    </div>
  )
}

function ReadOnlyDomainCard({
  domainKey,
  icon,
  configured,
  effective,
  hint,
  alwaysOn,
}: {
  domainKey: string
  icon: ReactNode
  configured: boolean
  effective: boolean
  hint: string
  alwaysOn?: boolean
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-sm font-medium text-foreground">{DOMAIN_LABELS[domainKey] ?? domainKey}</p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{DOMAIN_DESCRIPTIONS[domainKey]}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {alwaysOn ? 'Not configurable' : configured ? 'Sampler on' : 'Sampler off'}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
            effective ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground',
          )}
        >
          {effective ? 'Live' : 'Not live'}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">{hint}</p>
    </div>
  )
}

function DomainCapabilityRows({
  group,
  config,
  effective,
  overlays,
  onChange,
}: {
  group: ConfigDomainGroup
  config: DiagnosticsOptions
  effective: Partial<Record<string, boolean>> | undefined
  overlays: { degraded: boolean; elevateActive: boolean }
  onChange: (next: DiagnosticsOptions) => void
}) {
  const rows: { field: string; capability: string; configured: boolean; set: (v: boolean) => void }[] = []
  const d = config.domains

  if (group === 'motor') {
    rows.push(
      {
        field: 'metrics',
        capability: 'Metric',
        configured: d.motor.metrics,
        set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, metrics: v } } }),
      },
      {
        field: 'events',
        capability: 'Event',
        configured: d.motor.events,
        set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, events: v } } }),
      },
      {
        field: 'snapshots',
        capability: 'Snapshot',
        configured: d.motor.snapshots,
        set: (v) => onChange({ ...config, domains: { ...d, motor: { ...d.motor, snapshots: v } } }),
      },
    )
  } else if (group === 'sidecar') {
    rows.push(
      {
        field: 'metrics',
        capability: 'Metric',
        configured: d.sidecar.metrics,
        set: (v) => onChange({ ...config, domains: { ...d, sidecar: { ...d.sidecar, metrics: v } } }),
      },
      {
        field: 'events',
        capability: 'Event',
        configured: d.sidecar.events,
        set: (v) => onChange({ ...config, domains: { ...d, sidecar: { ...d.sidecar, events: v } } }),
      },
    )
  } else if (group === 'browserQuery') {
    rows.push({
      field: 'probe',
      capability: 'Probe',
      configured: d.browserQuery.probe,
      set: (v) => onChange({ ...config, domains: { ...d, browserQuery: { probe: v } } }),
    })
  } else {
    rows.push({
      field: 'snapshots',
      capability: 'Snapshot',
      configured: d.persisted.snapshots,
      set: (v) => onChange({ ...config, domains: { ...d, persisted: { snapshots: v } } }),
    })
  }

  return (
    <ul className="divide-y divide-border/40">
      {rows.map((row) => {
        const effOn = effective?.[row.capability] ?? false
        const reason = explainMismatch(row.configured, effOn, overlays)
        const impact = TOGGLE_IMPACT[group]?.[row.capability]
        return (
          <li key={row.field} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <Switch className="mt-0.5" checked={row.configured} onCheckedChange={row.set} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">
                  {impact?.title ?? CAPABILITY_LABELS[row.capability] ?? row.capability}
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {CAPABILITY_DESCRIPTIONS[row.capability]}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {row.configured
                  ? (impact?.whenOn ?? CAPABILITY_DESCRIPTIONS[row.capability])
                  : (impact?.whenOff ?? 'Off in this draft.')}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  effOn ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground',
                )}
              >
                {effOn ? 'Live' : 'Not live'}
              </span>
              {reason && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-warning"
                    >
                      <Info className="h-3 w-3" /> Why?
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{MISMATCH_COPY[reason]}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
