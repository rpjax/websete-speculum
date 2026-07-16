import { useCallback, useEffect, useState } from 'react'
import { diagnosticsApi, type HostTelemetry } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageHeader } from '@/components/admin/PageHeader'
import { useBreadcrumbs } from '@/lib/hooks/useBreadcrumbs'
import { ResourceChartExplorer, ResourceTimeRangeControls } from '@/components/admin/ResourceChartExplorer'
import { TELEMETRY_METRICS, type TimePreset } from '@/lib/resourceChartCompute'
import { LiveStrip } from './telemetry/LiveStrip'
import { TelemetryInsights } from './telemetry/TelemetryInsights'
import { TelemetrySampleTable } from './telemetry/TelemetrySampleTable'
import { useTelemetryHistory, type TelemetryRange } from './telemetry/useTelemetryHistory'
import { RefreshCw, AlertTriangle } from 'lucide-react'

export default function DiagnosticsTelemetryExplorePage() {
  const breadcrumbs = useBreadcrumbs()
  const [range, setRange] = useState<TelemetryRange>({ preset: '24h', from: null, to: null })
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [host, setHost] = useState<HostTelemetry | null>(null)
  const [focusTs, setFocusTs] = useState<number | null>(null)

  const { chartSamples, latest, loading, error, reload } = useTelemetryHistory(range, {
    live: autoRefresh,
    intervalMs: 10_000,
  })

  const loadHost = useCallback(() => {
    void diagnosticsApi.getHost().then(setHost).catch(() => {})
  }, [])
  useEffect(() => { loadHost() }, [loadHost])

  function refreshAll() {
    void reload()
    loadHost()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Telemetry explorer"
        description="Correlate any host, motor, sidecar, persistence, or pipeline metric over any time window. Overlay signals, detect nonlinear scaling, and drill into raw samples."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <ResourceTimeRangeControls
              preset={range.preset}
              customFrom={range.from}
              customTo={range.to}
              onPresetChange={(v) => setRange((r) => ({ ...r, preset: v as TimePreset }))}
              onCustomChange={(from, to) => setRange((r) => ({ ...r, from, to }))}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground select-none">
                  <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary h-2.5 w-2.5" />
                  Live
                </label>
              </TooltipTrigger>
              <TooltipContent>Auto-refresh every 10s</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refreshAll} disabled={loading}>
              <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <Button variant="outline" size="sm" className="ml-auto h-6 text-[11px]" onClick={refreshAll}>Retry</Button>
        </div>
      )}

      <LiveStrip host={host} latest={latest} />

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <ResourceChartExplorer
          samples={chartSamples}
          metrics={TELEMETRY_METRICS}
          focusTimestamp={focusTs}
          tall
          onBrushRange={(from, to) => setRange({ preset: 'custom', from, to })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TelemetryInsights samples={chartSamples} onJump={setFocusTs} />
        <TelemetrySampleTable range={range} />
      </div>
    </div>
  )
}
