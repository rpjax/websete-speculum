import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  diagnosticsApi,
  type MotorSessionDiagnosticsSnapshot,
  type DiagnosticsEventRecord,
  type BrowserProbeResponse,
} from '@/lib/diagnosticsApi'
import { api, type SessionDetail } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SearchInput } from '@/components/admin/SearchInput'
import { MultiSelectFilter } from '@/components/admin/MultiSelectFilter'
import { PaginationBar } from '@/components/admin/PaginationBar'
import { ExportButton } from '@/components/admin/ExportButton'
import { Sparkline } from '@/components/admin/Sparkline'
import { EmptyState as EmptyPlaceholder } from '@/components/admin/EmptyState'
import { PageBreadcrumbs } from '@/components/admin/PageBreadcrumbs'
import { buildBreadcrumbs } from '@/lib/routeMap'
import { usePolling } from '@/lib/hooks/usePolling'
import { usePagination } from '@/lib/hooks/usePagination'
import {
  groupEventsIntoStories,
  type CorrelationStory,
} from '@/lib/hooks/useCorrelationStories'
import {
  DOMAIN_LABELS, PROBE_OPS, PROBE_QUICK_PICKS,
  formatDuration, formatRelativeTime,
} from '@/lib/diagnosticsConstants'
import {
  describeEvent, describePhase, describeErrorCode,
  humanizeConnectionId, narrateStory,
} from '@/lib/diagnosticsDescriptions'
import { cn } from '@/lib/utils'
import {
  RefreshCw, Activity, Monitor, Globe,
  Link2, Cpu, Radio, Layers, Braces, Wifi, WifiOff,
  HelpCircle, CheckCircle2, AlertTriangle, ChevronRight,
  Copy, Check, ChevronDown, ArrowUpRight,
  GitBranch, Navigation, Unplug, Upload, Settings, CircleHelp,
  Zap, Play, Timer,
  Clock, Eye, Cookie, Database, History, HardDrive,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════
   Main page — unified session detail
   ═══════════════════════════════════════════════════════════════════ */

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [snapshot, setSnapshot] = useState<MotorSessionDiagnosticsSnapshot | null>(null)
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [persisted, setPersisted] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(true)
  const [persistedLoading, setPersistedLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const fpsHistory = useRef<number[]>([])

  const resolvedConnectionId = useRef<string | null>(null)
  const resolvedSessionId = useRef<string | null>(null)

  const isLive = snapshot != null && snapshot.sidecarConnected

  const loadAll = useCallback(async () => {
    if (!id) return

    let connId: string | null = null
    let sessId: string | null = null

    try {
      const data = await diagnosticsApi.getSession(id)
      setSnapshot(data)
      setError(null)
      fpsHistory.current = [...fpsHistory.current.slice(-29), data.fps]
      connId = data.connectionId
      sessId = data.persistedSessionId ?? null
    } catch {
      try {
        const resolved = await diagnosticsApi.resolve({ persistedSessionId: id })
        setSnapshot(resolved.snapshot)
        setError(null)
        fpsHistory.current = [...fpsHistory.current.slice(-29), resolved.snapshot.fps]
        connId = resolved.connectionId
        sessId = resolved.snapshot.persistedSessionId ?? null
      } catch {
        sessId = id
      }
    }
    setLoading(false)

    resolvedConnectionId.current = connId
    resolvedSessionId.current = sessId

    if (connId) {
      try {
        const evts = await diagnosticsApi.getSessionEvents(connId)
        setEvents(evts)
      } catch { /* events optional */ }
    }
    setEventsLoading(false)

    if (sessId) {
      try {
        const detail = await api.getSession(sessId)
        setPersisted(detail)
      } catch { /* persisted optional */ }
    }
    setPersistedLoading(false)
  }, [id])

  useEffect(() => { void loadAll() }, [loadAll])
  usePolling(loadAll, 5_000, autoRefresh && isLive)

  if (!id) return <EmptyMsg message="No session ID provided." />

  const humanLabel = snapshot
    ? humanizeConnectionId(snapshot.connectionId)
    : persisted
      ? `Session ${persisted.sessionId.slice(5, 13)}`
      : humanizeConnectionId(id)

  const breadcrumbs = buildBreadcrumbs(`/admin/sessions/${id}`, { id: humanLabel })

  if (loading) return <LoadingSkeleton />

  if (error && !snapshot && !persisted) {
    return (
      <div className="space-y-4">
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex flex-col items-center rounded-xl border border-dashed border-destructive/50 py-16 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="mt-3 text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void loadAll()}>Retry</Button>
        </div>
      </div>
    )
  }

  const hasPersistence = persisted != null
  const connId = resolvedConnectionId.current ?? id

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4">
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex items-center gap-2">
          {isLive && (
            <>
              <Link to={`/admin/diagnostics/activity?connectionId=${connId}`} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                <Activity className="h-3.5 w-3.5" /> Events
              </Link>
              <Link to={`/admin/diagnostics/investigate?connectionId=${connId}`} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                <Cpu className="h-3.5 w-3.5" /> Investigate
              </Link>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
            Auto
          </label>
          <button onClick={() => void loadAll()} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Hero + metrics strip */}
      {snapshot ? <SessionHero snapshot={snapshot} fpsHistory={fpsHistory.current} hasPersistence={hasPersistence} /> : <InactiveHero id={id} hasPersistence={hasPersistence} />}

      {/* Session state strip */}
      <SessionStateStrip snapshot={snapshot} hasPersistence={hasPersistence} />

      {/* Tabbed content */}
      <Tabs defaultValue="overview" className="space-y-0">
        <TabsList className="w-full justify-start border-b border-border bg-transparent px-0 rounded-none h-10">
          <TabsTrigger value="overview" className="gap-1.5 text-sm data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-5 h-10"><Eye className="h-4 w-4" /> Overview</TabsTrigger>
          {snapshot && (
            <TabsTrigger value="events" className="gap-1.5 text-sm data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-5 h-10">
              <Activity className="h-4 w-4" /> Events
              {events.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{events.length}</Badge>}
            </TabsTrigger>
          )}
          {isLive && (
            <TabsTrigger value="probes" className="gap-1.5 text-sm data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-5 h-10"><Cpu className="h-4 w-4" /> Probes</TabsTrigger>
          )}
          {hasPersistence && (
            <TabsTrigger value="storage" className="gap-1.5 text-sm data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-5 h-10">
              <HardDrive className="h-4 w-4" /> Storage
              {persisted && <Badge variant="secondary" className="ml-1.5 text-xs">{persisted.cookies.length + persisted.localStorage.length + persisted.idbRecords.length + persisted.history.length}</Badge>}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="pt-5 space-y-5">
          {snapshot && <OverviewTab snapshot={snapshot} events={events} connectionId={connId} persisted={persisted} />}
          {!snapshot && hasPersistence && <PersistedOverviewTab persisted={persisted!} />}
          {!snapshot && !hasPersistence && <p className="py-10 text-center text-sm text-muted-foreground">Session data unavailable.</p>}
        </TabsContent>

        {snapshot && (
          <TabsContent value="events" className="pt-5">
            <EventsTab events={events} loading={eventsLoading} connectionId={connId} />
          </TabsContent>
        )}

        {isLive && (
          <TabsContent value="probes" className="pt-5">
            <ProbeTab connectionId={connId} />
          </TabsContent>
        )}

        {hasPersistence && (
          <TabsContent value="storage" className="pt-5">
            <StorageTab persisted={persisted!} loading={persistedLoading} />
          </TabsContent>
        )}
      </Tabs>

      {/* Related links */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Related</span>
        {snapshot && <NavChip to={`/admin/diagnostics/activity?connectionId=${connId}`} label="Session events" />}
        {isLive && <NavChip to={`/admin/diagnostics/investigate?connectionId=${connId}`} label="Full investigation" />}
        <NavChip to="/admin/diagnostics/timeline" label="Global timeline" />
        <NavChip to="/admin/sessions" label="All sessions" />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Hero section
   ═══════════════════════════════════════════════════════════════════ */

function SessionHero({ snapshot, fpsHistory, hasPersistence }: { snapshot: MotorSessionDiagnosticsSnapshot; fpsHistory: number[]; hasPersistence: boolean }) {
  const isRunning = snapshot.phase === 'Running'
  const isDegraded = !snapshot.sidecarConnected || snapshot.fps < 10
  const phaseDesc = describePhase(snapshot.phase)
  let hostname = ''
  try { hostname = snapshot.currentUrl ? new URL(snapshot.currentUrl).hostname : '' } catch { hostname = snapshot.currentUrl }

  return (
    <div className={cn('rounded-xl border bg-card overflow-hidden', isDegraded ? 'border-amber-500/40' : 'border-border')}>
      <div className="flex items-center gap-4 px-6 py-4">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
          isRunning && !isDegraded ? 'bg-emerald-500/10 text-emerald-400' : isDegraded ? 'bg-amber-500/10 text-amber-400' : 'bg-muted/20 text-muted-foreground',
        )}>
          <Monitor className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{humanizeConnectionId(snapshot.connectionId)}</h2>
            <Tooltip><TooltipTrigger asChild>
              <Badge variant={isRunning ? 'success' : 'warning'} className="gap-1 text-xs"><Radio className="h-3 w-3" /> {snapshot.phase}</Badge>
            </TooltipTrigger><TooltipContent className="max-w-xs text-sm">{phaseDesc}</TooltipContent></Tooltip>
            <span className={cn('flex items-center gap-1 text-xs font-medium',
              snapshot.sidecarConnected ? 'text-emerald-400' : 'text-red-400',
            )}>
              {snapshot.sidecarConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {snapshot.sidecarConnected ? 'Connected' : 'Disconnected'}
            </span>
            {hasPersistence && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><HardDrive className="h-3 w-3" /> Persisted</span>
                </TooltipTrigger>
                <TooltipContent className="text-sm">Cookies, storage, and history are persisted for this session</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
            {hostname && <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {hostname}</span>}
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {formatRelativeTime(snapshot.lastEventUtc)}</span>
            {snapshot.startedAt && <span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> {new Date(snapshot.startedAt).toLocaleTimeString()}</span>}
          </div>
        </div>
        <div className="hidden sm:block">
          <FpsGauge fps={snapshot.fps} size={56} />
        </div>
      </div>

      <div className="grid grid-cols-4 divide-x divide-border border-t border-border bg-muted/5">
        <MetricCell label="FPS" value={String(snapshot.fps)} tone={snapshot.fps >= 25 ? 'success' : snapshot.fps >= 15 ? 'warning' : 'destructive'} spark={fpsHistory} sparkColor={snapshot.fps >= 25 ? 'text-emerald-400' : snapshot.fps >= 15 ? 'text-amber-400' : 'text-red-400'} />
        <MetricCell label="Uptime" value={formatDuration(snapshot.uptimeMs)} />
        <MetricCell label="Frames" value={snapshot.frameSequence.toLocaleString()} sub={snapshot.uptimeMs > 0 ? `${Math.round((snapshot.frameSequence / snapshot.uptimeMs) * 60_000)}/m` : undefined} />
        <MetricCell label="Queue" value={String(snapshot.inputQueueApprox)} tone={snapshot.inputQueueApprox > 5 ? 'destructive' : snapshot.inputQueueApprox > 0 ? 'warning' : 'success'} />
      </div>

      {!snapshot.sidecarConnected && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-6 py-3">
          <p className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4" /> Browser disconnected — session may be faulted.
            {snapshot.lastFault && <span className="text-red-400/70">({snapshot.lastFault})</span>}
          </p>
        </div>
      )}
    </div>
  )
}

function InactiveHero({ id, hasPersistence }: { id: string; hasPersistence: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/20 text-muted-foreground">
          {hasPersistence ? <HardDrive className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{humanizeConnectionId(id)}</h2>
          <p className="text-sm text-muted-foreground">
            {hasPersistence
              ? 'No active connection. Persisted state (cookies, storage, history) is available.'
              : 'Session is no longer active. Viewing historical data.'}
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">{hasPersistence ? 'Persisted' : 'Inactive'}</Badge>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Session state strip — shows independent state facets, not a timeline
   ═══════════════════════════════════════════════════════════════════ */

interface StateFacet {
  label: string
  value: string
  icon: typeof Radio
  tone: 'active' | 'idle' | 'off' | 'warn'
  tip: string
}

function SessionStateStrip({ snapshot, hasPersistence }: { snapshot: MotorSessionDiagnosticsSnapshot | null; hasPersistence: boolean }) {
  const facets: StateFacet[] = []

  if (snapshot) {
    facets.push({
      label: 'Phase',
      value: snapshot.phase,
      icon: Radio,
      tone: snapshot.phase === 'Running' ? 'active' : snapshot.phase === 'Starting' ? 'idle' : 'off',
      tip: describePhase(snapshot.phase),
    })
    facets.push({
      label: 'Sidecar',
      value: snapshot.sidecarConnected ? 'Linked' : 'Lost',
      icon: snapshot.sidecarConnected ? Wifi : WifiOff,
      tone: snapshot.sidecarConnected ? 'active' : 'warn',
      tip: snapshot.sidecarConnected ? 'Sidecar browser process is linked and streaming.' : 'Sidecar lost connection — session may be faulted.',
    })
    facets.push({
      label: 'Page',
      value: snapshot.currentUrl ? 'Loaded' : 'Idle',
      icon: Globe,
      tone: snapshot.currentUrl ? 'active' : 'idle',
      tip: snapshot.currentUrl || 'No page loaded yet.',
    })
    facets.push({
      label: 'Bridge',
      value: snapshot.jsBridgeEnabled ? 'On' : 'Off',
      icon: Layers,
      tone: snapshot.jsBridgeEnabled ? 'active' : 'off',
      tip: snapshot.jsBridgeEnabled ? 'JS Bridge active — scripts can communicate with the host.' : 'JS Bridge is not enabled for this session.',
    })
    if (snapshot.exportingState) {
      facets.push({
        label: 'Export',
        value: 'Active',
        icon: Upload,
        tone: 'idle',
        tip: 'Session state is being exported to persistence layer.',
      })
    }
  } else {
    facets.push({
      label: 'Phase',
      value: 'Inactive',
      icon: Monitor,
      tone: 'off',
      tip: 'No active motor connection for this session.',
    })
  }

  facets.push({
    label: 'Storage',
    value: hasPersistence ? 'Stored' : 'None',
    icon: HardDrive,
    tone: hasPersistence ? 'active' : 'off',
    tip: hasPersistence ? 'Cookies, storage, and history are persisted for restore.' : 'No persisted state — browsing starts fresh.',
  })

  const toneStyles = {
    active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
    idle: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-500' },
    off: { bg: 'bg-muted/10', text: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
    warn: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-500' },
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex divide-x divide-border">
        {facets.map((f) => {
          const s = toneStyles[f.tone]
          return (
            <Tooltip key={f.label}>
              <TooltipTrigger asChild>
                <div className="flex flex-1 items-center gap-2.5 px-4 py-3 transition-colors hover:bg-muted/5">
                  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', s.bg)}>
                    <f.icon className={cn('h-4 w-4', s.text)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{f.label}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.dot)} />
                      <span className={cn('text-sm font-medium whitespace-nowrap', s.text)}>{f.value}</span>
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm">{f.tip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Overview tab
   ═══════════════════════════════════════════════════════════════════ */

function OverviewTab({ snapshot, events, persisted }: { snapshot: MotorSessionDiagnosticsSnapshot; events: DiagnosticsEventRecord[]; connectionId: string; persisted: SessionDetail | null }) {
  const navOk = snapshot.lastNavigateResult === 'ok'

  const sections: { title: string; icon: typeof Link2; rows: KVRow[] }[] = [
    {
      title: 'Identity', icon: Link2, rows: [
        { k: 'Connection ID', v: snapshot.connectionId, copy: true, tip: 'Real-time SignalR connection.' },
        { k: 'Persisted session', v: snapshot.persistedSessionId, copy: true, tip: 'Durable session for state restore.' },
        { k: 'Sidecar session', v: snapshot.sidecarSessionId, copy: true, tip: 'Browser process ID on sidecar.' },
        { k: 'Client token', v: snapshot.clientToken, tip: 'Auth token for this client.' },
        { k: 'Correlation', v: snapshot.correlationId, copy: true, tip: 'Causal chain grouping events.' },
      ],
    },
    {
      title: 'Configuration', icon: Layers, rows: [
        { k: 'Forwarding', v: snapshot.forwardingHost || '—', tip: 'Target site URL.' },
        { k: 'JS Bridge', v: snapshot.jsBridgeEnabled ? 'Enabled' : 'Disabled', pill: true, on: snapshot.jsBridgeEnabled },
        { k: 'Scripts', v: snapshot.scriptCount },
        { k: 'Allowlist', v: snapshot.allowlistCount },
        { k: 'Profile', v: snapshot.profileDomain || '—' },
      ],
    },
    {
      title: 'Navigation', icon: Globe, rows: [
        { k: 'Current URL', v: snapshot.currentUrl || '—' },
        { k: 'Last result', v: snapshot.lastNavigateResult || '—', tone: navOk ? 'success' : snapshot.lastNavigateResult ? 'warning' : undefined },
        { k: 'Navigate at', v: snapshot.lastNavigateUtc ? formatRelativeTime(snapshot.lastNavigateUtc) : '—' },
        { k: 'Exporting', v: snapshot.exportingState ? 'Yes' : 'No', pill: true, on: snapshot.exportingState },
      ],
    },
  ]

  const sevBreakdown = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of events) m[e.severity] = (m[e.severity] ?? 0) + 1
    return m
  }, [events])

  const domainBreakdown = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of events) m[e.domain] = (m[e.domain] ?? 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [events])

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {sections.map((s) => (
          <div key={s.title} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-muted/10">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{s.title}</span>
            </div>
            <div className="divide-y divide-border/50">
              {s.rows.map((r) => <KVRowComponent key={r.k} {...r} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Persistence summary when available */}
      {persisted && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-muted/10">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Persisted state</span>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-border md:grid-cols-4">
            <div className="px-5 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{persisted.cookies.length}</p>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Cookie className="h-3 w-3" /> Cookies</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{persisted.localStorage.length}</p>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Database className="h-3 w-3" /> Local storage</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{persisted.idbRecords.length}</p>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><HardDrive className="h-3 w-3" /> IndexedDB</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{persisted.history.length}</p>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><History className="h-3 w-3" /> History</p>
            </div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard label="Total events" value={events.length} />
          <SummaryCard label="Errors" value={sevBreakdown['Error'] ?? 0} tone={sevBreakdown['Error'] ? 'destructive' : undefined} />
          <SummaryCard label="Warnings" value={sevBreakdown['Warning'] ?? 0} tone={sevBreakdown['Warning'] ? 'warning' : undefined} />
          <SummaryCard label="Domains" value={domainBreakdown.length} />
        </div>
      )}

      {domainBreakdown.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Event distribution by domain</p>
          <div className="flex h-5 w-full overflow-hidden rounded-full">
            {domainBreakdown.map(([domain, count]) => (
              <Tooltip key={domain}>
                <TooltipTrigger asChild>
                  <div className={cn('h-full transition-all', getDomainColor(domain))} style={{ width: `${(count / events.length) * 100}%` }} />
                </TooltipTrigger>
                <TooltipContent className="text-sm">{DOMAIN_LABELS[domain] ?? domain}: {count} events ({Math.round((count / events.length) * 100)}%)</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {domainBreakdown.slice(0, 6).map(([domain, count]) => (
              <span key={domain} className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className={cn('h-2.5 w-2.5 rounded-full', getDomainColor(domain))} />
                {DOMAIN_LABELS[domain] ?? domain} <span className="font-bold text-foreground">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function PersistedOverviewTab({ persisted }: { persisted: SessionDetail }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-muted/10">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Identity</span>
        </div>
        <div className="divide-y divide-border/50">
          <KVRowComponent k="Session ID" v={persisted.sessionId} copy />
          <KVRowComponent k="Client token" v={persisted.clientToken} copy tip="Auth token for this client." />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-muted/10">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Storage summary</span>
        </div>
        <div className="grid grid-cols-2 gap-0 divide-x divide-border md:grid-cols-4">
          <div className="px-5 py-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{persisted.cookies.length}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Cookie className="h-3 w-3" /> Cookies</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{persisted.localStorage.length}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Database className="h-3 w-3" /> Local storage</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{persisted.idbRecords.length}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><HardDrive className="h-3 w-3" /> IndexedDB</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{persisted.history.length}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><History className="h-3 w-3" /> History</p>
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground text-center">Switch to the <strong>Storage</strong> tab for full details on cookies, storage, and browsing history.</p>
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'destructive' | 'warning' }) {
  const color = tone === 'destructive' ? 'text-red-400' : tone === 'warning' ? 'text-amber-400' : 'text-foreground'
  const bg = tone === 'destructive' ? 'bg-red-500/5 border-red-500/20' : tone === 'warning' ? 'bg-amber-500/5 border-amber-500/20' : 'border-border'
  return (
    <div className={cn('rounded-xl border bg-card px-5 py-4', bg)}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', color)}>{value}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Events tab
   ═══════════════════════════════════════════════════════════════════ */

const DOMAIN_FILTER_OPTIONS = Object.entries(DOMAIN_LABELS)
  .filter(([k]) => k.includes('.') || ['Persistence', 'HostResources', 'BrowserQuery'].includes(k))
  .map(([value, label]) => ({ value, label }))

const SEV_FILTER_OPTIONS = [
  { value: 'Info', label: 'Info' },
  { value: 'Warning', label: 'Warning' },
  { value: 'Error', label: 'Error' },
  { value: 'Metric', label: 'Metric' },
]

const STORY_ICONS: Record<string, typeof GitBranch> = {
  'session-lifecycle': GitBranch, 'navigation': Navigation, 'probe': Cpu,
  'drain': Unplug, 'state-export': Upload, 'admin': Settings, 'unknown': CircleHelp,
}

const TIME_PRESETS = [
  { label: 'All', ms: 0 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 5 * 60_000 },
  { label: '15m', ms: 15 * 60_000 },
  { label: '30m', ms: 30 * 60_000 },
  { label: '1h', ms: 60 * 60_000 },
]

function EventsTab({ events, loading, connectionId }: { events: DiagnosticsEventRecord[]; loading: boolean; connectionId: string }) {
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string[]>([])
  const [sevFilter, setSevFilter] = useState<string[]>([])
  const [view, setView] = useState<'timeline' | 'stories'>('timeline')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [timeWindow, setTimeWindow] = useState(0)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const nowMs = useMemo(() => Date.now(), [])

  const filtered = useMemo(() => {
    let list = events.filter((e) => {
      if (domainFilter.length > 0 && !domainFilter.includes(e.domain)) return false
      if (sevFilter.length > 0 && !sevFilter.includes(e.severity)) return false
      if (timeWindow > 0 && (nowMs - new Date(e.utc).getTime()) > timeWindow) return false
      if (search) {
        const s = search.toLowerCase()
        if (!e.name.toLowerCase().includes(s) && !e.domain.toLowerCase().includes(s) && !(e.correlationId ?? '').toLowerCase().includes(s) && !JSON.stringify(e.payload ?? '').toLowerCase().includes(s)) return false
      }
      return true
    })
    if (sort === 'oldest') list = [...list].reverse()
    return list
  }, [events, domainFilter, sevFilter, search, sort, timeWindow, nowMs])

  const stories = useMemo(() => view === 'stories' ? groupEventsIntoStories(filtered) : null, [filtered, view])

  const stats = useMemo(() => {
    const sev: Record<string, number> = {}
    const dom: Record<string, number> = {}
    const names: Record<string, number> = {}
    const correlations = new Set<string>()
    for (const e of filtered) {
      sev[e.severity] = (sev[e.severity] ?? 0) + 1
      dom[e.domain] = (dom[e.domain] ?? 0) + 1
      names[e.name] = (names[e.name] ?? 0) + 1
      if (e.correlationId) correlations.add(e.correlationId)
    }
    const times = filtered.map((e) => new Date(e.utc).getTime())
    const span = times.length > 1 ? (Math.max(...times) - Math.min(...times)) : 0
    const rate = span > 0 ? Math.round((filtered.length / span) * 60_000 * 10) / 10 : 0
    const topNames = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const domEntries = Object.entries(dom).sort((a, b) => b[1] - a[1])
    return { sev, dom, domEntries, correlations: correlations.size, rate, topNames, span }
  }, [filtered])

  const pagination = usePagination(view === 'stories' ? (stories?.stories ?? []) : filtered, 25)
  const selectedEvent = selectedEventId ? filtered.find((e) => e.id === selectedEventId) ?? null : null

  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border py-16 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">No events recorded</p>
        <p className="mt-1 text-sm text-muted-foreground">Events will appear here as the session progresses through its lifecycle.</p>
      </div>
    )
  }

  const hasFilters = domainFilter.length > 0 || sevFilter.length > 0 || search || timeWindow > 0

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        <EventStatChip label="Total" value={filtered.length} total={events.length} filtered={hasFilters} />
        <EventStatChip label="Errors" value={stats.sev['Error'] ?? 0} tone="destructive" />
        <EventStatChip label="Warnings" value={stats.sev['Warning'] ?? 0} tone="warning" />
        <EventStatChip label="Rate" value={stats.rate} unit="/min" />
        <EventStatChip label="Domains" value={stats.domEntries.length} />
        <EventStatChip label="Flows" value={stats.correlations} tip="Unique correlation chains" />
      </div>

      {/* Domain + severity breakdown */}
      {stats.domEntries.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-stretch divide-x divide-border">
            {/* Domain bar */}
            <div className="flex-1 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">By domain</p>
              <div className="flex h-3 w-full overflow-hidden rounded-full">
                {stats.domEntries.map(([domain, count]) => (
                  <Tooltip key={domain}>
                    <TooltipTrigger asChild>
                      <button
                        className={cn('h-full transition-all hover:opacity-80', getDomainColor(domain))}
                        style={{ width: `${(count / filtered.length) * 100}%` }}
                        onClick={() => setDomainFilter(domainFilter.includes(domain) ? domainFilter.filter((d) => d !== domain) : [...domainFilter, domain])}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="text-sm">{DOMAIN_LABELS[domain] ?? domain}: {count} ({Math.round((count / filtered.length) * 100)}%) — click to filter</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {stats.domEntries.map(([domain, count]) => (
                  <button key={domain} onClick={() => setDomainFilter([domain])} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <div className={cn('h-2 w-2 rounded-full', getDomainColor(domain))} />
                    {DOMAIN_LABELS[domain] ?? domain} <span className="font-bold text-foreground">{count}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Severity bar */}
            <div className="w-56 shrink-0 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">By severity</p>
              <div className="space-y-1.5">
                {['Error', 'Warning', 'Info', 'Metric'].map((sev) => {
                  const count = stats.sev[sev] ?? 0
                  if (count === 0) return null
                  const pct = Math.max((count / filtered.length) * 100, 2)
                  const color = sev === 'Error' ? 'bg-red-500' : sev === 'Warning' ? 'bg-amber-500' : sev === 'Metric' ? 'bg-slate-400' : 'bg-sky-500'
                  return (
                    <button key={sev} onClick={() => setSevFilter([sev])} className="flex w-full items-center gap-2 group">
                      <span className="w-12 text-right text-xs text-muted-foreground group-hover:text-foreground">{sev}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-xs tabular-nums font-medium text-foreground">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top event names — only shown when there's meaningful frequency variance */}
      {stats.topNames.length > 0 && stats.topNames[0][1] > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Frequent</span>
          {stats.topNames.filter(([, c]) => c > 1).map(([name, count]) => (
            <button key={name} onClick={() => setSearch(search === name ? '' : name)} className={cn('flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors', search === name ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40')}>
              {name.split('.').pop()} <span className="tabular-nums font-bold">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main events card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Distribution chart */}
        <EventDistributionChart events={filtered} allEvents={events} connectionId={connectionId} />

        {/* Toolbar row 1: Search + filters */}
        <div className="border-b border-border px-4 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, domain, correlation, payload…" className="min-w-0 flex-1" />
            <MultiSelectFilter label="Domain" options={DOMAIN_FILTER_OPTIONS} selected={domainFilter} onChange={setDomainFilter} />
            <MultiSelectFilter label="Severity" options={SEV_FILTER_OPTIONS} selected={sevFilter} onChange={setSevFilter} />
            <ExportButton data={filtered} filename={`session-${connectionId.slice(0, 8)}-events`} />
          </div>

          {/* Toolbar row 2: Time window + view controls */}
          <div className="flex items-center gap-2">
            {/* Time presets */}
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-0.5">
              {TIME_PRESETS.map((tp) => (
                <button key={tp.label} onClick={() => setTimeWindow(tp.ms)} className={cn('rounded px-2 py-0.5 text-xs font-medium transition-colors', timeWindow === tp.ms ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{tp.label}</button>
              ))}
            </div>

            <div className="flex-1" />

            {/* View toggle */}
            <div className="flex rounded-md border border-border bg-muted/20 p-0.5">
              <button onClick={() => setView('timeline')} className={cn('rounded px-2.5 py-1 text-xs font-medium', view === 'timeline' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>Timeline</button>
              <button onClick={() => setView('stories')} className={cn('rounded px-2.5 py-1 text-xs font-medium', view === 'stories' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>Stories</button>
            </div>

            <button onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {sort === 'newest' ? '↓ Newest' : '↑ Oldest'}
            </button>
          </div>

          {/* Active filters indicator */}
          {hasFilters && (
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-xs text-muted-foreground">{filtered.length} of {events.length} events</span>
              {(stats.sev['Error'] ?? 0) > 0 && <Badge variant="destructive" className="text-xs">{stats.sev['Error']} errors</Badge>}
              {(stats.sev['Warning'] ?? 0) > 0 && <Badge variant="warning" className="text-xs">{stats.sev['Warning']} warnings</Badge>}
              {domainFilter.length > 0 && domainFilter.map((d) => <Badge key={d} variant="secondary" className="text-xs gap-1">{DOMAIN_LABELS[d] ?? d} <button onClick={() => setDomainFilter(domainFilter.filter((x) => x !== d))} className="ml-0.5 opacity-60 hover:opacity-100">&times;</button></Badge>)}
              <button onClick={() => { setDomainFilter([]); setSevFilter([]); setSearch(''); setTimeWindow(0) }} className="text-xs text-primary hover:underline">Clear all</button>
            </div>
          )}
        </div>

        {/* Event list / stories */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Layers className="h-6 w-6 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">No events match the current filters.</p>
          </div>
        ) : view === 'timeline' ? (
          <div className="divide-y divide-border/50">
            {(pagination.items as DiagnosticsEventRecord[]).map((evt) => (
              <EventRow key={evt.id} event={evt} isSelected={selectedEventId === evt.id} onSelect={setSelectedEventId} onFilterCorrelation={evt.correlationId ? () => setSearch(evt.correlationId!) : undefined} />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {(pagination.items as CorrelationStory[]).map((s) => <StoryRow key={s.correlationId} story={s} onSelectEvent={setSelectedEventId} />)}
            {stories && stories.uncorrelated.length > 0 && (
              <div className="px-4 py-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Standalone ({stories.uncorrelated.length})</p>
                <div className="divide-y divide-border/30">
                  {stories.uncorrelated.slice(0, 10).map((evt) => <EventRow key={evt.id} event={evt} isSelected={selectedEventId === evt.id} onSelect={setSelectedEventId} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        <div className="border-t border-border px-4 py-2">
          <PaginationBar page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
        </div>
      </div>

      {/* Event detail panel */}
      <EventDetailSheet event={selectedEvent} onClose={() => setSelectedEventId(null)} onFilterCorrelation={selectedEvent?.correlationId ? () => { setSearch(selectedEvent!.correlationId!); setSelectedEventId(null) } : undefined} />
    </div>
  )
}

function EventStatChip({ label, value, unit, total, filtered, tone, tip }: { label: string; value: number; unit?: string; total?: number; filtered?: boolean; tone?: 'destructive' | 'warning'; tip?: string }) {
  const color = tone === 'destructive' ? 'text-red-400' : tone === 'warning' ? 'text-amber-400' : 'text-foreground'
  const content = (
    <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums leading-tight', color)}>
        {value}{unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </p>
      {filtered && total !== undefined && <p className="text-xs text-muted-foreground">of {total}</p>}
    </div>
  )
  return tip ? <Tooltip><TooltipTrigger asChild>{content}</TooltipTrigger><TooltipContent className="text-sm">{tip}</TooltipContent></Tooltip> : content
}

type DistChartMode = 'severity' | 'domain' | 'cumulative'

function EventDistributionChart({ events, allEvents, connectionId }: { events: DiagnosticsEventRecord[]; allEvents: DiagnosticsEventRecord[]; connectionId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<DistChartMode>('severity')

  if (allEvents.length === 0) return null

  const bucketCount = expanded ? 60 : 50
  const chartH = expanded ? 140 : 52
  const allTimes = allEvents.map((e) => new Date(e.utc).getTime())
  const minT = Math.min(...allTimes)
  const maxT = Math.max(...allTimes)
  const range = maxT - minT || 1

  const filteredSet = new Set(events.map((e) => e.id))

  const buckets: { total: number; matched: number; errors: number; warnings: number; infos: number; metrics: number; domains: Record<string, number>; start: number; end: number }[] =
    Array.from({ length: bucketCount }, (_, i) => ({
      total: 0, matched: 0, errors: 0, warnings: 0, infos: 0, metrics: 0, domains: {},
      start: minT + (range / bucketCount) * i, end: minT + (range / bucketCount) * (i + 1),
    }))

  for (let i = 0; i < allEvents.length; i++) {
    const idx = Math.min(Math.floor(((allTimes[i] - minT) / range) * bucketCount), bucketCount - 1)
    buckets[idx].total++
    if (filteredSet.has(allEvents[i].id)) {
      buckets[idx].matched++
      if (allEvents[i].severity === 'Error') buckets[idx].errors++
      else if (allEvents[i].severity === 'Warning') buckets[idx].warnings++
      else if (allEvents[i].severity === 'Metric') buckets[idx].metrics++
      else buckets[idx].infos++
      const d = allEvents[i].domain
      buckets[idx].domains[d] = (buckets[idx].domains[d] ?? 0) + 1
    }
  }

  const maxCount = Math.max(...buckets.map((b) => b.matched), 1)
  const allDomains = [...new Set(events.map((e) => e.domain))].sort()

  let cumTotal = 0
  const cumBuckets = buckets.map((b) => { cumTotal += b.matched; return cumTotal })
  const cumMax = Math.max(cumTotal, 1)

  return (
    <div className="border-b border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event distribution</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatDuration(range)}</span>
          {expanded && (
            <div className="flex rounded-md border border-border bg-muted/20 p-0.5">
              {([['severity', 'Severity'], ['domain', 'Domain'], ['cumulative', 'Cumulative']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setMode(v)} className={cn('rounded px-2 py-0.5 text-xs font-medium transition-colors', mode === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{l}</button>
              ))}
            </div>
          )}
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="px-4 pb-1">
        {mode === 'cumulative' && expanded ? (
          /* Cumulative line chart */
          <svg width="100%" height={chartH} viewBox={`0 0 ${bucketCount * 12} ${chartH}`} preserveAspectRatio="none" className="overflow-visible">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="text-primary"
              points={cumBuckets.map((v, i) => `${i * 12 + 6},${chartH - (v / cumMax) * (chartH - 8) - 4}`).join(' ')}
            />
            <polyline
              fill="url(#cumFill)"
              stroke="none"
              points={`0,${chartH} ${cumBuckets.map((v, i) => `${i * 12 + 6},${chartH - (v / cumMax) * (chartH - 8) - 4}`).join(' ')} ${bucketCount * 12},${chartH}`}
            />
            <defs><linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.15" /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" /></linearGradient></defs>
          </svg>
        ) : mode === 'domain' && expanded ? (
          /* Stacked domain bars */
          <div className="flex items-end gap-px" style={{ height: chartH }}>
            {buckets.map((b, i) => {
              if (b.matched === 0) return <div key={i} className="flex-1" />
              const h = Math.max((b.matched / maxCount) * 100, 6)
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div className="flex-1 flex flex-col justify-end" style={{ height: '100%' }}>
                      <div className="flex flex-col rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                        {allDomains.map((dom) => {
                          const dc = b.domains[dom] ?? 0
                          if (dc === 0) return null
                          return <div key={dom} className={cn(getDomainColor(dom))} style={{ height: `${(dc / b.matched) * 100}%`, minHeight: 1 }} />
                        })}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-sm">
                    <p className="font-medium">{b.matched} events</p>
                    {Object.entries(b.domains).sort((a, b) => b[1] - a[1]).map(([d, c]) => (
                      <p key={d} className="text-muted-foreground">{DOMAIN_LABELS[d] ?? d}: {c}</p>
                    ))}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : (
          /* Default severity histogram */
          <div className="flex items-end gap-px" style={{ height: chartH }}>
            {buckets.map((b, i) => {
              if (b.matched === 0 && b.total === 0) return <div key={i} className="flex-1" />
              const h = b.total > 0 ? Math.max((b.total / maxCount) * 100, 6) : 0
              const matchPct = b.total > 0 ? b.matched / b.total : 0
              const dimmed = b.total > 0 && b.matched === 0

              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div className="flex-1 flex flex-col justify-end" style={{ height: '100%' }}>
                      {dimmed && <div className="rounded-t-sm bg-muted-foreground/10" style={{ height: `${h}%` }} />}
                      {!dimmed && b.total > 0 && (
                        expanded ? (
                          <div className="flex flex-col rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                            {b.errors > 0 && <div className="bg-red-500/70" style={{ height: `${(b.errors / b.matched) * matchPct * 100}%`, minHeight: 1 }} />}
                            {b.warnings > 0 && <div className="bg-amber-500/70" style={{ height: `${(b.warnings / b.matched) * matchPct * 100}%`, minHeight: 1 }} />}
                            {b.infos > 0 && <div className="bg-sky-500/50" style={{ height: `${(b.infos / b.matched) * matchPct * 100}%`, minHeight: 1 }} />}
                            {b.metrics > 0 && <div className="bg-slate-400/50" style={{ height: `${(b.metrics / b.matched) * matchPct * 100}%`, minHeight: 1 }} />}
                          </div>
                        ) : (
                          <div className="relative rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                            <div className="absolute inset-0 bg-muted-foreground/10" />
                            <div className={cn('absolute bottom-0 left-0 right-0 transition-all', b.errors > 0 ? 'bg-red-500' : b.warnings > 0 ? 'bg-amber-500' : 'bg-primary')} style={{ height: `${matchPct * 100}%`, opacity: 0.6 }} />
                          </div>
                        )
                      )}
                    </div>
                  </TooltipTrigger>
                  {b.total > 0 && (
                    <TooltipContent className="text-sm">
                      <p className="font-medium">{b.matched} matched / {b.total} total</p>
                      <p className="text-xs text-muted-foreground">{new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} — {new Date(b.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                      {b.errors > 0 && <p className="text-red-400">{b.errors} errors</p>}
                      {b.warnings > 0 && <p className="text-amber-400">{b.warnings} warnings</p>}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>

      {/* Time axis */}
      <div className="flex justify-between px-4 pb-2 text-xs text-muted-foreground">
        <span>{new Date(minT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {expanded && <span>{new Date(minT + range * 0.25).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        <span>{new Date((minT + maxT) / 2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {expanded && <span>{new Date(minT + range * 0.75).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        <span>{new Date(maxT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* Legend (expanded only) */}
      {expanded && (
        <div className="flex items-center gap-4 border-t border-border/50 px-4 py-2">
          {mode === 'severity' && (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="h-2 w-2 rounded-full bg-red-500" /> Error</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="h-2 w-2 rounded-full bg-amber-500" /> Warning</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="h-2 w-2 rounded-full bg-sky-500" /> Info</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="h-2 w-2 rounded-full bg-slate-400" /> Metric</span>
            </>
          )}
          {mode === 'domain' && allDomains.map((d) => (
            <span key={d} className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className={cn('h-2 w-2 rounded-full', getDomainColor(d))} /> {DOMAIN_LABELS[d] ?? d}</span>
          ))}
          {mode === 'cumulative' && <span className="text-xs text-muted-foreground">Running total of matched events over time</span>}
          <div className="flex-1" />
          <Link to={connectionId ? `/admin/diagnostics/timeline?connectionId=${encodeURIComponent(connectionId)}` : '/admin/diagnostics/timeline'} className="flex items-center gap-1 text-xs text-primary hover:underline">Full timeline <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
      )}
    </div>
  )
}

function EventRow({ event, isSelected, onSelect, onFilterCorrelation }: {
  event: DiagnosticsEventRecord; isSelected?: boolean; onSelect?: (id: string | null) => void; onFilterCorrelation?: () => void
}) {
  const [payloadOpen, setPayloadOpen] = useState(false)
  const isErr = event.severity === 'Error'
  const isWarn = event.severity === 'Warning'
  const sevIcon = isErr ? <AlertTriangle className="h-3.5 w-3.5 text-red-400" /> : isWarn ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> : event.severity === 'Metric' ? <Activity className="h-3.5 w-3.5 text-slate-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" />
  const hasPayload = event.payload && typeof event.payload === 'object' && Object.keys(event.payload as object).length > 0

  return (
    <div className={cn(isErr && 'bg-red-500/[0.03]', isSelected && 'ring-1 ring-inset ring-primary/40 bg-primary/[0.03]')}>
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors cursor-default group" onClick={() => onSelect?.(isSelected ? null : event.id)}>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(event.utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <div className="shrink-0">{sevIcon}</div>
        <div className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', isErr ? 'font-medium text-red-400' : isWarn ? 'text-amber-400' : 'text-foreground')}>{event.name}</span>
          <span className="block text-xs text-muted-foreground truncate">{describeEvent(event.name)}</span>
        </div>
        <DomainBadge domain={event.domain} showTooltip={false} />
        {event.correlationId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={(e) => { e.stopPropagation(); onFilterCorrelation?.() }} className="hidden group-hover:flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                <GitBranch className="h-3 w-3" /> Flow
              </button>
            </TooltipTrigger>
            <TooltipContent className="text-sm">Filter by correlation: {event.correlationId.slice(0, 16)}…</TooltipContent>
          </Tooltip>
        )}
        {hasPayload && (
          <button onClick={(e) => { e.stopPropagation(); setPayloadOpen(!payloadOpen) }} className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors">
            <Braces className="h-4 w-4" />
          </button>
        )}
      </div>
      {payloadOpen && event.payload && (
        <div className="px-4 pb-2"><div className="ml-20 rounded-lg border border-border bg-muted/10 p-3">
          {Object.entries(event.payload as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1 text-sm"><span className="text-muted-foreground">{k}</span><span className="truncate font-mono text-foreground">{v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>
          ))}
        </div></div>
      )}
    </div>
  )
}

function StoryRow({ story, onSelectEvent }: { story: CorrelationStory; onSelectEvent?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const hasError = story.events.some((e) => e.severity === 'Error' || e.name.includes('Failed'))
  const Icon = STORY_ICONS[story.type] ?? CircleHelp
  const typeLabel = story.type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const duration = story.events.length > 1 ? new Date(story.latestUtc).getTime() - new Date(story.events[story.events.length - 1].utc).getTime() : 0

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/10 transition-colors">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', hasError ? 'bg-red-500/15' : 'bg-sky-500/15')}>
          <Icon className={cn('h-4 w-4', hasError ? 'text-red-400' : 'text-sky-400')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{typeLabel}</span>
            {hasError && <Badge variant="destructive" className="text-xs">FAILED</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">{narrateStory(story)}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">{story.events.length} events</span>
          {duration > 0 && <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(duration)}</span>}
          <span className="text-xs tabular-nums text-muted-foreground">{formatRelativeTime(story.latestUtc)}</span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="ml-11 divide-y divide-border/50 rounded-lg border border-border overflow-hidden">
            {story.events.map((evt) => <EventRow key={evt.id} event={evt} onSelect={onSelectEvent} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function EventDetailSheet({ event, onClose, onFilterCorrelation }: { event: DiagnosticsEventRecord | null; onClose: () => void; onFilterCorrelation?: () => void }) {
  if (!event) return null

  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : null
  const isErr = event.severity === 'Error'
  const isWarn = event.severity === 'Warning'

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[460px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isErr ? <AlertTriangle className="h-5 w-5 text-red-400" /> : isWarn ? <AlertTriangle className="h-5 w-5 text-amber-400" /> : <CheckCircle2 className="h-5 w-5 text-sky-400" />}
            {event.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <p className="text-sm text-muted-foreground">{describeEvent(event.name)}</p>

          <div className="rounded-lg border border-border divide-y divide-border/50">
            <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Time</span><span className="tabular-nums">{new Date(event.utc).toLocaleString()}</span></div>
            <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Severity</span><Badge variant={isErr ? 'destructive' : isWarn ? 'warning' : 'secondary'} className="text-xs">{event.severity}</Badge></div>
            <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Domain</span><DomainBadge domain={event.domain} /></div>
            <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Redaction</span><span>{event.redaction}</span></div>
            {event.correlationId && (
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">Correlation</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs truncate max-w-[180px]">{event.correlationId}</span>
                  {onFilterCorrelation && <button onClick={onFilterCorrelation} className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"><GitBranch className="inline h-3 w-3 mr-0.5" />Filter</button>}
                </div>
              </div>
            )}
            {event.connectionId && (
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Connection</span><span className="font-mono text-xs truncate max-w-[200px]">{event.connectionId}</span></div>
            )}
            {event.persistedSessionId && (
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-muted-foreground">Session</span><span className="font-mono text-xs truncate max-w-[200px]">{event.persistedSessionId}</span></div>
            )}
          </div>

          {payload && Object.keys(payload).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Payload</p>
              <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-1">
                {Object.entries(payload).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-1 text-sm">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="truncate font-mono text-foreground text-right">{v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Raw JSON</p>
            <pre className="rounded-lg border border-border bg-muted/10 p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">{JSON.stringify(event, null, 2)}</pre>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Probes tab
   ═══════════════════════════════════════════════════════════════════ */

interface ProbeRun { ops: string[]; result: BrowserProbeResponse; time: string }

function ProbeTab({ connectionId }: { connectionId: string }) {
  const [selectedOps, setSelectedOps] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<ProbeRun[]>([])
  const [error, setError] = useState<string | null>(null)

  function toggleOp(op: string) { setSelectedOps((p) => p.includes(op) ? p.filter((o) => o !== op) : [...p, op]) }

  async function runProbe() {
    if (selectedOps.length === 0) return
    setRunning(true); setError(null)
    try {
      const result = await diagnosticsApi.runBrowserProbe(connectionId, { ops: selectedOps })
      setHistory((p) => [{ ops: [...selectedOps], result, time: new Date().toISOString() }, ...p].slice(0, 10))
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Probe failed') }
    finally { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PROBE_QUICK_PICKS.map((qp) => {
            const on = qp.ops.every((o) => selectedOps.includes(o)) && selectedOps.length === qp.ops.length
            return (
              <Tooltip key={qp.id}><TooltipTrigger asChild>
                <button onClick={() => setSelectedOps(qp.ops.slice())} className={cn('rounded-lg border px-3 py-2 text-sm font-medium transition-colors', on ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                  <Zap className="mr-1.5 inline h-3.5 w-3.5" /> {qp.label}
                </button>
              </TooltipTrigger><TooltipContent className="max-w-xs text-sm">{qp.description}<br /><span className="text-muted-foreground">Level: {qp.level}</span></TooltipContent></Tooltip>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {PROBE_OPS.map((op) => {
            const on = selectedOps.includes(op.id)
            return (
              <Tooltip key={op.id}><TooltipTrigger asChild>
                <button onClick={() => toggleOp(op.id)} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors', on ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                  <div className={cn('h-4 w-4 rounded border-2 flex items-center justify-center', on ? 'border-primary bg-primary' : 'border-muted-foreground/40')}>
                    {on && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  {op.label}
                </button>
              </TooltipTrigger><TooltipContent className="max-w-xs text-sm">{op.description}<br />Level: {op.level}</TooltipContent></Tooltip>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" disabled={running || selectedOps.length === 0} onClick={() => void runProbe()} className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : `Run (${selectedOps.length})`}
          </Button>
          {selectedOps.length > 0 && <button onClick={() => setSelectedOps([])} className="text-sm text-muted-foreground hover:text-foreground">Clear</button>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{error}
        </div>
      )}

      {history.map((run, i) => (
        <div key={i} className={cn('rounded-xl border overflow-hidden', run.result.ok ? 'border-border' : 'border-red-500/30')}>
          <div className="flex items-center gap-2.5 px-5 py-3 bg-muted/10">
            {run.result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
            <span className={cn('text-sm font-medium', run.result.ok ? 'text-emerald-400' : 'text-red-400')}>{run.result.ok ? 'Success' : 'Failed'}</span>
            <span className="text-sm text-muted-foreground">{run.ops.join(' · ')}</span>
            {run.result.errorCode && <span className="text-xs text-red-400">{describeErrorCode(run.result.errorCode).summary}</span>}
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">{new Date(run.time).toLocaleTimeString()}</span>
          </div>
          {run.result.data && (
            <div className="border-t border-border p-5">
              {typeof run.result.data === 'object' && run.result.data !== null ? (
                <div className="space-y-4">
                  {Object.entries(run.result.data as Record<string, unknown>).map(([section, data]) => (
                    <div key={section}>
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{section}</p>
                      {typeof data === 'object' && data !== null ? (
                        <div className="rounded-lg bg-muted/10 border border-border p-3">
                          {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3 py-1 text-sm">
                              <span className="text-muted-foreground">{k}</span>
                              <span className="truncate font-mono text-foreground">{v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="rounded-lg bg-muted/10 border border-border p-3 text-xs overflow-auto max-h-48">{JSON.stringify(data, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="rounded-lg bg-muted/10 border border-border p-3 text-xs overflow-auto max-h-48">{JSON.stringify(run.result.data, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Storage tab (NEW — persisted state)
   ═══════════════════════════════════════════════════════════════════ */

function StorageTab({ persisted, loading }: { persisted: SessionDetail; loading: boolean }) {
  const [peek, setPeek] = useState<{ title: string; body: string } | null>(null)
  const [activeSection, setActiveSection] = useState<'cookies' | 'ls' | 'idb' | 'history'>('cookies')
  const [search, setSearch] = useState('')

  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />

  return (
    <div className="space-y-4">
      {/* Storage sub-nav */}
      <div className="flex items-center gap-4">
        <div className="flex rounded-md border border-border bg-muted/20 p-0.5">
          {[
            { key: 'cookies' as const, label: 'Cookies', count: persisted.cookies.length, icon: Cookie },
            { key: 'ls' as const, label: 'Local storage', count: persisted.localStorage.length, icon: Database },
            { key: 'idb' as const, label: 'IndexedDB', count: persisted.idbRecords.length, icon: HardDrive },
            { key: 'history' as const, label: 'History', count: persisted.history.length, icon: History },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveSection(tab.key); setSearch('') }}
              className={cn('flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                activeSection === tab.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.icon className="h-3.5 w-3.5" /> {tab.label}
              <Badge variant="secondary" className="text-xs ml-1">{tab.count}</Badge>
            </button>
          ))}
        </div>

        <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="min-w-0 flex-1" />

        <ExportButton
          data={activeSection === 'cookies' ? persisted.cookies : activeSection === 'ls' ? persisted.localStorage : activeSection === 'idb' ? persisted.idbRecords : persisted.history}
          filename={`session-${persisted.sessionId.slice(0, 10)}-${activeSection}`}
        />
      </div>

      {/* Section content */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {activeSection === 'cookies' && <CookiesTable cookies={persisted.cookies} search={search} onPeek={setPeek} />}
        {activeSection === 'ls' && <LocalStorageTable entries={persisted.localStorage} search={search} onPeek={setPeek} />}
        {activeSection === 'idb' && <IdbTable records={persisted.idbRecords} search={search} onPeek={setPeek} />}
        {activeSection === 'history' && <HistoryTable entries={persisted.history} search={search} />}
      </div>

      {/* Peek sheet */}
      <Sheet open={!!peek} onOpenChange={(open) => !open && setPeek(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{peek?.title}</SheetTitle>
          </SheetHeader>
          <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-3 text-xs">
            {peek?.body}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function CookiesTable({ cookies, search, onPeek }: { cookies: SessionDetail['cookies']; search: string; onPeek: (p: { title: string; body: string }) => void }) {
  const filtered = useMemo(() => {
    if (!search) return cookies
    const s = search.toLowerCase()
    return cookies.filter((c) => c.name.toLowerCase().includes(s) || c.domain.toLowerCase().includes(s) || c.value.toLowerCase().includes(s))
  }, [cookies, search])

  if (filtered.length === 0) return <EmptyPlaceholder title="No cookies" description={search ? 'No cookies match your search.' : 'This session has no stored cookies.'} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead>Path</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((c, i) => (
          <TableRow key={i} className="cursor-pointer hover:bg-muted/10" onClick={() => onPeek({ title: c.name, body: c.value })}>
            <TableCell className="font-medium text-sm">{c.name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{c.domain}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{c.path}</TableCell>
            <TableCell><Eye className="h-3.5 w-3.5 text-muted-foreground" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function LocalStorageTable({ entries, search, onPeek }: { entries: SessionDetail['localStorage']; search: string; onPeek: (p: { title: string; body: string }) => void }) {
  const filtered = useMemo(() => {
    if (!search) return entries
    const s = search.toLowerCase()
    return entries.filter((l) => l.key.toLowerCase().includes(s) || l.origin.toLowerCase().includes(s) || l.value.toLowerCase().includes(s))
  }, [entries, search])

  if (filtered.length === 0) return <EmptyPlaceholder title="No local storage" description={search ? 'No entries match your search.' : 'No origin keys persisted.'} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Origin</TableHead>
          <TableHead>Key</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((l, i) => (
          <TableRow key={i} className="cursor-pointer hover:bg-muted/10" onClick={() => onPeek({ title: l.key, body: l.value })}>
            <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground">{l.origin}</TableCell>
            <TableCell className="text-sm font-medium">{l.key}</TableCell>
            <TableCell><Eye className="h-3.5 w-3.5 text-muted-foreground" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function IdbTable({ records, search, onPeek }: { records: SessionDetail['idbRecords']; search: string; onPeek: (p: { title: string; body: string }) => void }) {
  const filtered = useMemo(() => {
    if (!search) return records
    const s = search.toLowerCase()
    return records.filter((r) => r.databaseName.toLowerCase().includes(s) || r.storeName.toLowerCase().includes(s) || r.origin.toLowerCase().includes(s))
  }, [records, search])

  if (filtered.length === 0) return <EmptyPlaceholder title="No IndexedDB rows" description={search ? 'No records match your search.' : 'No IDB records for this session.'} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Origin</TableHead>
          <TableHead>Database</TableHead>
          <TableHead>Store</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((r, i) => (
          <TableRow key={i} className="cursor-pointer hover:bg-muted/10" onClick={() => onPeek({ title: `${r.databaseName}/${r.storeName}`, body: r.keyJson })}>
            <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">{r.origin}</TableCell>
            <TableCell className="text-sm font-medium">{r.databaseName}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{r.storeName}</TableCell>
            <TableCell><Eye className="h-3.5 w-3.5 text-muted-foreground" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HistoryTable({ entries, search }: { entries: SessionDetail['history']; search: string }) {
  const filtered = useMemo(() => {
    if (!search) return entries
    const s = search.toLowerCase()
    return entries.filter((h) => h.url.toLowerCase().includes(s) || h.title.toLowerCase().includes(s))
  }, [entries, search])

  if (filtered.length === 0) return <EmptyPlaceholder title="No history" description={search ? 'No history entries match your search.' : 'Navigation history is empty.'} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Title</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((h, i) => (
          <TableRow key={i}>
            <TableCell className="text-sm text-muted-foreground tabular-nums">{h.indexOrder}</TableCell>
            <TableCell className="max-w-md truncate text-sm">{h.url}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{h.title}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Shared primitives
   ═══════════════════════════════════════════════════════════════════ */


function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-4"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
    </div>
  )
}

function EmptyMsg({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground py-12 text-center">{message}</p>
}

function NavChip({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
      {label} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  )
}

function FpsGauge({ fps, size = 56 }: { fps: number; size?: number }) {
  const r = (size - 8) / 2
  const cx = size / 2
  const cy = size / 2
  const pct = Math.min(fps / 30, 1)
  const sweep = 270
  const startA = -225

  function p2xy(a: number) {
    const rad = (a * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  const s = p2xy(startA)
  const e = p2xy(startA + sweep)
  const v = p2xy(startA + sweep * pct)
  const bgD = `M ${s.x} ${s.y} A ${r} ${r} 0 1 1 ${e.x} ${e.y}`
  const vD = pct > 0 ? `M ${s.x} ${s.y} A ${r} ${r} 0 ${sweep * pct > 180 ? 1 : 0} 1 ${v.x} ${v.y}` : ''
  const color = fps >= 25 ? '#34d399' : fps >= 15 ? '#fbbf24' : '#f87171'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={bgD} fill="none" stroke="currentColor" strokeWidth={3.5} className="text-muted-foreground/20" strokeLinecap="round" />
      {vD && <path d={vD} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" />}
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fill={color} style={{ fontSize: size * 0.3, fontWeight: 700 }}>{fps}</text>
    </svg>
  )
}

function MetricCell({ label, value, tone, spark, sparkColor, sub }: {
  label: string; value: string; tone?: 'success' | 'warning' | 'destructive'; spark?: number[]; sparkColor?: string; sub?: string
}) {
  const tc = tone === 'success' ? 'text-emerald-400' : tone === 'warning' ? 'text-amber-400' : tone === 'destructive' ? 'text-red-400' : 'text-foreground'
  return (
    <div className="px-5 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-end gap-3">
        <span className={cn('text-xl font-bold tabular-nums leading-none', tc)}>{value}</span>
        {sub && <span className="text-xs text-muted-foreground mb-px">{sub}</span>}
        {spark && spark.length >= 2 && (
          <Sparkline data={spark} width={72} height={18} colorClass={sparkColor} showFill />
        )}
      </div>
    </div>
  )
}

interface KVRow {
  k: string; v: string | number | boolean | null | undefined
  copy?: boolean; tip?: string; tone?: 'success' | 'warning' | 'destructive'
  pill?: boolean; on?: boolean
}

function KVRowComponent({ k, v, copy, tip, tone, pill, on }: KVRow) {
  const [copied, setCopied] = useState(false)
  const display = v == null ? '—' : String(v)
  const tc = tone === 'success' ? 'text-emerald-400' : tone === 'warning' ? 'text-amber-400' : tone === 'destructive' ? 'text-red-400' : ''

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {k}
        {tip && <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50" /></TooltipTrigger><TooltipContent className="max-w-[240px] text-sm">{tip}</TooltipContent></Tooltip>}
      </span>
      <div className="flex items-center gap-1.5 min-w-0">
        {pill ? (
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted/30 text-muted-foreground')}>{display}</span>
        ) : (
          <span className={cn('truncate text-right font-mono text-sm', tc || 'text-foreground')}>{display}</span>
        )}
        {copy && v && (
          <button onClick={() => { void navigator.clipboard.writeText(String(v)); setCopied(true); setTimeout(() => setCopied(false), 1200) }} className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}

function getDomainColor(domain: string): string {
  if (domain.startsWith('Motor')) return 'bg-violet-500'
  if (domain.startsWith('Sidecar')) return 'bg-cyan-500'
  if (domain.startsWith('Persistence')) return 'bg-amber-500'
  if (domain.startsWith('HostResources')) return 'bg-emerald-500'
  if (domain.startsWith('BrowserQuery')) return 'bg-rose-500'
  return 'bg-slate-500'
}
