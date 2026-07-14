import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { ConfigSectionCard } from '@/components/admin/ConfigSectionCard'
import { useConfigSection } from '@/lib/hooks/useConfigSection'
import { ConfigSections } from '@/lib/api'
import type { DiagnosticsLevel, DiagnosticsOptions } from '@/lib/diagnosticsApi'

const LEVELS: DiagnosticsLevel[] = ['Off', 'Metrics', 'Events', 'StateSnapshots', 'BrowserQuery']

const DEFAULT_CONFIG: DiagnosticsOptions = {
  enabled: true,
  defaultLevel: 'Events',
  domains: {
    motorLive: 'Events',
    sidecarBrowser: 'Metrics',
    hostResources: 'Metrics',
    browserQuery: 'Off',
    persistedSessions: 'StateSnapshots',
  },
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

function LevelSelect({
  value,
  onChange,
  id,
}: {
  value: DiagnosticsLevel
  onChange: (v: DiagnosticsLevel) => void
  id: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DiagnosticsLevel)}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l} value={l}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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

  return (
    <ConfigSectionCard
      title="Diagnostics configuration"
      description="Primary path controls enablement and default level. Domain budgets and probe limits stay under Advanced."
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
        <Label>Default level</Label>
        <LevelSelect
          id="defaultLevel"
          value={v.defaultLevel}
          onChange={(defaultLevel) => cfg.setValue({ ...v, defaultLevel })}
        />
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="domains">
          <AccordionTrigger>Advanced — per-domain levels</AccordionTrigger>
          <AccordionContent className="space-y-3">
            {(Object.keys(v.domains) as (keyof DiagnosticsOptions['domains'])[]).map((key) => (
              <div key={key} className="space-y-1">
                <Label>{key}</Label>
                <LevelSelect
                  id={key}
                  value={v.domains[key]}
                  onChange={(level) =>
                    cfg.setValue({ ...v, domains: { ...v.domains, [key]: level } })
                  }
                />
              </div>
            ))}
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
