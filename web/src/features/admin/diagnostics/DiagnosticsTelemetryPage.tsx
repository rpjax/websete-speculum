import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticsApi, type HostTelemetry } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceChartExplorer, ResourceTimeRangeControls } from '@/components/admin/ResourceChartExplorer'
import { TELEMETRY_METRICS, computeStats, type TimePreset } from '@/lib/resourceChartCompute'
import { LiveStrip } from './telemetry/LiveStrip'
import { TelemetryInsights } from './telemetry/TelemetryInsights'
import { TelemetrySampleTable } from './telemetry/TelemetrySampleTable'
import { useTelemetryHistory, type TelemetryRange } from './telemetry/useTelemetryHistory'
import { RefreshCw, Maximize2, AlertTriangle, Activity } from 'lucide-react'

export default function DiagnosticsTelemetryPage() {
  const [range, setRange] = useState<TelemetryRange>({ preset: '6h', from: null, to: null })
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
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadHost, 10_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadHost])

  const stats = useMemo(() => {
    if (chartSamples.length < 2) return null
    return {
      cpu: computeStats(chartSamples.map((s) => s.cpu)),
      memory: computeStats(chartSamples.map((s) => s.memoryMb)),
      sessions: computeStats(chartSamples.map((s) => s.values?.['motor.live'] ?? 0)),
    }
  }, [chartSamples])

  function refreshAll() {
    void reload()
    loadHost()
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary/70" />
          <span className="text-xs font-semibold">Telemetry explorer</span>
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
              <Maximize2 className="h-3 w-3" /> Explore
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <Button variant="outline" size="sm" className="ml-auto h-6 text-[11px]" onClick={refreshAll}>Retry</Button>
        </div>
      )}

      <LiveStrip host={host} latest={latest} />

      {/* Primary explorer */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <ResourceChartExplorer
          samples={chartSamples}
          metrics={TELEMETRY_METRICS}
          focusTimestamp={focusTs}
          onBrushRange={(from, to) => setRange({ preset: 'custom', from, to })}
        />
      </div>

      {/* Insights + range stats */}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <TelemetryInsights samples={chartSamples} onJump={setFocusTs} />
        {stats && (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border/30 px-3 py-1.5 bg-muted/5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Range summary</span>
            </div>
            <div className="divide-y divide-border/10">
              <StatRow label="CPU" color="rgb(59,130,246)" unit="%" s={stats.cpu} />
              <StatRow label="Memory" color="rgb(168,85,247)" unit=" MB" s={stats.memory} />
              <StatRow label="Active sessions" color="rgb(245,158,11)" unit="" s={stats.sessions} />
            </div>
          </div>
        )}
      </div>

      {/* Raw sample log */}
      <TelemetrySampleTable range={range} />
    </div>
  )
}

function StatRow({ label, color, unit, s }: {
  label: string; color: string; unit: string; s: { min: number; max: number; avg: number; p95: number; p99: number }
}) {
  const round1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString()
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex items-center gap-1.5 min-w-[92px]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[11px] font-medium">{label}</span>
      </span>
      <div className="ml-auto grid grid-cols-5 gap-2 text-center">
        {(['min', 'avg', 'max', 'p95', 'p99'] as const).map((k) => (
          <div key={k}>
            <p className="text-[8px] uppercase text-muted-foreground/50">{k}</p>
            <p className="text-[11px] font-bold tabular-nums">{round1(s[k])}{unit}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
