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
  Radio, Shield, ChevronRight, Cookie, Database, History, Trash2,
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

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sessions"
        description="All browser sessions — live connections and persisted state in one view."
      />

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-center gap-2.5">
          {counts.active > 0 && (
            <Badge variant="success" className="gap-1.5 text-xs px-2.5 py-1">
              <Radio className="h-3 w-3" /> {counts.active} live
            </Badge>
          )}
          {counts.starting > 0 && (
            <Badge variant="warning" className="gap-1.5 text-xs px-2.5 py-1">
              <Clock className="h-3 w-3" /> {counts.starting} starting
            </Badge>
          )}
          {persistedSessions.length > 0 && (
            <Badge variant="secondary" className="gap-1.5 text-xs px-2.5 py-1">
              <Shield className="h-3 w-3" /> {persistedSessions.length} persisted
            </Badge>
          )}

          <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="min-w-0 flex-1" />

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <ExportButton data={unified} filename="sessions" />

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
            Auto
          </label>

          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => void loadAll()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border py-16 text-center">
          <Monitor className="h-8 w-8 text-muted-foreground/30" />
          <p className="mt-3 text-sm font-medium">{search ? 'No sessions match' : 'No sessions'}</p>
          <p className="mt-1 text-sm text-muted-foreground">Sessions appear when users connect through Motor or persist browser state.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
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

  const storageTotal = row.cookieCount + row.localStorageCount + row.idbRecordCount + row.historyCount

  return (
    <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/10">
      {/* Status icon */}
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
        isRunning ? 'bg-emerald-500/10 text-emerald-400'
          : isStarting ? 'bg-amber-500/10 text-amber-400'
          : 'bg-muted/20 text-muted-foreground',
      )}>
        {isRunning ? <Monitor className="h-5 w-5" /> : isStarting ? <Clock className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{row.label}</span>
          <Badge variant={isRunning ? 'success' : isStarting ? 'warning' : 'secondary'} className="text-xs">{row.phase}</Badge>
          {row.hasPersistence && row.isLive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> Persisted</span>
              </TooltipTrigger>
              <TooltipContent className="text-sm">Session state persisted — can be restored on reconnect</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
          {hostname && <span className="flex items-center gap-1.5 truncate"><Globe className="h-3.5 w-3.5 shrink-0" /> {hostname}</span>}
          {isStarting && !hostname && <span className="italic">Starting…</span>}
          {!row.isLive && row.updatedAt && (
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Updated {new Date(row.updatedAt).toLocaleDateString()}</span>
          )}
          {storageTotal > 0 && (
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              {row.cookieCount > 0 && <span className="flex items-center gap-1"><Cookie className="h-3 w-3" /> {row.cookieCount}</span>}
              {row.localStorageCount > 0 && <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {row.localStorageCount}</span>}
              {row.historyCount > 0 && <span className="flex items-center gap-1"><History className="h-3 w-3" /> {row.historyCount}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Live metrics */}
      {row.fps !== undefined && row.isLive && <FpsIndicator fps={row.fps} className="hidden sm:flex" />}
      {row.uptimeMs !== undefined && row.isLive && (
        <span className="hidden sm:block text-xs tabular-nums text-muted-foreground">{formatDuration(row.uptimeMs)}</span>
      )}

      {/* Quick actions */}
      {row.isLive && (
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to={`/admin/diagnostics/activity?connectionId=${row.connectionId}`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/20">
                <Activity className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent className="text-sm">Events</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to={`/admin/diagnostics/investigate?connectionId=${row.connectionId}`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/20">
                <Cpu className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent className="text-sm">Probe</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Delete (persisted only, not live) */}
      {onDelete && !row.isLive && (
        <ConfirmDestructive
          title="Delete persisted session?"
          description="This removes stored cookies and site state for this identity. The next browse starts fresh."
          confirmLabel="Delete"
          onConfirm={onDelete}
          trigger={
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          }
        />
      )}

      {/* Inspect */}
      <Link
        to={`/admin/sessions/${encodeURIComponent(detailId)}`}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
      >
        Inspect <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
