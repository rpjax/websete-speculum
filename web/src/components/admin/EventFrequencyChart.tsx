import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DOMAIN_LABELS } from '@/lib/diagnosticsConstants'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

interface EventFrequencyChartProps {
  events: DiagnosticsEventRecord[]
  groupBy: 'domain' | 'severity' | 'name'
  limit?: number
  className?: string
}

const DOMAIN_BAR: Record<string, string> = {
  'Motor.Live': 'bg-sky-500',
  'Sidecar.Browser': 'bg-violet-500',
  'HostResources': 'bg-emerald-500',
  'BrowserQuery': 'bg-purple-500',
  'Persistence': 'bg-amber-500',
  'Diagnostics.Self': 'bg-slate-400',
}

const SEVERITY_BAR: Record<string, string> = {
  Info: 'bg-sky-500',
  Warning: 'bg-amber-500',
  Error: 'bg-red-500',
  Metric: 'bg-slate-400',
}

export function EventFrequencyChart({ events, groupBy, limit = 8, className }: EventFrequencyChartProps) {
  const counts: Record<string, number> = {}
  for (const evt of events) {
    const key = groupBy === 'name' ? evt.name.split('.').pop() ?? evt.name : evt[groupBy]
    counts[key] = (counts[key] ?? 0) + 1
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)

  if (sorted.length === 0) return null
  const max = sorted[0][1]

  function getBarClass(key: string): string {
    if (groupBy === 'domain') return DOMAIN_BAR[key] ?? 'bg-sky-500'
    if (groupBy === 'severity') return SEVERITY_BAR[key] ?? 'bg-sky-500'
    return 'bg-sky-500'
  }

  return (
    <div className={cn('space-y-1', className)}>
      {sorted.map(([key, count]) => {
        const pct = (count / max) * 100
        const label = groupBy === 'domain' ? (DOMAIN_LABELS[key] ?? key) : key
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground">{label}</span>
                <div className="flex-1 rounded-full bg-muted/20" style={{ height: 6 }}>
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', getBarClass(key))}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-[11px] font-medium tabular-nums">{count}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              <strong>{label}</strong>: {count} event{count !== 1 ? 's' : ''} ({Math.round((count / events.length) * 100)}%)
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

interface TimeDistributionChartProps {
  events: DiagnosticsEventRecord[]
  buckets?: number
  className?: string
  height?: number
}

export function TimeDistributionChart({ events, buckets = 20, className, height = 80 }: TimeDistributionChartProps) {
  if (events.length === 0) return null

  const times = events.map((e) => new Date(e.utc).getTime()).sort((a, b) => a - b)
  const minTime = times[0]
  const maxTime = times[times.length - 1]
  const range = maxTime - minTime || 1
  const rangeMins = Math.max(1, Math.round(range / 60_000))

  const bucketCounts = new Array(buckets).fill(0) as number[]
  const bucketErrors = new Array(buckets).fill(0) as number[]
  const bucketWarnings = new Array(buckets).fill(0) as number[]
  for (const evt of events) {
    const t = new Date(evt.utc).getTime()
    const idx = Math.min(Math.floor(((t - minTime) / range) * buckets), buckets - 1)
    bucketCounts[idx]++
    if (evt.severity === 'Error') bucketErrors[idx]++
    if (evt.severity === 'Warning') bucketWarnings[idx]++
  }

  const maxCount = Math.max(...bucketCounts, 1)
  const avgCount = events.length / buckets
  const peakIdx = bucketCounts.indexOf(maxCount)

  const errorTotal = events.filter((e) => e.severity === 'Error').length
  const warnTotal = events.filter((e) => e.severity === 'Warning').length
  const infoTotal = events.length - errorTotal - warnTotal

  return (
    <div className={cn('rounded-xl border border-border/50 bg-muted/10 p-4', className)}>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Event distribution over time</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            {events.length} events across {rangeMins} minute{rangeMins !== 1 ? 's' : ''} · avg {avgCount.toFixed(1)}/bucket · peak {maxCount}
          </p>
        </div>
        {/* Severity breakdown mini-strip */}
        <div className="flex items-center gap-3 text-[10px]">
          {infoTotal > 0 && <span className="flex items-center gap-1 text-sky-400"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> {infoTotal}</span>}
          {warnTotal > 0 && <span className="flex items-center gap-1 text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {warnTotal}</span>}
          {errorTotal > 0 && <span className="flex items-center gap-1 text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> {errorTotal}</span>}
        </div>
      </div>

      {/* Chart */}
      <div className="flex items-end gap-px" style={{ height }}>
        {bucketCounts.map((count, i) => {
          const hasError = bucketErrors[i] > 0
          const hasWarning = bucketWarnings[i] > 0
          const isSpike = count > maxCount * 0.8
          const isPeak = i === peakIdx && count > 0
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex-1 rounded-t-sm transition-all hover:opacity-60',
                    count > 0
                      ? hasError ? 'bg-red-500' : hasWarning ? 'bg-amber-500' : isSpike ? 'bg-sky-400' : 'bg-sky-500'
                      : 'bg-muted/15',
                    isPeak && 'ring-1 ring-sky-400/40',
                  )}
                  style={{
                    height: `${Math.max((count / maxCount) * 100, count > 0 ? 4 : 0)}%`,
                    opacity: count > 0 ? 0.8 : 0.05,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{count} event{count !== 1 ? 's' : ''}</p>
                {bucketErrors[i] > 0 && <p className="text-red-400">{bucketErrors[i]} error{bucketErrors[i] !== 1 ? 's' : ''}</p>}
                {bucketWarnings[i] > 0 && <p className="text-amber-400">{bucketWarnings[i]} warning{bucketWarnings[i] !== 1 ? 's' : ''}</p>}
                {isPeak && <p className="text-sky-400 font-medium">Peak bucket</p>}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Time axis */}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/50">
        <span>{new Date(minTime).toLocaleTimeString()}</span>
        {rangeMins > 5 && <span>{new Date(minTime + range / 2).toLocaleTimeString()}</span>}
        <span>{new Date(maxTime).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
