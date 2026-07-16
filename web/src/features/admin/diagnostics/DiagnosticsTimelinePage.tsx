import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  GitBranch,
  Grid3X3,
  Hash,
  Layers,
  RefreshCw,
  TrendingUp,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { DOMAIN_LABELS, EVENT_DOMAINS } from '@/lib/diagnosticsConstants'
import { describeEvent } from '@/lib/diagnosticsDescriptions'
import { useEventStats } from '@/lib/hooks/useEventStats'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageBreadcrumbs } from '@/components/admin/PageBreadcrumbs'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { ExportButton } from '@/components/admin/ExportButton'
import { MultiSelectFilter } from '@/components/admin/MultiSelectFilter'
import { buildBreadcrumbs, type BreadcrumbSegment } from '@/lib/routeMap'
import {
  type ChartMode,
  type TimeRange,
  type BucketSize,
  parseTimeRange,
  computeBucketCount,
  computeBuckets,
  computeDomainBuckets,
  computeCumulative,
} from './timeline/timelineCompute'
import {
  HistogramChart,
  HeatmapChart,
  StackedChart,
  CumulativeChart,
  DOMAIN_BAR_COLORS,
} from './timeline/TimelineCharts'
import { SpanTimeline } from './timeline/SpanTimeline'

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

const CHART_MODES: { value: ChartMode; label: string; icon: typeof BarChart3; tip: string }[] = [
  { value: 'histogram', label: 'Histogram', icon: BarChart3, tip: 'Count per time bucket' },
  { value: 'heatmap', label: 'Heatmap', icon: Grid3X3, tip: 'Domain × time density' },
  { value: 'stacked', label: 'Stacked', icon: Layers, tip: 'Stacked bars by domain' },
  { value: 'cumulative', label: 'Cumulative', icon: TrendingUp, tip: 'Running total' },
  { value: 'spans', label: 'Stories', icon: GitBranch, tip: 'Per-session span story lanes' },
]

const DOMAIN_FILTER_OPTIONS = (EVENT_DOMAINS as readonly string[])
  .map((value) => ({ value, label: DOMAIN_LABELS[value] ?? value }))

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
        setEvents(await diagnosticsApi.getSessionEvents(sessionConnectionId))
      } else {
        const since = timeRange === 'all' ? undefined : new Date(Date.now() - parseTimeRange(timeRange)).toISOString()
        setEvents(await diagnosticsApi.listEvents({ since }))
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
  const bucketCount = useMemo(() => computeBucketCount(filtered, bucketSize), [filtered, bucketSize])
  const effectiveBuckets = Math.round(bucketCount * zoom)

  const bucketData = useMemo(() => computeBuckets(filtered, effectiveBuckets), [filtered, effectiveBuckets])
  const domainBucketData = useMemo(() => computeDomainBuckets(filtered, effectiveBuckets), [filtered, effectiveBuckets])
  const cumulativeData = useMemo(() => computeCumulative(filtered, effectiveBuckets), [filtered, effectiveBuckets])

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
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
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
          <button
            onClick={clearSessionFilter}
            className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Activity className="h-3 w-3" />
            Filtered
            <X className="ml-0.5 h-3 w-3 opacity-60" />
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Toolbar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {/* Row 1: chart mode + controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Chart mode tabs */}
          <div className="flex rounded-lg border border-border bg-muted/30">
            {CHART_MODES.map((mode) => {
              const MIcon = mode.icon
              return (
                <Tooltip key={mode.value}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setChartMode(mode.value)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                        'first:rounded-l-[calc(theme(borderRadius.lg)-1px)] last:rounded-r-[calc(theme(borderRadius.lg)-1px)]',
                        chartMode === mode.value
                          ? 'bg-card text-primary shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <MIcon className="h-3 w-3" /> {mode.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">{mode.tip}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          <div className="hidden sm:block h-5 w-px bg-border" />

          {/* Time & bucket */}
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={bucketSize} onValueChange={(v) => setBucketSize(v as BucketSize)}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <span className="text-muted-foreground mr-1">Bucket:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUCKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <MultiSelectFilter label="Domain" options={DOMAIN_FILTER_OPTIONS} selected={domainFilter} onChange={setDomainFilter} />

          {/* Right-side actions */}
          <div className="ml-auto flex items-center gap-1.5">
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger><TooltipContent className="text-xs">Fewer buckets</TooltipContent></Tooltip>

            <span className="w-9 text-center text-[10px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger><TooltipContent className="text-xs">More buckets</TooltipContent></Tooltip>

            <div className="h-4 w-px bg-border" />

            <ExportButton data={filtered} filename="timeline-events" />
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void loadEvents()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>

        {/* Row 2: stats */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            <strong className="text-foreground tabular-nums">{stats.eventRate}</strong>/min
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            <strong className="text-foreground tabular-nums">{stats.uniqueConnections}</strong> session{stats.uniqueConnections !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            <strong className="text-foreground tabular-nums">{stats.uniqueCorrelations}</strong> stor{stats.uniqueCorrelations !== 1 ? 'ies' : 'y'}
          </span>
          <span className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            <strong className="text-foreground tabular-nums">{Object.keys(stats.byName).length}</strong> types
          </span>
          {stats.errorCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3 w-3" />
              <strong className="tabular-nums">{stats.errorCount}</strong> error{stats.errorCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/20" />
            <p className="mt-3 text-sm text-muted-foreground">No events in this time range</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Try expanding the time window or clearing filters</p>
          </div>
        ) : chartMode === 'histogram' ? (
          <HistogramChart data={bucketData} selectedBucket={selectedBucket} onSelectBucket={setSelectedBucket} />
        ) : chartMode === 'heatmap' ? (
          <HeatmapChart data={domainBucketData} />
        ) : chartMode === 'stacked' ? (
          <StackedChart data={domainBucketData} />
        ) : chartMode === 'spans' ? (
          <SpanTimeline events={filtered} />
        ) : (
          <CumulativeChart data={cumulativeData} />
        )}
      </div>

      {/* Domain legend */}
      {Object.keys(stats.byDomain).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Domains</span>
          {Object.entries(DOMAIN_LABELS).filter(([k]) => stats.byDomain[k]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDomainFilter((f) => f.includes(key) ? f.filter((d) => d !== key) : [...f, key])}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                domainFilter.includes(key)
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
              )}
            >
              <div className={cn('h-2 w-2 rounded-full', DOMAIN_BAR_COLORS[key] ?? 'bg-slate-400')} />
              {label}
              <Badge variant="muted" className="ml-0.5 px-1 py-0 text-[9px] tabular-nums">{stats.byDomain[key]}</Badge>
            </button>
          ))}
        </div>
      )}

      {/* Drill-down panel */}
      {selectedBucket !== null && selectedEvents.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 bg-primary/5">
            <p className="flex items-center gap-2 text-xs font-medium text-primary">
              <ZoomIn className="h-3.5 w-3.5" />
              Bucket drill-down
              <Badge variant="muted" className="text-[10px] tabular-nums">{selectedEvents.length}</Badge>
              <span className="font-normal text-muted-foreground tabular-nums">
                {new Date(bucketData.buckets[selectedBucket].start).toLocaleTimeString()}
                {' → '}
                {new Date(bucketData.buckets[selectedBucket].end).toLocaleTimeString()}
              </span>
            </p>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setSelectedBucket(null)}>
              Close
            </Button>
          </div>

          {/* Severity pills */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border/20 bg-muted/5">
            {(['Info', 'Warning', 'Error', 'Metric'] as const).map((sev) => {
              const count = selectedEvents.filter((e) => e.severity === sev).length
              if (count === 0) return null
              return (
                <span key={sev} className={cn(
                  'flex items-center gap-1 text-[11px] font-medium',
                  sev === 'Error' ? 'text-destructive' : sev === 'Warning' ? 'text-warning' : 'text-muted-foreground',
                )}>
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    sev === 'Error' ? 'bg-destructive' : sev === 'Warning' ? 'bg-warning' : sev === 'Metric' ? 'bg-muted-foreground' : 'bg-sky-500',
                  )} />
                  {sev}: {count}
                </span>
              )
            })}
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-border/10">
            {selectedEvents.map((evt) => {
              const dotColor = evt.severity === 'Error' ? 'bg-destructive' : evt.severity === 'Warning' ? 'bg-warning' : evt.severity === 'Metric' ? 'bg-muted-foreground' : 'bg-sky-500'
              return (
                <Tooltip key={evt.id}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-muted/20 transition-colors">
                      <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />
                      <span className="w-16 shrink-0 tabular-nums text-muted-foreground/60">
                        {new Date(evt.utc).toLocaleTimeString()}
                      </span>
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

      {/* Top event types */}
      {stats.topEvents.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/40">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top event types</p>
          </div>
          <div className="divide-y divide-border/10">
            {stats.topEvents.slice(0, 8).map(({ name, count }) => (
              <div key={name} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                <div className="w-28 rounded-full bg-muted/20" style={{ height: 5 }}>
                  <div
                    className="h-full rounded-full bg-sky-500/70 transition-all"
                    style={{ width: `${(count / stats.topEvents[0].count) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
