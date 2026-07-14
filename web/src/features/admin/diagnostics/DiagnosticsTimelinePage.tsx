import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { PageBreadcrumbs } from '@/components/admin/PageBreadcrumbs'
import { buildBreadcrumbs, type BreadcrumbSegment } from '@/lib/routeMap'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ExportButton } from '@/components/admin/ExportButton'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { MultiSelectFilter } from '@/components/admin/MultiSelectFilter'
import { Sparkline } from '@/components/admin/Sparkline'
import { useEventStats } from '@/lib/hooks/useEventStats'
import {
  DOMAIN_LABELS, DOMAIN_COLORS, formatRelativeTime,
} from '@/lib/diagnosticsConstants'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  RefreshCw, BarChart3, Clock, Activity,
  TrendingUp, Layers, AlertTriangle, ZoomIn, ZoomOut,
  ChevronLeft, ChevronRight, Maximize2, Grid3X3,
  Users, Hash, GitBranch,
} from 'lucide-react'

type ChartMode = 'histogram' | 'heatmap' | 'stacked' | 'cumulative'
type TimeRange = '15m' | '1h' | '6h' | '24h' | 'all'
type BucketSize = 'auto' | '1m' | '5m' | '15m' | '1h'

const TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: 'all', label: 'All time' },
]

const BUCKET_OPTIONS: { value: BucketSize; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1m', label: '1 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
]

const CHART_MODES: { value: ChartMode; label: string; icon: typeof BarChart3; description: string }[] = [
  { value: 'histogram', label: 'Histogram', icon: BarChart3, description: 'Event count per time bucket' },
  { value: 'heatmap', label: 'Heatmap', icon: Grid3X3, description: 'Domain × time density grid' },
  { value: 'stacked', label: 'Stacked', icon: Layers, description: 'Stacked bars by domain' },
  { value: 'cumulative', label: 'Cumulative', icon: TrendingUp, description: 'Running total over time' },
]

const DOMAIN_BAR_COLORS: Record<string, string> = {
  'Motor.Live': 'bg-sky-500',
  'Sidecar.Browser': 'bg-violet-500',
  'HostResources': 'bg-emerald-500',
  'BrowserQuery': 'bg-purple-500',
  'Persistence': 'bg-amber-500',
  'Diagnostics.Self': 'bg-slate-400',
}

const DOMAIN_HEX: Record<string, string> = {
  'Motor.Live': '#0ea5e9',
  'Sidecar.Browser': '#8b5cf6',
  'HostResources': '#10b981',
  'BrowserQuery': '#a855f7',
  'Persistence': '#f59e0b',
  'Diagnostics.Self': '#94a3b8',
}

const SEVERITY_HEX: Record<string, string> = {
  Info: '#0ea5e9',
  Warning: '#f59e0b',
  Error: '#ef4444',
  Metric: '#94a3b8',
}

const DOMAIN_FILTER_OPTIONS = Object.entries(DOMAIN_LABELS)
  .filter(([k]) => k.includes('.') || ['Persistence', 'HostResources', 'BrowserQuery'].includes(k))
  .map(([value, label]) => ({ value, label }))

export default function DiagnosticsTimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionConnectionId = searchParams.get('connectionId')
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<ChartMode>('histogram')
  const [timeRange, setTimeRange] = useState<TimeRange>(sessionConnectionId ? 'all' : '1h')
  const [bucketSize, setBucketSize] = useState<BucketSize>('auto')
  const [domainFilter, setDomainFilter] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (sessionConnectionId) {
        const data = await diagnosticsApi.getSessionEvents(sessionConnectionId)
        setEvents(data)
      } else {
        const since = timeRange === 'all' ? undefined : new Date(Date.now() - parseTimeRange(timeRange)).toISOString()
        const data = await diagnosticsApi.listEvents({ since })
        setEvents(data)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [timeRange, sessionConnectionId])

  useEffect(() => { void loadEvents() }, [loadEvents])

  function clearSessionFilter() {
    setSearchParams((p) => { p.delete('connectionId'); return p }, { replace: true })
  }

  const filtered = useMemo(() => {
    if (domainFilter.length === 0) return events
    return events.filter((e) => domainFilter.includes(e.domain))
  }, [events, domainFilter])

  const stats = useEventStats(filtered)

  const bucketCount = useMemo(() => {
    if (bucketSize === 'auto') return Math.min(Math.max(Math.round(filtered.length / 3), 15), 60)
    const ms = parseBucketSize(bucketSize)
    if (filtered.length < 2) return 20
    const times = filtered.map((e) => new Date(e.utc).getTime())
    const range = Math.max(...times) - Math.min(...times)
    return Math.max(5, Math.min(100, Math.round(range / ms)))
  }, [filtered, bucketSize])

  const bucketData = useMemo(() => computeBuckets(filtered, Math.round(bucketCount * zoom)), [filtered, bucketCount, zoom])
  const domainBucketData = useMemo(() => computeDomainBuckets(filtered, Math.round(bucketCount * zoom)), [filtered, bucketCount, zoom])
  const cumulativeData = useMemo(() => computeCumulative(filtered, Math.round(bucketCount * zoom)), [filtered, bucketCount, zoom])

  const selectedEvents = useMemo(() => {
    if (selectedBucket === null || !bucketData.buckets[selectedBucket]) return []
    const bucket = bucketData.buckets[selectedBucket]
    return filtered.filter((e) => {
      const t = new Date(e.utc).getTime()
      return t >= bucket.start && t < bucket.end
    })
  }, [selectedBucket, bucketData, filtered])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <PageBreadcrumbs items={
          sessionConnectionId
            ? [
                { label: 'Sessions', to: '/admin/sessions' },
                { label: `Session ${sessionConnectionId.split('-').slice(1, 3).join('-')}`, to: `/admin/sessions/${sessionConnectionId}` },
                { label: 'Timeline' },
              ] satisfies BreadcrumbSegment[]
            : buildBreadcrumbs('/admin/diagnostics/timeline')
        } />
        {sessionConnectionId && (
          <button onClick={clearSessionFilter} className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20 transition-colors">
            <Activity className="h-3 w-3" /> Filtered
            <span className="ml-0.5 opacity-60">&times;</span>
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} events</span>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chart mode selector */}
          <div className="flex rounded-md border border-border">
            {CHART_MODES.map((mode) => {
              const MIcon = mode.icon
              return (
                <Tooltip key={mode.value}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setChartMode(mode.value)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md',
                        chartMode === mode.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                        mode.value !== 'histogram' && 'border-l border-border',
                      )}
                    >
                      <MIcon className="h-3 w-3" /> {mode.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">{mode.description}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          <div className="h-5 w-px bg-border" />

          {/* Time range */}
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Bucket size */}
          <Select value={bucketSize} onValueChange={(v) => setBucketSize(v as BucketSize)}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue placeholder="Bucket" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" disabled>Bucket size</SelectItem>
              {BUCKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <MultiSelectFilter label="Domain" options={DOMAIN_FILTER_OPTIONS} selected={domainFilter} onChange={setDomainFilter} />

          <div className="ml-auto flex items-center gap-1">
            {/* Zoom controls */}
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}>
                <ZoomOut className="h-3 w-3" />
              </Button>
            </TooltipTrigger><TooltipContent className="text-xs">Fewer buckets</TooltipContent></Tooltip>
            <span className="w-10 text-center text-[10px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3}>
                <ZoomIn className="h-3 w-3" />
              </Button>
            </TooltipTrigger><TooltipContent className="text-xs">More buckets</TooltipContent></Tooltip>

            <div className="h-5 w-px bg-border mx-1" />
            <ExportButton data={filtered} filename="timeline-events" />
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void loadEvents()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /><strong className="text-foreground">{stats.eventRate}</strong>/min</span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /><strong className="text-foreground">{stats.uniqueConnections}</strong> sessions</span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /><strong className="text-foreground">{stats.uniqueCorrelations}</strong> stories</span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1"><Hash className="h-3 w-3" /><strong className="text-foreground">{Object.keys(stats.byName).length}</strong> types</span>
          {stats.errorCount > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="h-3 w-3" /><strong>{stats.errorCount}</strong> errors</span>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Main chart area */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">No events in this time range</p>
          </div>
        ) : chartMode === 'histogram' ? (
          <HistogramChart data={bucketData} zoom={zoom} selectedBucket={selectedBucket} onSelectBucket={setSelectedBucket} />
        ) : chartMode === 'heatmap' ? (
          <HeatmapChart data={domainBucketData} events={filtered} />
        ) : chartMode === 'stacked' ? (
          <StackedChart data={domainBucketData} />
        ) : (
          <CumulativeChart data={cumulativeData} />
        )}
      </div>

      {/* Domain legend */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Domains</span>
        {Object.entries(DOMAIN_LABELS).filter(([k]) => stats.byDomain[k]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setDomainFilter((f) => f.includes(key) ? f.filter((d) => d !== key) : [...f, key])}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              domainFilter.includes(key) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <div className={cn('h-2 w-2 rounded-full', DOMAIN_BAR_COLORS[key] ?? 'bg-slate-400')} />
            {label} <span className="font-mono text-[10px] opacity-50">{stats.byDomain[key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Drill-down panel */}
      {selectedBucket !== null && selectedEvents.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <p className="flex items-center gap-2 text-xs font-semibold text-primary">
              <ZoomIn className="h-3.5 w-3.5" />
              Bucket drill-down — {selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}
              <span className="font-normal text-muted-foreground">
                {new Date(bucketData.buckets[selectedBucket].start).toLocaleTimeString()}
                {' → '}
                {new Date(bucketData.buckets[selectedBucket].end).toLocaleTimeString()}
              </span>
            </p>
            <button onClick={() => setSelectedBucket(null)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
          </div>

          {/* Severity breakdown for this bucket */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border/20 bg-muted/10">
            {['Info', 'Warning', 'Error', 'Metric'].map((sev) => {
              const count = selectedEvents.filter((e) => e.severity === sev).length
              if (count === 0) return null
              const color = sev === 'Error' ? 'text-red-400' : sev === 'Warning' ? 'text-amber-400' : sev === 'Metric' ? 'text-slate-400' : 'text-sky-400'
              return (
                <span key={sev} className={cn('text-[11px] font-medium', color)}>
                  {sev}: {count}
                </span>
              )
            })}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {selectedEvents.map((evt, i) => {
              const dotColor = evt.severity === 'Error' ? 'bg-red-500' : evt.severity === 'Warning' ? 'bg-amber-500' : evt.severity === 'Metric' ? 'bg-slate-400' : 'bg-sky-500'
              return (
                <Tooltip key={evt.id}>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      'flex items-center gap-3 px-4 py-1.5 text-xs hover:bg-muted/20',
                      i < selectedEvents.length - 1 && 'border-b border-border/10',
                    )}>
                      <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />
                      <span className="w-16 shrink-0 tabular-nums text-muted-foreground/60">{new Date(evt.utc).toLocaleTimeString()}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{evt.name.split('.').pop()}</span>
                      <DomainBadge domain={evt.domain} showTooltip={false} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs text-xs">
                    <p className="font-bold">{evt.name}</p>
                    <p className="mt-1 text-muted-foreground">{describeEvent(evt.name)}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
      )}

      {/* Top events table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/40">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top event types</p>
        </div>
        <div className="divide-y divide-border/20">
          {stats.topEvents.slice(0, 8).map(({ name, count }) => (
            <div key={name} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <div className="w-32 rounded-full bg-muted/20" style={{ height: 5 }}>
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${(count / stats.topEvents[0].count) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Chart components ──────────────────────────────────────────────── */

interface BucketInfo { start: number; end: number; count: number; errors: number; warnings: number }
interface BucketData { buckets: BucketInfo[]; max: number; minTime: number; maxTime: number }

function HistogramChart({ data, zoom, selectedBucket, onSelectBucket }: {
  data: BucketData; zoom: number; selectedBucket: number | null; onSelectBucket: (i: number | null) => void
}) {
  const chartH = 180
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{new Date(data.minTime).toLocaleTimeString()}</span>
        <span>{data.buckets.length} buckets · peak {data.max}</span>
        <span>{new Date(data.maxTime).toLocaleTimeString()}</span>
      </div>
      <div className="flex items-end gap-px" style={{ height: chartH }}>
        {data.buckets.map((b, i) => {
          const pct = data.max > 0 ? (b.count / data.max) * 100 : 0
          const isSelected = i === selectedBucket
          const hasError = b.errors > 0
          const hasWarning = b.warnings > 0
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectBucket(isSelected ? null : i)}
                  className={cn(
                    'flex-1 rounded-t-sm transition-all',
                    isSelected ? 'ring-1 ring-primary' : 'hover:opacity-70',
                    b.count === 0 ? 'bg-muted/10' : hasError ? 'bg-red-500' : hasWarning ? 'bg-amber-500' : 'bg-sky-500',
                  )}
                  style={{
                    height: `${Math.max(pct, b.count > 0 ? 3 : 0)}%`,
                    opacity: b.count > 0 ? (isSelected ? 1 : 0.75) : 0.05,
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

interface DomainBucket { domain: string; counts: number[] }
interface DomainBucketData { domains: DomainBucket[]; bucketStarts: number[]; bucketEnds: number[]; max: number; maxStacked: number }

function HeatmapChart({ data, events }: { data: DomainBucketData; events: DiagnosticsEventRecord[] }) {
  const maxVal = Math.max(...data.domains.flatMap((d) => d.counts), 1)
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{data.bucketStarts.length > 0 && new Date(data.bucketStarts[0]).toLocaleTimeString()}</span>
        <span>Density: darker = more events</span>
        <span>{data.bucketEnds.length > 0 && new Date(data.bucketEnds[data.bucketEnds.length - 1]).toLocaleTimeString()}</span>
      </div>
      <div className="space-y-1">
        {data.domains.map((d) => (
          <div key={d.domain} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-right text-[11px] text-muted-foreground">{DOMAIN_LABELS[d.domain] ?? d.domain}</span>
            <div className="flex flex-1 gap-px">
              {d.counts.map((count, i) => {
                const intensity = count / maxVal
                const hex = DOMAIN_HEX[d.domain] ?? '#94a3b8'
                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <div
                        className="flex-1 rounded-sm transition-all hover:ring-1 hover:ring-foreground/20"
                        style={{
                          height: 20,
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

function StackedChart({ data }: { data: DomainBucketData }) {
  const chartH = 180
  const stackedMaxes = data.bucketStarts.map((_, i) =>
    data.domains.reduce((sum, d) => sum + d.counts[i], 0),
  )
  const max = Math.max(...stackedMaxes, 1)

  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{data.bucketStarts.length > 0 && new Date(data.bucketStarts[0]).toLocaleTimeString()}</span>
        <span>Stacked by domain · peak {max}</span>
        <span>{data.bucketEnds.length > 0 && new Date(data.bucketEnds[data.bucketEnds.length - 1]).toLocaleTimeString()}</span>
      </div>
      <div className="flex items-end gap-px" style={{ height: chartH }}>
        {data.bucketStarts.map((_, i) => {
          const total = stackedMaxes[i]
          const totalPct = (total / max) * 100
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div className="flex flex-1 flex-col-reverse gap-0" style={{ height: `${Math.max(totalPct, total > 0 ? 3 : 0)}%` }}>
                  {data.domains.map((d) => {
                    if (d.counts[i] === 0) return null
                    const segH = total > 0 ? (d.counts[i] / total) * 100 : 0
                    return (
                      <div
                        key={d.domain}
                        className={cn('w-full first:rounded-t-sm', DOMAIN_BAR_COLORS[d.domain] ?? 'bg-slate-400')}
                        style={{ height: `${segH}%`, opacity: 0.8 }}
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

function CumulativeChart({ data }: { data: { times: number[]; totals: number[] } }) {
  if (data.totals.length < 2) return <div className="p-8 text-center text-sm text-muted-foreground">Not enough data</div>
  const max = data.totals[data.totals.length - 1]
  const chartW = 600
  const chartH = 160
  const pad = 2

  const points = data.totals.map((v, i) => ({
    x: pad + (i / (data.totals.length - 1)) * (chartW - pad * 2),
    y: pad + (chartH - pad * 2) - (v / max) * (chartH - pad * 2),
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const fillD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${chartH - pad} L ${points[0].x.toFixed(1)} ${chartH - pad} Z`

  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{new Date(data.times[0]).toLocaleTimeString()}</span>
        <span>Cumulative total: {max}</span>
        <span>{new Date(data.times[data.times.length - 1]).toLocaleTimeString()}</span>
      </div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full text-sky-500" style={{ height: chartH }}>
        <path d={fillD} fill="currentColor" opacity={0.1} />
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill="currentColor" />
      </svg>
    </div>
  )
}

/* ── Computation helpers ────────────────────────────────────────────── */

function parseTimeRange(range: TimeRange): number {
  const map: Record<string, number> = { '15m': 15 * 60_000, '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86400_000 }
  return map[range] ?? 3600_000
}

function parseBucketSize(size: BucketSize): number {
  const map: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3600_000 }
  return map[size] ?? 300_000
}

function computeBuckets(events: DiagnosticsEventRecord[], buckets: number): BucketData {
  if (events.length === 0) return { buckets: [], max: 0, minTime: Date.now(), maxTime: Date.now() }
  const times = events.map((e) => new Date(e.utc).getTime())
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const range = maxTime - minTime || 1
  const step = range / buckets

  const result: BucketInfo[] = Array.from({ length: buckets }, (_, i) => ({
    start: minTime + i * step,
    end: minTime + (i + 1) * step,
    count: 0, errors: 0, warnings: 0,
  }))

  for (const evt of events) {
    const t = new Date(evt.utc).getTime()
    const idx = Math.min(Math.floor(((t - minTime) / range) * buckets), buckets - 1)
    result[idx].count++
    if (evt.severity === 'Error') result[idx].errors++
    if (evt.severity === 'Warning') result[idx].warnings++
  }

  return { buckets: result, max: Math.max(...result.map((b) => b.count)), minTime, maxTime }
}

function computeDomainBuckets(events: DiagnosticsEventRecord[], bucketCount: number): DomainBucketData {
  if (events.length === 0) return { domains: [], bucketStarts: [], bucketEnds: [], max: 0, maxStacked: 0 }
  const times = events.map((e) => new Date(e.utc).getTime())
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const range = maxTime - minTime || 1
  const step = range / bucketCount

  const domainSet = [...new Set(events.map((e) => e.domain))]
  const domainCounts = Object.fromEntries(domainSet.map((d) => [d, new Array(bucketCount).fill(0) as number[]]))

  for (const evt of events) {
    const t = new Date(evt.utc).getTime()
    const idx = Math.min(Math.floor(((t - minTime) / range) * bucketCount), bucketCount - 1)
    domainCounts[evt.domain][idx]++
  }

  const domains = domainSet.map((domain) => ({ domain, counts: domainCounts[domain] }))
  const bucketStarts = Array.from({ length: bucketCount }, (_, i) => minTime + i * step)
  const bucketEnds = Array.from({ length: bucketCount }, (_, i) => minTime + (i + 1) * step)
  const max = Math.max(...domains.flatMap((d) => d.counts), 1)
  const maxStacked = Math.max(...bucketStarts.map((_, i) => domains.reduce((sum, d) => sum + d.counts[i], 0)), 1)

  return { domains, bucketStarts, bucketEnds, max, maxStacked }
}

function computeCumulative(events: DiagnosticsEventRecord[], points: number): { times: number[]; totals: number[] } {
  if (events.length === 0) return { times: [], totals: [] }
  const sorted = [...events].sort((a, b) => new Date(a.utc).getTime() - new Date(b.utc).getTime())
  const times = sorted.map((e) => new Date(e.utc).getTime())
  const minTime = times[0]
  const maxTime = times[times.length - 1]
  const range = maxTime - minTime || 1
  const step = range / points

  const result: number[] = []
  const resultTimes: number[] = []
  let cumulative = 0
  let eventIdx = 0

  for (let i = 0; i < points; i++) {
    const bucketEnd = minTime + (i + 1) * step
    while (eventIdx < times.length && times[eventIdx] <= bucketEnd) {
      cumulative++
      eventIdx++
    }
    resultTimes.push(minTime + (i + 0.5) * step)
    result.push(cumulative)
  }

  return { times: resultTimes, totals: result }
}
