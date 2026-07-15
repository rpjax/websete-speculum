import { useCallback, useEffect, useState, useMemo } from 'react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchInput } from '@/components/admin/SearchInput'
import { PaginationBar } from '@/components/admin/PaginationBar'
import { ExportButton } from '@/components/admin/ExportButton'
import { ResourceChartExplorer, ResourceTimeRangeControls, type MetricDef } from '@/components/admin/ResourceChartExplorer'
import { usePagination } from '@/lib/hooks/usePagination'
import { usePolling } from '@/lib/hooks/usePolling'
import { formatBytes } from '@/lib/diagnosticsConstants'
import {
  filterByTimeRange,
  computeStats,
  type ResourceSample,
  type TimePreset,
} from '@/lib/resourceChartCompute'
import { cn } from '@/lib/utils'
import {
  RefreshCw, AlertTriangle, Cpu, HardDrive, MemoryStick,
  Server, Clock, Layers,
  ArrowUpDown, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'

interface HostData {
  hostname?: string
  uptimeSec?: number
  cpuUsage?: number
  memoryUsed?: number
  memoryTotal?: number
  diskFreeBytes?: number
  threadCount?: number
}

const METRICS: MetricDef[] = [
  { key: 'cpu', label: 'CPU', unit: '%', color: 'rgb(59,130,246)', fill: 'rgba(59,130,246,0.1)', extract: (s) => s.cpu },
  { key: 'memory', label: 'Memory', unit: ' MB', color: 'rgb(168,85,247)', fill: 'rgba(168,85,247,0.1)', extract: (s) => s.memoryMb },
  { key: 'threads', label: 'Threads', unit: '', color: 'rgb(34,197,94)', fill: 'rgba(34,197,94,0.1)', extract: (s) => s.threads ?? 0 },
]

type SortField = 'utc' | 'cpu' | 'memoryMb' | 'threads'
type SortDir = 'asc' | 'desc'

export default function DiagnosticsResourcesPage() {
  const [host, setHost] = useState<HostData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [hostEvents, setHostEvents] = useState<DiagnosticsEventRecord[]>([])

  const [timePreset, setTimePreset] = useState<TimePreset>('1h')
  const [customFrom, setCustomFrom] = useState<number | null>(null)
  const [customTo, setCustomTo] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('utc')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [hostData, events] = await Promise.all([
        diagnosticsApi.getHost().catch(() => null),
        diagnosticsApi.listEvents({ namePrefix: 'Telemetry.' }).catch(() => []),
      ])
      if (hostData) setHost(hostData as unknown as HostData)
      setHostEvents(events)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load host data')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  usePolling(refresh, 5_000, autoRefresh)

  const allSamples = useMemo((): ResourceSample[] => {
    return hostEvents
      .filter((e) => e.name === 'Telemetry.SampleCollected')
      .map((evt) => {
        const payload = evt.payload as Record<string, unknown> | null
        const host = (payload?.host ?? null) as Record<string, unknown> | null
        if (!host) return null
        const memBytes = typeof host.memoryUsed === 'number' ? (host.memoryUsed as number) : 0
        return {
          utc: evt.utc,
          timestamp: new Date(evt.utc).getTime(),
          cpu: typeof host.cpuUsage === 'number' ? Math.round((host.cpuUsage as number) * 10) / 10 : 0,
          memoryMb: memBytes > 0 ? Math.round(memBytes / (1024 * 1024)) : 0,
          threads: typeof host.threadCount === 'number' ? (host.threadCount as number) : null,
        } satisfies ResourceSample
      })
      .filter((s): s is ResourceSample => s !== null)
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [hostEvents])

  const rangeSamples = useMemo(
    () => filterByTimeRange(allSamples, timePreset, customFrom, customTo),
    [allSamples, timePreset, customFrom, customTo],
  )

  const tableSamples = useMemo(() => {
    if (!search) return rangeSamples
    const q = search.toLowerCase()
    return rangeSamples.filter((s) =>
      `${new Date(s.utc).toLocaleString()} ${s.cpu}% ${s.memoryMb}MB ${s.threads ?? ''}`.toLowerCase().includes(q),
    )
  }, [rangeSamples, search])

  const sortedSamples = useMemo(() => {
    return [...tableSamples].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'utc': cmp = a.timestamp - b.timestamp; break
        case 'cpu': cmp = a.cpu - b.cpu; break
        case 'memoryMb': cmp = a.memoryMb - b.memoryMb; break
        case 'threads': cmp = (a.threads ?? 0) - (b.threads ?? 0); break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [tableSamples, sortField, sortDir])

  const pagination = usePagination(sortedSamples, 25)

  const perMetricStats = useMemo(() => {
    if (rangeSamples.length === 0) return null
    const result: Record<string, ReturnType<typeof computeStats>> = {}
    for (const m of METRICS) {
      result[m.key] = computeStats(rangeSamples.map(m.extract))
    }
    return result
  }, [rangeSamples])

  function handleBrushRange(from: number, to: number) {
    setCustomFrom(from)
    setCustomTo(to)
    setTimePreset('custom')
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  if (!host && !error) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    )
  }

  if (error && !host) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-destructive" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  const h = host!
  const cpuPct = Math.round(h.cpuUsage ?? 0)
  const memPct = h.memoryTotal ? Math.round(((h.memoryUsed ?? 0) / h.memoryTotal) * 100) : 0
  const uptimeH = h.uptimeSec ? Math.round(h.uptimeSec / 3600) : 0

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Toolbar: host + live values + time range + actions */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <span className="text-xs font-semibold truncate">{h.hostname ?? '—'}</span>
          <Badge variant="muted" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
            <Clock className="h-2.5 w-2.5" />{Math.floor(uptimeH / 24)}d {uptimeH % 24}h
          </Badge>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[11px] tabular-nums">
          <LiveChip icon={<Cpu className="h-3 w-3" />} value={`${cpuPct}%`} pct={cpuPct} warn={cpuPct > 50} danger={cpuPct > 80} />
          <LiveChip icon={<MemoryStick className="h-3 w-3" />} value={formatBytes(h.memoryUsed ?? 0)} pct={memPct} warn={memPct > 60} danger={memPct > 85} />
          <span className="flex items-center gap-1 text-muted-foreground"><HardDrive className="h-3 w-3" />{h.diskFreeBytes != null ? formatBytes(h.diskFreeBytes) : '—'}</span>
          <span className="flex items-center gap-1 text-muted-foreground"><Layers className="h-3 w-3" />{h.threadCount ?? '—'}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <ResourceTimeRangeControls
            preset={timePreset}
            customFrom={customFrom}
            customTo={customTo}
            onPresetChange={(v) => setTimePreset(v as TimePreset)}
            onCustomChange={(from, to) => { setCustomFrom(from); setCustomTo(to) }}
          />
          <ExportButton data={sortedSamples} filename="resource-samples" className="h-6 text-[10px] px-2" />
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground select-none">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary h-2.5 w-2.5" />
                Live
              </label>
            </TooltipTrigger>
            <TooltipContent>Auto-refresh every 5s</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void refresh()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Chart explorer — primary diagnostic tool */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <ResourceChartExplorer
          samples={rangeSamples}
          metrics={METRICS}
          onBrushRange={handleBrushRange}
        />
      </div>

      {/* Compact stats row */}
      {perMetricStats && rangeSamples.length > 1 && (
        <div className="grid gap-1.5 sm:grid-cols-3">
          {METRICS.map((m) => {
            const s = perMetricStats[m.key]
            if (!s) return null
            const trend = s.avg > s.p95 * 0.9 ? 'up' : s.avg < (s.min + s.max) / 2 * 0.7 ? 'down' : 'stable'
            return (
              <div key={m.key} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                <div className="flex-1 min-w-0 grid grid-cols-5 gap-1 text-center">
                  <MiniStat label="Min" value={`${round1(s.min)}${m.unit}`} />
                  <MiniStat label="Avg" value={`${round1(s.avg)}${m.unit}`} accent={m.color} />
                  <MiniStat label="Max" value={`${round1(s.max)}${m.unit}`} />
                  <MiniStat label="P95" value={`${round1(s.p95)}${m.unit}`} />
                  <MiniStat label="P99" value={`${round1(s.p99)}${m.unit}`} />
                </div>
                <span className="shrink-0 text-muted-foreground/40">
                  {trend === 'up' ? <TrendingUp className="h-3 w-3 text-amber-400" />
                    : trend === 'down' ? <TrendingDown className="h-3 w-3 text-emerald-400" />
                    : <Minus className="h-3 w-3" />}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Sample log */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/30 px-3 py-1.5 bg-muted/5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Raw samples</span>
          <span className="text-[10px] text-muted-foreground/40">{tableSamples.length} in range</span>
          <div className="ml-auto">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter…" className="w-32 h-6 text-[11px]" />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_64px_80px_44px] gap-1 px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/20 bg-muted/5">
          <SortHeader label="Time" field="utc" current={sortField} dir={sortDir} onSort={toggleSort} />
          <SortHeader label="CPU" field="cpu" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
          <SortHeader label="Memory" field="memoryMb" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
          <SortHeader label="Thr" field="threads" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
        </div>

        {pagination.items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No samples in range</div>
        ) : (
          pagination.items.map((s, i) => (
            <div key={`${s.utc}-${i}`} className="grid grid-cols-[1fr_64px_80px_44px] gap-1 px-3 py-0.5 text-[11px] hover:bg-muted/5 border-b border-border/5 last:border-b-0">
              <span className="text-muted-foreground tabular-nums">{new Date(s.utc).toLocaleTimeString()}</span>
              <span className={cn('text-right tabular-nums font-medium', s.cpu > 80 ? 'text-red-400' : s.cpu > 50 ? 'text-amber-400' : '')}>{s.cpu}%</span>
              <span className="text-right tabular-nums">{s.memoryMb > 0 ? `${Math.round(s.memoryMb)} MB` : '—'}</span>
              <span className="text-right tabular-nums text-muted-foreground/50">{s.threads ?? '—'}</span>
            </div>
          ))
        )}

        <div className="border-t border-border/30 px-3 py-1">
          <PaginationBar page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
            pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
        </div>
      </div>
    </div>
  )
}

/* ── Small helpers ──────────────────────────────────────────── */

function LiveChip({ icon, value, pct, warn, danger }: {
  icon: React.ReactNode; value: string; pct?: number; warn?: boolean; danger?: boolean
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground/50">{icon}</span>
      <span className={cn('font-bold', danger ? 'text-red-400' : warn ? 'text-amber-400' : '')}>{value}</span>
      {pct != null && (
        <span className="w-6 h-0.5 rounded-full bg-muted/30 overflow-hidden inline-block align-middle">
          <span className={cn('block h-full rounded-full', danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.max(pct, 3)}%` }} />
        </span>
      )}
    </span>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[8px] text-muted-foreground/50 uppercase">{label}</p>
      <p className="text-[10px] font-bold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  )
}

function SortHeader({ label, field, current, dir, onSort, align }: {
  label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void; align?: 'right'
}) {
  return (
    <button onClick={() => onSort(field)} className={cn('flex items-center gap-0.5 hover:text-foreground', align === 'right' && 'justify-end')}>
      {label}
      {current === field ? (dir === 'desc' ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronUp className="h-2.5 w-2.5" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-15" />}
    </button>
  )
}

function round1(n: number): string { return (Math.round(n * 10) / 10).toLocaleString() }
