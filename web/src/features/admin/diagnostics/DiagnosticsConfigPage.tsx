import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { ConfigSectionCard } from '@/components/admin/ConfigSectionCard'
import { useConfigSection } from '@/lib/hooks/useConfigSection'
import { ConfigSections } from '@/lib/api'
import type { DiagnosticsOptions, DiagnosticsProfile } from '@/lib/diagnosticsApi'
import { DIAGNOSTICS_PRESETS } from '@/lib/diagnosticsConstants'

const PROFILES: DiagnosticsProfile[] = ['Development', 'Production', 'Assertive']

const DEFAULT_CONFIG: DiagnosticsOptions = {
  enabled: true,
  profile: 'Production',
  domains: DIAGNOSTICS_PRESETS.Production.domains,
  telemetry: DIAGNOSTICS_PRESETS.Production.telemetry,
  storage: {
    maxBytes: 64 * 1024 * 1024,
    maxEventsPerSession: 5000,
    ttlHours: 24,
    overflow: 'DropOldest',
  },
  sampling: {
    statusMirrorRatio: 1,
    expensiveEventRatio: 0.25,
  },
  elevate: {
    browserQueryMaxMinutes: 30,
  },
  probe: {
    diagTimeoutMs: 10_000,
    maxConcurrentProbesPerSession: 2,
    maxProbeResponseBytes: 512 * 1024,
    hostSampleIntervalMs: 1000,
  },
}

function ToggleRow({ id, label, checked, onChange }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

export default function DiagnosticsConfigPage() {
  const cfg = useConfigSection<DiagnosticsOptions>({
    section: ConfigSections.Diagnostics,
    initial: DEFAULT_CONFIG,
    mapIn: (raw) => ({ ...DEFAULT_CONFIG, ...(raw as DiagnosticsOptions) }),
    mapOut: (v) => v,
  })

  const v = cfg.value
  const d = v.domains

  return (
    <ConfigSectionCard
      title="Diagnostics configuration"
      description="Primary path controls enablement and profile. Per-domain capabilities and probe limits stay under Advanced."
      loading={cfg.loading}
      pending={cfg.pending}
      message={cfg.message}
      error={cfg.error}
      onSave={() => void cfg.save()}
    >
      <div className="flex items-center gap-3">
        <Switch
          id="enabled"
          checked={v.enabled}
          onCheckedChange={(enabled) => cfg.setValue({ ...v, enabled })}
        />
        <Label htmlFor="enabled">Diagnostics enabled</Label>
      </div>
      <div className="space-y-1">
        <Label>Profile</Label>
        <Select
          value={v.profile}
          onValueChange={(profile) => {
            const preset = DIAGNOSTICS_PRESETS[profile as DiagnosticsProfile]
            cfg.setValue({ ...v, profile: profile as DiagnosticsProfile, domains: preset.domains, telemetry: preset.telemetry })
          }}
        >
          <SelectTrigger id="profile"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROFILES.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Applies a baseline of capability + telemetry toggles. Tune individual toggles under Advanced.</p>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="domains">
          <AccordionTrigger>Advanced — per-domain capabilities</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Motor (sessions)</p>
              <ToggleRow id="motor-metrics" label="Metrics" checked={d.motor.metrics} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, motor: { ...d.motor, metrics: x } } })} />
              <ToggleRow id="motor-events" label="Events" checked={d.motor.events} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, motor: { ...d.motor, events: x } } })} />
              <ToggleRow id="motor-snapshots" label="Snapshots" checked={d.motor.snapshots} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, motor: { ...d.motor, snapshots: x } } })} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sidecar (browser)</p>
              <ToggleRow id="sidecar-metrics" label="Metrics" checked={d.sidecar.metrics} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, sidecar: { ...d.sidecar, metrics: x } } })} />
              <ToggleRow id="sidecar-events" label="Events" checked={d.sidecar.events} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, sidecar: { ...d.sidecar, events: x } } })} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Browser Query</p>
              <ToggleRow id="bq-probe" label="Probe" checked={d.browserQuery.probe} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, browserQuery: { probe: x } } })} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Persisted Sessions</p>
              <ToggleRow id="persisted-snapshots" label="Snapshots" checked={d.persisted.snapshots} onChange={(x) => cfg.setValue({ ...v, domains: { ...d, persisted: { snapshots: x } } })} />
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="telemetry">
          <AccordionTrigger>Advanced — telemetry sections</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch id="tel-enabled" checked={v.telemetry.enabled} onCheckedChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, enabled: x } })} />
              <Label htmlFor="tel-enabled">Telemetry sampler enabled</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tel-interval">Interval (seconds)</Label>
              <Input
                id="tel-interval"
                type="number"
                value={v.telemetry.intervalSeconds}
                onChange={(e) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, intervalSeconds: Number(e.target.value) } })}
              />
            </div>
            <ToggleRow id="tel-host" label="Host section" checked={v.telemetry.host.enabled} onChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, host: { enabled: x } } })} />
            <ToggleRow id="tel-motor" label="Motor section" checked={v.telemetry.motor.enabled} onChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, motor: { ...v.telemetry.motor, enabled: x } } })} />
            <ToggleRow id="tel-sidecar" label="Sidecar section" checked={v.telemetry.sidecar.enabled} onChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, sidecar: { ...v.telemetry.sidecar, enabled: x } } })} />
            <ToggleRow id="tel-persistence" label="Persistence section" checked={v.telemetry.persistence.enabled} onChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, persistence: { ...v.telemetry.persistence, enabled: x } } })} />
            <ToggleRow id="tel-pipeline" label="Pipeline section" checked={v.telemetry.pipeline.enabled} onChange={(x) => cfg.setValue({ ...v, telemetry: { ...v.telemetry, pipeline: { ...v.telemetry.pipeline, enabled: x } } })} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="storage">
          <AccordionTrigger>Advanced — storage & probe budgets</AccordionTrigger>
          <AccordionContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="maxBytes">maxBytes</Label>
              <Input
                id="maxBytes"
                type="number"
                value={v.storage.maxBytes}
                onChange={(e) =>
                  cfg.setValue({ ...v, storage: { ...v.storage, maxBytes: Number(e.target.value) } })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ttl">ttlHours</Label>
              <Input
                id="ttl"
                type="number"
                value={v.storage.ttlHours}
                onChange={(e) =>
                  cfg.setValue({ ...v, storage: { ...v.storage, ttlHours: Number(e.target.value) } })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="probeTimeout">diagTimeoutMs</Label>
              <Input
                id="probeTimeout"
                type="number"
                value={v.probe.diagTimeoutMs}
                onChange={(e) =>
                  cfg.setValue({ ...v, probe: { ...v.probe, diagTimeoutMs: Number(e.target.value) } })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="elevateMax">elevate max minutes</Label>
              <Input
                id="elevateMax"
                type="number"
                value={v.elevate.browserQueryMaxMinutes}
                onChange={(e) =>
                  cfg.setValue({
                    ...v,
                    elevate: { browserQueryMaxMinutes: Number(e.target.value) },
                  })
                }
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </ConfigSectionCard>
  )
}
