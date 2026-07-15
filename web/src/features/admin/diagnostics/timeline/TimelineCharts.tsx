import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DOMAIN_LABELS } from '@/lib/diagnosticsConstants'
import type { BucketData, DomainBucketData, CumulativeData } from './timelineCompute'

export const DOMAIN_BAR_COLORS: Record<string, string> = {
  MotorLive: 'bg-sky-500',
  SidecarBrowser: 'bg-violet-500',
  Telemetry: 'bg-emerald-500',
  BrowserQuery: 'bg-purple-500',
  PersistedSessions: 'bg-amber-500',
  DiagnosticsSelf: 'bg-slate-400',
}

export const DOMAIN_HEX: Record<string, string> = {
  MotorLive: '#0ea5e9',
  SidecarBrowser: '#8b5cf6',
  Telemetry: '#10b981',
  BrowserQuery: '#a855f7',
  PersistedSessions: '#f59e0b',
  DiagnosticsSelf: '#94a3b8',
}

export function HistogramChart({ data, selectedBucket, onSelectBucket }: {
  data: BucketData
  selectedBucket: number | null
  onSelectBucket: (i: number | null) => void
}) {
  const chartH = 200
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">{new Date(data.minTime).toLocaleTimeString()}</span>
        <span>{data.buckets.length} buckets · peak {data.max}</span>
        <span className="tabular-nums">{new Date(data.maxTime).toLocaleTimeString()}</span>
      </div>
      <div className="flex items-end gap-[1px]" style={{ height: chartH }}>
        {data.buckets.map((b, i) => {
          const pct = data.max > 0 ? (b.count / data.max) * 100 : 0
          const isSelected = i === selectedBucket
          const hasError = b.errors > 0
          const hasWarning = b.warnings > 0 && !hasError
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectBucket(isSelected ? null : i)}
                  className={cn(
                    'flex-1 rounded-t transition-all',
                    isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
                    b.count === 0
                      ? 'bg-muted/5'
                      : hasError ? 'bg-red-500' : hasWarning ? 'bg-amber-500' : 'bg-sky-500',
                  )}
                  style={{
                    height: `${Math.max(pct, b.count > 0 ? 4 : 0)}%`,
                    opacity: b.count > 0 ? (isSelected ? 1 : 0.8) : 0.03,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{b.count} event{b.count !== 1 ? 's' : ''}</p>
                <p className="text-muted-foreground">
                  {new Date(b.start).toLocaleTimeString()} → {new Date(b.end).toLocaleTimeString()}
                </p>
                {b.errors > 0 && <p className="text-red-400">{b.errors} error{b.errors !== 1 ? 's' : ''}</p>}
                {b.warnings > 0 && <p className="text-amber-400">{b.warnings} warning{b.warnings !== 1 ? 's' : ''}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground/60">Click to drill down</p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

export function HeatmapChart({ data }: { data: DomainBucketData }) {
  const maxVal = Math.max(...data.domains.flatMap((d) => d.counts), 1)
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">{data.bucketStarts.length > 0 && new Date(data.bucketStarts[0]).toLocaleTimeString()}</span>
        <span>Density: darker = more events</span>
        <span className="tabular-nums">{data.bucketEnds.length > 0 && new Date(data.bucketEnds[data.bucketEnds.length - 1]).toLocaleTimeString()}</span>
      </div>
      <div className="space-y-1.5">
        {data.domains.map((d) => (
          <div key={d.domain} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-right text-[11px] text-muted-foreground">
              {DOMAIN_LABELS[d.domain] ?? d.domain}
            </span>
            <div className="flex flex-1 gap-[1px]">
              {d.counts.map((count, i) => {
                const intensity = count / maxVal
                const hex = DOMAIN_HEX[d.domain] ?? '#94a3b8'
                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <div
                        className="flex-1 rounded-[2px] transition-all hover:ring-1 hover:ring-foreground/20"
                        style={{
                          height: 22,
                          backgroundColor: hex,
                          opacity: count > 0 ? 0.15 + intensity * 0.85 : 0.03,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {DOMAIN_LABELS[d.domain] ?? d.domain}: {count} event{count !== 1 ? 's' : ''}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StackedChart({ data }: { data: DomainBucketData }) {
  const chartH = 200
  const stackedMaxes = data.bucketStarts.map((_, i) =>
    data.domains.reduce((sum, d) => sum + d.counts[i], 0),
  )
  const max = Math.max(...stackedMaxes, 1)

  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">{data.bucketStarts.length > 0 && new Date(data.bucketStarts[0]).toLocaleTimeString()}</span>
        <span>Stacked by domain · peak {max}</span>
        <span className="tabular-nums">{data.bucketEnds.length > 0 && new Date(data.bucketEnds[data.bucketEnds.length - 1]).toLocaleTimeString()}</span>
      </div>
      <div className="flex items-end gap-[1px]" style={{ height: chartH }}>
        {data.bucketStarts.map((_, i) => {
          const total = stackedMaxes[i]
          const totalPct = (total / max) * 100
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div className="flex flex-1 flex-col-reverse" style={{ height: `${Math.max(totalPct, total > 0 ? 4 : 0)}%` }}>
                  {data.domains.map((d) => {
                    if (d.counts[i] === 0) return null
                    const segH = total > 0 ? (d.counts[i] / total) * 100 : 0
                    return (
                      <div
                        key={d.domain}
                        className={cn('w-full first:rounded-t', DOMAIN_BAR_COLORS[d.domain] ?? 'bg-slate-400')}
                        style={{ height: `${segH}%`, opacity: 0.85 }}
                      />
                    )
                  })}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{total} total</p>
                {data.domains.filter((d) => d.counts[i] > 0).map((d) => (
                  <p key={d.domain} className="text-muted-foreground">{DOMAIN_LABELS[d.domain] ?? d.domain}: {d.counts[i]}</p>
                ))}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

export function CumulativeChart({ data }: { data: CumulativeData }) {
  if (data.totals.length < 2) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Not enough data for cumulative view</div>
  }
  const max = data.totals[data.totals.length - 1]
  const chartW = 600
  const chartH = 180
  const pad = 2

  const points = data.totals.map((v, i) => ({
    x: pad + (i / (data.totals.length - 1)) * (chartW - pad * 2),
    y: pad + (chartH - pad * 2) - (v / max) * (chartH - pad * 2),
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const fillD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${chartH - pad} L ${points[0].x.toFixed(1)} ${chartH - pad} Z`

  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">{new Date(data.times[0]).toLocaleTimeString()}</span>
        <span>Cumulative total: {max}</span>
        <span className="tabular-nums">{new Date(data.times[data.times.length - 1]).toLocaleTimeString()}</span>
      </div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full text-sky-500" style={{ height: chartH }}>
        <path d={fillD} fill="currentColor" opacity={0.08} />
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3.5} fill="currentColor" />
      </svg>
    </div>
  )
}
