import { useCallback, useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, type SessionMeta } from '@/lib/api'
import { diagnosticsApi, type MotorSessionListItem } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchInput } from '@/components/admin/SearchInput'
import { ExportButton } from '@/components/admin/ExportButton'
import { PageHeader } from '@/components/admin/PageHeader'
import { FpsIndicator } from '@/components/admin/UptimeBar'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'
import { usePolling } from '@/lib/hooks/usePolling'
import { formatDuration } from '@/lib/diagnosticsConstants'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  RefreshCw, Activity, Monitor, Clock, Globe, Cpu,
  Radio, ChevronRight, Cookie, Database, History, Trash2, Archive,
} from 'lucide-react'

interface UnifiedRow {
  key: string
  connectionId: string | null
  sessionId: string | null
  label: string
  phase: string
  currentUrl: string
  starting: boolean
  fps: number | undefined
  uptimeMs: number | undefined
  sidecarSessionId: string | null
  cookieCount: number
  localStorageCount: number
  idbRecordCount: number
  historyCount: number
  updatedAt: string | null
  isLive: boolean
  hasPersistence: boolean
}

const SORT_OPTIONS = [
  { value: 'status', label: 'By status' },
  { value: 'uptime', label: 'By uptime' },
  { value: 'fps', label: 'By FPS' },
  { value: 'updated', label: 'Last updated' },
]

export default function SessionsPage() {
  const [liveSessions, setLiveSessions] = useState<MotorSessionListItem[]>([])
  const [persistedSessions, setPersistedSessions] = useState<SessionMeta[]>([])
  const [counts, setCounts] = useState({ active: 0, starting: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('status')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadAll = useCallback(async () => {
    try {
      const [liveRes, persistedRes] = await Promise.all([
        diagnosticsApi.listSessions().catch(() => ({ activeCount: 0, startingCount: 0, sessions: [] as MotorSessionListItem[] })),
        api.listSessions().catch(() => [] as SessionMeta[]),
      ])
      setLiveSessions(liveRes.sessions)
      setPersistedSessions(persistedRes)
      setCounts({ active: liveRes.activeCount, starting: liveRes.startingCount })
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])
  usePolling(loadAll, 10_000, autoRefresh)

  const unified = useMemo((): UnifiedRow[] => {
    const rows: UnifiedRow[] = []
    const matchedSessionIds = new Set<string>()

    for (const live of liveSessions) {
      const persisted = live.persistedSessionId
        ? persistedSessions.find((p) => p.sessionId === live.persistedSessionId)
        : undefined
      if (persisted) matchedSessionIds.add(persisted.sessionId)

      rows.push({
        key: live.connectionId,
        connectionId: live.connectionId,
        sessionId: live.persistedSessionId ?? null,
        label: humanizeConnectionId(live.connectionId),
        phase: live.phase,
        currentUrl: live.currentUrl,
        starting: live.starting,
        fps: live.fps,
        uptimeMs: live.uptimeMs,
        sidecarSessionId: live.sidecarSessionId,
        cookieCount: persisted?.cookieCount ?? 0,
        localStorageCount: persisted?.localStorageCount ?? 0,
        idbRecordCount: persisted?.idbRecordCount ?? 0,
        historyCount: persisted?.historyCount ?? 0,
        updatedAt: persisted?.updatedAt ?? null,
        isLive: true,
        hasPersistence: !!persisted,
      })
    }

    for (const p of persistedSessions) {
      if (matchedSessionIds.has(p.sessionId)) continue
      rows.push({
        key: p.sessionId,
        connectionId: null,
        sessionId: p.sessionId,
        label: `Session ${p.sessionId.slice(5, 13)}`,
        phase: 'Inactive',
        currentUrl: '',
        starting: false,
        fps: undefined,
        uptimeMs: undefined,
        sidecarSessionId: null,
        cookieCount: p.cookieCount,
        localStorageCount: p.localStorageCount,
        idbRecordCount: p.idbRecordCount,
        historyCount: p.historyCount,
        updatedAt: p.updatedAt,
        isLive: false,
        hasPersistence: true,
      })
    }

    return rows
  }, [liveSessions, persistedSessions])

  const filtered = useMemo(() => {
    let list = unified.filter((r) => {
      if (!search) return true
      const text = `${r.label} ${r.connectionId ?? ''} ${r.sessionId ?? ''} ${r.currentUrl} ${r.phase}`.toLowerCase()
      return text.includes(search.toLowerCase())
    })
    if (sort === 'fps') list = [...list].sort((a, b) => (b.fps ?? -1) - (a.fps ?? -1))
    else if (sort === 'uptime') list = [...list].sort((a, b) => (b.uptimeMs ?? -1) - (a.uptimeMs ?? -1))
    else if (sort === 'updated') list = [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    else list = [...list].sort((a, b) => (a.isLive === b.isLive ? 0 : a.isLive ? -1 : 1))
    return list
  }, [unified, search, sort])

  async function handleDelete(sessionId: string) {
    await api.deleteSession(sessionId)
    void loadAll()
  }

  const persistedOnly = persistedSessions.filter((p) => !liveSessions.some((l) => l.persistedSessionId === p.sessionId)).length

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sessions"
        description="All browser sessions — live connections and persisted state in one view."
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {counts.active > 0 && (
            <Badge variant="success" className="gap-1 text-[11px] px-2 py-0.5">
              <Radio className="h-3 w-3" /> {counts.active} live
            </Badge>
          )}
          {counts.starting > 0 && (
            <Badge variant="warning" className="gap-1 text-[11px] px-2 py-0.5">
              <Clock className="h-3 w-3" /> {counts.starting} starting
            </Badge>
          )}
          {persistedOnly > 0 && (
            <Badge variant="muted" className="gap-1 text-[11px] px-2 py-0.5">
              <Archive className="h-3 w-3" /> {persistedOnly} persisted
            </Badge>
          )}
          <span className="text-xs text-muted-foreground/60 pl-1">{unified.length} total</span>
        </div>

        <div className="ml-auto" />

        <SearchInput value={search} onChange={setSearch} placeholder="Search sessions…" className="w-44" />

        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <ExportButton data={unified} filename="sessions" />

        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground select-none">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded accent-primary h-3 w-3" />
              Auto
            </label>
          </TooltipTrigger>
          <TooltipContent>Auto-refresh every 10s</TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void loadAll()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-14 text-center">
          <Monitor className="h-7 w-7 text-muted-foreground/25" />
          <p className="mt-2.5 text-sm font-medium">{search ? 'No sessions match' : 'No sessions'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Sessions appear when users connect through Motor or persist browser state.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {filtered.map((row) => (
            <SessionRow key={row.key} row={row} onDelete={row.hasPersistence && row.sessionId ? () => void handleDelete(row.sessionId!) : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ row, onDelete }: { row: UnifiedRow; onDelete?: () => void }) {
  const isRunning = row.isLive && !row.starting
  const isStarting = row.isLive && row.starting
  const detailId = row.connectionId ?? row.sessionId ?? ''

  let hostname = ''
  if (row.currentUrl) {
    try { hostname = new URL(row.currentUrl).hostname } catch { hostname = row.currentUrl }
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/5">
      {/* Status icon */}
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        isRunning ? 'bg-emerald-500/10 text-emerald-400'
          : isStarting ? 'bg-amber-500/10 text-amber-400'
          : 'bg-muted/15 text-muted-foreground/50',
      )}>
        {isRunning ? <Monitor className="h-4 w-4" /> : isStarting ? <Clock className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </div>

      {/* Identity + metadata */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">{row.label}</span>
          <Badge
            variant={isRunning ? 'success' : isStarting ? 'warning' : 'muted'}
            className="text-[10px] px-1.5 py-0 leading-4"
          >
            {row.phase}
          </Badge>
          {row.hasPersistence && row.isLive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                  <Archive className="h-2.5 w-2.5" /> Persisted
                </span>
              </TooltipTrigger>
              <TooltipContent>Session state persisted — restored on reconnect</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          {hostname && (
            <span className="flex items-center gap-1 truncate max-w-[180px]">
              <Globe className="h-3 w-3 shrink-0 text-muted-foreground/50" /> {hostname}
            </span>
          )}
          {isStarting && !hostname && <span className="italic text-amber-400/70">Starting…</span>}
          {!row.isLive && row.updatedAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground/50" /> {new Date(row.updatedAt).toLocaleDateString()}
            </span>
          )}
          <StorageMeta row={row} />
        </div>
      </div>

      {/* Live metrics */}
      {row.isLive && row.fps !== undefined && (
        <FpsIndicator fps={row.fps} className="hidden sm:flex" />
      )}
      {row.isLive && row.uptimeMs !== undefined && (
        <span className="hidden sm:block text-[11px] tabular-nums text-muted-foreground/70 min-w-[52px] text-right">
          {formatDuration(row.uptimeMs)}
        </span>
      )}

      {/* Quick actions (live only) */}
      {row.isLive && (
        <div className="hidden sm:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`/admin/diagnostics/activity?connectionId=${row.connectionId}`}
                className="rounded p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/20"
              >
                <Activity className="h-3.5 w-3.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>View events</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`/admin/diagnostics/investigate?connectionId=${row.connectionId}`}
                className="rounded p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/20"
              >
                <Cpu className="h-3.5 w-3.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Run probe</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Delete (persisted-only, not live) */}
      {onDelete && !row.isLive && (
        <ConfirmDestructive
          title="Delete persisted session?"
          description="This removes stored cookies and site state for this identity. The next browse starts fresh."
          confirmLabel="Delete"
          onConfirm={onDelete}
          trigger={
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/40 hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          }
        />
      )}

      {/* Inspect link */}
      <Link
        to={`/admin/sessions/${encodeURIComponent(detailId)}`}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground/60 hover:text-primary transition-colors"
      >
        Inspect <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

function StorageMeta({ row }: { row: UnifiedRow }) {
  const items: { icon: typeof Cookie; count: number; label: string }[] = []
  if (row.cookieCount > 0) items.push({ icon: Cookie, count: row.cookieCount, label: 'cookies' })
  if (row.localStorageCount > 0) items.push({ icon: Database, count: row.localStorageCount, label: 'localStorage entries' })
  if (row.historyCount > 0) items.push({ icon: History, count: row.historyCount, label: 'history entries' })
  if (items.length === 0) return null

  return (
    <span className="flex items-center gap-2">
      {items.map(({ icon: Icon, count, label }) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-0.5 text-muted-foreground/50">
              <Icon className="h-3 w-3" /> <span className="tabular-nums">{count}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{count} {label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}
