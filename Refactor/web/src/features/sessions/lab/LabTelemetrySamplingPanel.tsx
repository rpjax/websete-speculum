import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { LabTelemetryConfig } from './labEngineConfig'

interface LabTelemetrySamplingPanelProps {
  telemetry: LabTelemetryConfig
  onChange: (next: LabTelemetryConfig) => void
}

const SECTIONS = [
  ['host', 'Host (machine)'],
  ['apiProcess', 'API process'],
  ['sessions', 'Live sessions'],
  ['sidecar', 'Sidecar'],
  ['profiles', 'Profiles'],
  ['journal', 'Journal pressure'],
  ['docker', 'Docker'],
] as const

/**
 * Telemetry sampler — composite SampleCollected + optional per-session rows.
 */
export function LabTelemetrySamplingPanel({
  telemetry,
  onChange,
}: LabTelemetrySamplingPanelProps) {
  const patch = (partial: Partial<LabTelemetryConfig>) => {
    onChange({ ...telemetry, ...partial })
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Periodic composite{' '}
        <code className="text-foreground">Telemetry.Sampling.SampleCollected</code>. Section
        toggles only matter when sampling is on. Session event probes live under Events.
      </p>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <div>
          <Label htmlFor="lab-telemetry-enabled">Enable sampling</Label>
          <p className="text-[11px] text-muted-foreground">
            Master switch for the sampler and composite Journal fact.
          </p>
        </div>
        <Switch
          id="lab-telemetry-enabled"
          checked={telemetry.isEnabled}
          onCheckedChange={(checked) => patch({ isEnabled: checked })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lab-telemetry-interval">Sample interval (seconds)</Label>
        <Input
          id="lab-telemetry-interval"
          type="number"
          min={1}
          max={3600}
          className="max-w-[10rem] font-mono text-xs"
          disabled={!telemetry.isEnabled}
          value={telemetry.intervalSeconds || ''}
          onChange={(event) => {
            const value = Number(event.target.value)
            patch({
              intervalSeconds: Number.isFinite(value) ? value : telemetry.intervalSeconds,
            })
          }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SECTIONS.map(([key, label]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-2"
          >
            <Label htmlFor={`lab-telemetry-${key}`} className="text-xs">
              {label}
            </Label>
            <Switch
              id={`lab-telemetry-${key}`}
              disabled={!telemetry.isEnabled}
              checked={telemetry[key].isEnabled}
              onCheckedChange={(checked) =>
                patch({
                  [key]: { ...telemetry[key], isEnabled: checked },
                } as Partial<LabTelemetryConfig>)
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <Label htmlFor="lab-telemetry-per-session">Per-session samples</Label>
          <p className="text-[11px] text-muted-foreground">
            Extra <code>Telemetry.Sampling.SessionSampleCollected</code> per live session.
          </p>
        </div>
        <Switch
          id="lab-telemetry-per-session"
          disabled={!telemetry.isEnabled || !telemetry.sessions.isEnabled}
          checked={telemetry.sessions.includePerSession ?? false}
          onCheckedChange={(checked) =>
            patch({
              sessions: { ...telemetry.sessions, includePerSession: checked },
            })
          }
        />
      </div>
    </div>
  )
}
