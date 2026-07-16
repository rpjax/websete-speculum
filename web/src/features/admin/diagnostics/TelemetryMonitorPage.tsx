import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticsApi, type HostTelemetry } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TelemetryMonitorChart, ResourceTimeRangeControls } from '@/components/admin/TelemetryMonitorChart'
import { TELEMETRY_METRICS, type TimePreset } from '@/lib/resourceChartCompute'
import { TelemetrySubNav } from './telemetry/TelemetrySubNav'
import { TelemetrySystemStrip } from './telemetry/monitor/TelemetrySystemStrip'
import { MonitorHints } from './telemetry/monitor/MonitorHints'
import { TelemetryMonitorSampleTable } from './telemetry/monitor/TelemetryMonitorSampleTable'
import { useTelemetryMonitorSeries, type TelemetryRange } from './telemetry/monitor/useTelemetryMonitorSeries'
import { RefreshCw, Maximize2, AlertTriangle, LineChart } from 'lucide-react'

export default function TelemetryMonitorPage() {
  const [range, setRange] = useState<TelemetryRange>({ preset: '6h', from: null, to: null })
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [host, setHost] = useState<HostTelemetry | null>(null)
  const [focusTs, setFocusTs] = useState<number | null>(null)
  const [enabledKeys, setEnabledKeys] = useState<string[]>(['host.cpu', 'host.memory', 'motor.live'])

  const { chartSamples, latest, loading, error, reload } = useTelemetryMonitorSeries(range, {
    live: autoRefresh,
    intervalMs: 10_000,
  })

  const loadHost = useCallback(() => {
    void diagnosticsApi.getHost().then(setHost).catch(() => {})
  }, [])
  useEffect(() => { loadHost() }, [loadHost])
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadHost, 10_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadHost])

  function refreshAll() {
    void reload()
    loadHost()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <TelemetrySubNav />
        <p className="text-[11px] text-muted-foreground/60 max-w-xl">
          Monitor observes signals over time. Analysis is a separate tool — it does not use this chart range.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <Button variant="outline" size="sm" className="ml-auto h-6 text-[11px]" onClick={refreshAll}>Retry</Button>
        </div>
      )}

      <TelemetrySystemStrip host={host} latest={latest} onSelectSection={setEnabledKeys} />

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <LineChart className="h-3.5 w-3.5 text-primary/70" />
            <span className="text-xs font-semibold">Monitor</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
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
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refreshAll} disabled={loading}>
              <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            </Button>
            <Button asChild variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10px]">
              <Link to="/admin/diagnostics/telemetry/explore">
                <Maximize2 className="h-3 w-3" /> Expand
              </Link>
            </Button>
          </div>
        </div>
        <TelemetryMonitorChart
          samples={chartSamples}
          metrics={TELEMETRY_METRICS}
          focusTimestamp={focusTs}
          enabledKeys={enabledKeys}
          onEnabledKeysChange={setEnabledKeys}
          onBrushRange={(from, to) => setRange({ preset: 'custom', from, to })}
        />
      </div>

      <MonitorHints samples={chartSamples} onJump={setFocusTs} />
      <TelemetryMonitorSampleTable range={range} />
    </div>
  )
}
