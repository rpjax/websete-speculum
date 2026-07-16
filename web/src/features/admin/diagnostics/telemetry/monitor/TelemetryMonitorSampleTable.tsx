import { useCallback, useEffect, useMemo, useState } from 'react'
import { diagnosticsApi, type TelemetrySampleRecord } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/components/admin/ExportButton'
import { cn } from '@/lib/utils'
import {
  ArrowUpDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Table2,
} from 'lucide-react'
import { resolveWindow, type TelemetryRange } from './useTelemetryMonitorSeries'

interface Row {
  utc: string
  timestamp: number
  cpu: number | null
  memMb: number | null
  diskFreeGb: number | null
  live: number | null
  threads: number | null
  cpuPerSession: number | null
}

type SortField = 'utc' | 'cpu' | 'memMb' | 'diskFreeGb' | 'live' | 'threads' | 'cpuPerSession'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

function flatten(rec: TelemetrySampleRecord): Row {
  const p = rec.payload
  const host = p?.host ?? null
  const apiProcess = p?.apiProcess ?? null
  const motor = p?.motor ?? null
  const cpu = host?.cpuUsage != null ? Math.round(host.cpuUsage * 10) / 10 : null
  const memMb = host?.memoryUsed != null ? Math.round(host.memoryUsed / (1024 * 1024)) : null
  const diskFreeGb = host?.diskFreeBytes != null
    ? Math.round((host.diskFreeBytes / 1024 ** 3) * 10) / 10
    : null
  const live = motor?.live ?? null
  return {
    utc: rec.utc,
    timestamp: new Date(rec.utc).getTime(),
    cpu,
    memMb,
    diskFreeGb,
    live,
    threads: apiProcess?.threadCount ?? null,
    cpuPerSession: live != null && live > 0 && cpu != null
      ? Math.round((cpu / live) * 100) / 100
      : null,
  }
}

/** Server-paginated raw telemetry sample log for Monitor (independent of Analysis). */
export function TelemetryMonitorSampleTable({
  range,
  connectionId,
}: {
  range: TelemetryRange
  connectionId?: string
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIdx, setPageIdx] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('utc')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showRuntime, setShowRuntime] = useState(false)

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const { since, until } = resolveWindow(range)
        const res = await diagnosticsApi.getSampleHistory({
          since,
          until,
          connectionId,
          limit: PAGE_SIZE,
          cursor,
        })
        setRows((res.items as TelemetrySampleRecord[]).map(flatten))
        setTotal(res.total)
        setNextCursor(res.nextCursor)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load samples')
      } finally {
        setLoading(false)
      }
    },
    [range, connectionId],
  )

  useEffect(() => {
    setCursors([null])
    setPageIdx(0)
    void load(null)
  }, [load])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'utc': cmp = a.timestamp - b.timestamp; break
        case 'cpu': cmp = (a.cpu ?? -1) - (b.cpu ?? -1); break
        case 'memMb': cmp = (a.memMb ?? -1) - (b.memMb ?? -1); break
        case 'diskFreeGb': cmp = (a.diskFreeGb ?? -1) - (b.diskFreeGb ?? -1); break
        case 'live': cmp = (a.live ?? -1) - (b.live ?? -1); break
        case 'threads': cmp = (a.threads ?? -1) - (b.threads ?? -1); break
        case 'cpuPerSession': cmp = (a.cpuPerSession ?? -1) - (b.cpuPerSession ?? -1); break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [rows, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  function goNext() {
    if (!nextCursor) return
    const nextIdx = pageIdx + 1
    setCursors((c) => (nextIdx >= c.length ? [...c, nextCursor] : c))
    setPageIdx(nextIdx)
    void load(nextCursor)
  }

  function goPrev() {
    if (pageIdx === 0) return
    const prevIdx = pageIdx - 1
    setPageIdx(prevIdx)
    void load(cursors[prevIdx])
  }

  const startNum = total === 0 ? 0 : pageIdx * PAGE_SIZE + 1
  const endNum = pageIdx * PAGE_SIZE + rows.length
  const gridClass = showRuntime
    ? 'grid-cols-[1fr_72px_84px_72px_64px_52px_72px]'
    : 'grid-cols-[1fr_72px_84px_72px]'

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-3 py-1.5 bg-muted/5">
        <Table2 className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Raw samples</span>
        <span className="text-[11px] text-muted-foreground/50 tabular-nums">
          {total.toLocaleString()} in range
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={showRuntime}
            onChange={(e) => setShowRuntime(e.target.checked)}
            className="accent-primary h-2.5 w-2.5"
          />
          Show runtime columns
        </label>
        <ExportButton data={rows} filename="telemetry-samples" className="h-6 text-[11px] px-2" />
      </div>

      <div className={cn('grid gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/20 bg-muted/5', gridClass)}>
        <SortHeader label="Time" field="utc" current={sortField} dir={sortDir} onSort={toggleSort} />
        <SortHeader label="Machine CPU" field="cpu" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
        <SortHeader label="Machine mem" field="memMb" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
        <SortHeader label="Disk free" field="diskFreeGb" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
        {showRuntime && (
          <>
            <SortHeader label="Sessions" field="live" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
            <SortHeader label="API thr" field="threads" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
            <SortHeader label="CPU/sess" field="cpuPerSession" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
          </>
        )}
      </div>

      {error ? (
        <div className="py-6 text-center text-xs text-destructive">{error}</div>
      ) : loading && rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">No samples in range</div>
      ) : (
        sorted.map((s, i) => (
          <div key={`${s.utc}-${i}`} className={cn('grid gap-1 px-3 py-0.5 text-[11px] hover:bg-muted/5 border-b border-border/5 last:border-b-0', gridClass)}>
            <span className="text-muted-foreground tabular-nums">{new Date(s.utc).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={cn('text-right tabular-nums font-medium', (s.cpu ?? 0) > 80 ? 'text-red-400' : (s.cpu ?? 0) > 50 ? 'text-amber-400' : '')}>{s.cpu != null ? `${s.cpu}%` : '—'}</span>
            <span className="text-right tabular-nums">{s.memMb != null ? `${s.memMb} MB` : '—'}</span>
            <span className="text-right tabular-nums">{s.diskFreeGb != null ? `${s.diskFreeGb} GB` : '—'}</span>
            {showRuntime && (
              <>
                <span className="text-right tabular-nums text-amber-300/90">{s.live ?? '—'}</span>
                <span className="text-right tabular-nums text-muted-foreground/50">{s.threads ?? '—'}</span>
                <span className="text-right tabular-nums text-muted-foreground/70">{s.cpuPerSession != null ? `${s.cpuPerSession}%` : '—'}</span>
              </>
            )}
          </div>
        ))
      )}

      <div className="flex items-center justify-between border-t border-border/30 px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">
          {startNum.toLocaleString()}–{endNum.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" disabled={pageIdx === 0 || loading} onClick={goPrev}>
            <ChevronLeft className="h-3 w-3" /> Prev
          </Button>
          <span className="text-[11px] text-muted-foreground tabular-nums px-1">Page {pageIdx + 1}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" disabled={!nextCursor || loading} onClick={goNext}>
            Next <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function SortHeader({ label, field, current, dir, onSort, align }: {
  label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void; align?: 'right'
}) {
  return (
    <button onClick={() => onSort(field)} className={cn('flex items-center gap-0.5 hover:text-foreground', align === 'right' && 'justify-end')}>
      {label}
      {current === field
        ? (dir === 'desc' ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronUp className="h-2.5 w-2.5" />)
        : <ArrowUpDown className="h-2.5 w-2.5 opacity-15" />}
    </button>
  )
}
