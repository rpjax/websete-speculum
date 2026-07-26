import { Switch } from '@/components/ui/switch'
import type { DiagnosticsOptions, DiagnosticsOverview } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import { AlertTriangle, Power } from 'lucide-react'
import { StateLifecycleDiagram } from './StateLifecycleDiagram'

interface GovernanceControlTabProps {
  overview: DiagnosticsOverview | null
  config: DiagnosticsOptions
  onChange: (next: DiagnosticsOptions) => void
}

export function GovernanceControlTab({ overview, config, onChange }: GovernanceControlTabProps) {
  const current = overview?.degraded
    ? 'Degraded'
    : overview?.elevate?.active
      ? 'Elevated'
      : 'Normal'

  return (
    <div className="space-y-4">
      <StateLifecycleDiagram current={current} />

      {overview?.degraded && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Saving configuration does not clear Degraded — use <strong className="text-foreground">Recover</strong> in
          the Runtime bar above.
        </p>
      )}

      <section
        className={cn(
          'rounded-xl border p-4 sm:p-5',
          config.enabled ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/5',
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              config.enabled ? 'bg-muted' : 'bg-destructive/20',
            )}
          >
            <Power
              className={cn('h-4 w-4', config.enabled ? 'text-muted-foreground' : 'text-destructive')}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Diagnostics pipeline</h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  Master switch for the whole control plane. Off means no events, no telemetry samples, and
                  no probes — use only while troubleshooting the pipeline itself.
                </p>
              </div>
              <Switch
                id="diag-enabled"
                checked={config.enabled}
                onCheckedChange={(enabled) => onChange({ ...config, enabled })}
              />
            </div>
            {!config.enabled && (
              <p className="mt-3 flex items-start gap-2 text-xs text-destructive leading-relaxed">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Pipeline is disabled in the draft. Save will stop collection across all sessions until you
                turn it back on.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
