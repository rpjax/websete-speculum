import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DomainBadge } from '@/components/admin/DomainBadge'
import { SeverityBadge } from '@/components/admin/SeverityBadge'
import { SearchInput } from '@/components/admin/SearchInput'
import { MultiSelectFilter } from '@/components/admin/MultiSelectFilter'
import { PaginationBar } from '@/components/admin/PaginationBar'
import { ExportButton } from '@/components/admin/ExportButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useActivityData, DEFAULT_FILTERS, type ActivityFilters } from '@/lib/hooks/useActivityData'
import { usePagination } from '@/lib/hooks/usePagination'
import { useEventStats } from '@/lib/hooks/useEventStats'
import {
  useCorrelationStories,
  useSessionGroups,
  extractStorySummary,
  type CorrelationStory,
  type SessionGroup,
} from '@/lib/hooks/useCorrelationStories'
import {
  DOMAIN_LABELS, STORY_TYPES, formatRelativeTime,
} from '@/lib/diagnosticsConstants'
import {
  narrateStory, describeEvent, describeErrorCode,
  humanizeConnectionId,
} from '@/lib/diagnosticsDescriptions'
import {
  ChevronDown, RefreshCw, Search,
  Monitor, Braces,
  GitBranch, Navigation, Cpu, Unplug, Upload, Settings, CircleHelp,
  AlertTriangle, CheckCircle2, XCircle,
  HelpCircle, Bookmark, BookmarkCheck,
  Users, X,
  Activity, ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { useBookmarks } from '@/lib/hooks/useBookmarks'

type ViewMode = 'sessions' | 'stories' | 'feed'

const DOMAIN_OPTIONS = Object.entries(DOMAIN_LABELS)
  .filter(([k]) => k.includes('.') || k === 'Persistence' || k === 'HostResources' || k === 'BrowserQuery')
  .map(([value, label]) => ({ value, label }))

const SEVERITY_OPTIONS = [
  { value: 'Info', label: 'Info' },
  { value: 'Warning', label: 'Warning' },
  { value: 'Error', label: 'Error' },
  { value: 'Metric', label: 'Metric' },
]

const TIME_OPTIONS = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: 'all', label: 'All' },
]

const STORY_ICONS: Record<string, typeof GitBranch> = {
  'session-lifecycle': GitBranch,
  'navigation': Navigation,
  'probe': Cpu,
  'drain': Unplug,
  'state-export': Upload,
  'admin': Settings,
  'unknown': CircleHelp,
}

export default function DiagnosticsActivityPage() {
  const [view, setView] = useState<ViewMode>('sessions')
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS)
  const { events, loading, error, refresh } = useActivityData(filters)
  const stats = useEventStats(events)
  const { bookmarks, addBookmark, removeBookmark, isBookmarked } = useBookmarks()

  const updateFilter = useCallback(<K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
  }, [])

  const hasActiveFilters = filters.domains.length > 0 || filters.severities.length > 0 || !!filters.search || !!filters.connectionId

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        {/* Row 1: view + search + actions */}
        <div className="flex items-center gap-2.5">
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            {([
              { value: 'sessions' as const, icon: Users, label: 'Sessions' },
              { value: 'stories' as const, icon: GitBranch, label: 'Stories' },
              { value: 'feed' as const, icon: Activity, label: 'Feed' },
            ]).map((opt) => (
              <Tooltip key={opt.value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setView(opt.value)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                      view === opt.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <opt.icon className="h-4 w-4" /> {opt.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="text-sm">
                  {opt.value === 'sessions' ? 'Group events by browser session' :
                    opt.value === 'stories' ? 'Group events by correlated flow' :
                    'Flat chronological event list'}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          <SearchInput value={filters.search} onChange={(v) => updateFilter('search', v)} placeholder="Search events…" className="min-w-0 flex-1" />

          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Row 2: filters + time + sort + export */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Select value={filters.timeWindow} onValueChange={(v) => updateFilter('timeWindow', v)}>
            <SelectTrigger className="h-9 w-[110px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <MultiSelectFilter label="Domain" options={DOMAIN_OPTIONS} selected={filters.domains} onChange={(v) => updateFilter('domains', v)} />
          <MultiSelectFilter label="Severity" options={SEVERITY_OPTIONS} selected={filters.severities} onChange={(v) => updateFilter('severities', v)} />

          <Select value={filters.sort} onValueChange={(v) => updateFilter('sort', v as ActivityFilters['sort'])}>
            <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="severity">By severity</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear
            </button>
          )}

          <div className="flex-1" />
          <ExportButton data={events} filename="activity-events" />
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filters.domains.map((d) => (
              <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {DOMAIN_LABELS[d] ?? d}
                <button onClick={() => updateFilter('domains', filters.domains.filter((x) => x !== d))} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {filters.severities.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {s}
                <button onClick={() => updateFilter('severities', filters.severities.filter((x) => x !== s))} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {filters.search && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                &quot;{filters.search}&quot;
                <button onClick={() => updateFilter('search', '')} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
              </span>
            )}
          </div>
        )}

        {/* Stats strip */}
        {!loading && events.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{events.length}</strong> events</span>
            <span>{stats.uniqueConnections} sessions</span>
            <span>{stats.uniqueCorrelations} stories</span>
            <span>{stats.eventRate}/min</span>
            {stats.errorCount > 0 && (
              <span className="text-red-400 font-medium">{stats.errorCount} error{stats.errorCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : events.length === 0 ? (
        <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />
      ) : view === 'sessions' ? (
        <SessionView events={events} bookmarks={{ isBookmarked, addBookmark, removeBookmark }} />
      ) : view === 'stories' ? (
        <StoryView events={events} bookmarks={{ isBookmarked, addBookmark, removeBookmark }} />
      ) : (
        <FeedView events={events} />
      )}

      {/* Bookmarks */}
      {bookmarks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <BookmarkCheck className="h-3.5 w-3.5 text-primary" /> Saved
          </span>
          {bookmarks.map((bm) => (
            <span key={bm.id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-primary">
              {bm.label}
              <button onClick={() => removeBookmark(bm.targetId, bm.type)} className="opacity-50 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Empty state ──────────────────────────────────────────────────── */

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
        <Search className="h-5 w-5 text-muted-foreground/40" />
      </div>
      <p className="mt-4 text-sm font-medium">No events found</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">Try expanding the time window or removing filters.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>Reset filters</Button>
    </div>
  )
}

/* ── Bookmark helpers ─────────────────────────────────────────────── */

interface BookmarkActions {
  isBookmarked: (id: string, type: 'story' | 'event' | 'session') => boolean
  addBookmark: (type: 'story' | 'event' | 'session', id: string, label: string) => void
  removeBookmark: (id: string, type: 'story' | 'event' | 'session') => void
}

/* ── Session view ─────────────────────────────────────────────────── */

function SessionView({ events, bookmarks }: { events: DiagnosticsEventRecord[]; bookmarks: BookmarkActions }) {
  const groups = useSessionGroups(events)
  const pagination = usePagination(groups, 25)

  return (
    <div className="space-y-3">
      {pagination.items.map((group) => (
        <SessionGroupCard key={group.connectionId ?? '_system'} group={group} bookmarks={bookmarks} />
      ))}
      <PaginationBar
        page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
        pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}
      />
    </div>
  )
}

function SessionGroupCard({ group }: { group: SessionGroup; bookmarks: BookmarkActions }) {
  const [expanded, setExpanded] = useState(false)
  const isSystem = !group.connectionId
  const hasErrors = group.events.some((e) => e.severity === 'Error')

  const humanLabel = humanizeConnectionId(group.connectionId)
  const errorCount = group.events.filter((e) => e.severity === 'Error').length
  const warnCount = group.events.filter((e) => e.severity === 'Warning').length

  const latestTime = group.events.length > 0
    ? formatRelativeTime(group.events.reduce((a, b) => a.utc > b.utc ? a : b).utc)
    : ''

  const recentEvents = [...group.events].sort((a, b) => b.utc.localeCompare(a.utc)).slice(0, 6)

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-colors',
      expanded ? 'border-primary/20' : hasErrors ? 'border-red-500/20' : 'border-border',
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/10"
      >
        <div className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          isSystem ? 'bg-amber-500/15 text-amber-400'
            : hasErrors ? 'bg-red-500/15 text-red-400'
            : 'bg-sky-500/10 text-sky-400',
        )}>
          {isSystem ? <Settings className="h-4 w-4" /> : hasErrors ? <XCircle className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <span className="text-base font-semibold">{humanLabel}</span>
          <span className="ml-2.5 text-sm text-muted-foreground">
            {group.events.length} events · {group.stories.length} stor{group.stories.length !== 1 ? 'ies' : 'y'}
          </span>
        </div>

        {errorCount > 0 && (
          <Badge variant="destructive" className="text-xs">
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </Badge>
        )}
        {errorCount === 0 && warnCount > 0 && (
          <Badge variant="warning" className="text-xs">
            {warnCount} warn
          </Badge>
        )}

        <span className="text-xs tabular-nums text-muted-foreground">{latestTime}</span>

        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Expanded: compact summary preview */}
      {expanded && (
        <div className="border-t border-border">
          {/* Stories summary */}
          {group.stories.length > 0 && (
            <div className="px-5 py-3 space-y-1">
              {group.stories.map((story) => {
                const stConfig = STORY_TYPES[story.type] ?? STORY_TYPES.unknown
                const SIcon = STORY_ICONS[story.type] ?? CircleHelp
                const sErr = story.events.some((e) => e.severity === 'Error' || e.name.includes('Rejected') || e.name.includes('Failed'))
                return (
                  <div key={story.correlationId} className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-muted/10">
                    <SIcon className={cn('h-4 w-4 shrink-0', sErr ? 'text-red-400' : 'text-muted-foreground')} />
                    <span className="text-sm font-medium">{stConfig.label}</span>
                    {sErr && <Badge variant="destructive" className="text-xs">FAILED</Badge>}
                    <span className="text-xs text-muted-foreground">{story.events.length} events</span>
                    <div className="flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground">{formatRelativeTime(story.latestUtc)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recent events preview */}
          <div className="border-t border-border px-5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</span>
              {group.events.length > 6 && (
                <span className="text-xs text-muted-foreground">showing 6 of {group.events.length}</span>
              )}
            </div>
            {recentEvents.map((evt) => <CompactEventRow key={evt.id} event={evt} />)}
          </div>

          {/* Open full details */}
          {group.connectionId && (
            <div className="border-t border-border px-5 py-3">
              <Link
                to={`/admin/sessions/${encodeURIComponent(group.connectionId)}`}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                Open full session details <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Story view ───────────────────────────────────────────────────── */

function StoryView({ events, bookmarks }: { events: DiagnosticsEventRecord[]; bookmarks: BookmarkActions }) {
  const { stories, uncorrelated } = useCorrelationStories(events)
  const pagination = usePagination(stories, 25)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        {pagination.items.map((story) => (
          <StoryRow key={story.correlationId} story={story} showConnection bookmarks={bookmarks} />
        ))}
      </div>

      {uncorrelated.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/10">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Standalone events ({uncorrelated.length})
            </span>
          </div>
          <div className="divide-y divide-border/50">
            {uncorrelated.map((evt) => <CompactEventRow key={evt.id} event={evt} />)}
          </div>
        </div>
      )}

      <PaginationBar
        page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
        pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}
      />
    </div>
  )
}

/* ── StoryRow (shared between session & story views) ──────────────── */

function StoryRow({ story, showConnection, bookmarks }: { story: CorrelationStory; showConnection?: boolean; bookmarks: BookmarkActions }) {
  const [expanded, setExpanded] = useState(false)
  const summary = extractStorySummary(story)
  const typeConfig = STORY_TYPES[story.type] ?? STORY_TYPES.unknown
  const Icon = STORY_ICONS[story.type] ?? CircleHelp
  const hasError = story.events.some((e) => e.severity === 'Error' || e.name.includes('Rejected') || e.name.includes('Failed') || e.name.includes('TimedOut'))
  const hasWarning = story.events.some((e) => e.severity === 'Warning')
  const narrative = narrateStory(story)
  const isMarked = bookmarks.isBookmarked(story.correlationId, 'story')

  return (
    <div className={cn('transition-colors', expanded && 'bg-muted/5')}>
      <div className="flex items-center gap-3 px-5 py-3">
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          hasError ? 'bg-red-500/15 text-red-400' : hasWarning ? 'bg-amber-500/15 text-amber-400' : 'bg-sky-500/10 text-sky-400',
        )}>
          <Icon className="h-4 w-4" />
        </div>

        <span className="text-sm font-semibold">{typeConfig.label}</span>
        {hasError && <Badge variant="destructive" className="text-xs">FAILED</Badge>}
        {!hasError && hasWarning && <Badge variant="warning" className="text-xs">WARN</Badge>}

        {Object.entries(summary).slice(0, 3).map(([k, v]) => (
          <span key={k} className="hidden sm:inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 text-xs">
            <span className="text-muted-foreground">{k}:</span>
            <span className="font-medium truncate max-w-[100px]">{v}</span>
          </span>
        ))}

        <div className="hidden md:flex items-center gap-0.5 ml-1">
          {story.events.slice(0, 8).map((evt) => {
            const isErr = evt.severity === 'Error' || evt.name.includes('Rejected') || evt.name.includes('Failed')
            const isWarn = evt.severity === 'Warning'
            const dot = isErr ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-sky-500'
            return (
              <Tooltip key={evt.id}>
                <TooltipTrigger asChild>
                  <div className={cn('h-2 w-2 rounded-full', dot)} />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-sm">
                  {evt.name.split('.').pop()}
                </TooltipContent>
              </Tooltip>
            )
          })}
          {story.events.length > 8 && <span className="text-xs text-muted-foreground ml-1">+{story.events.length - 8}</span>}
          <div className="ml-1">
            {hasError ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          </div>
        </div>

        <div className="flex-1" />

        {showConnection && story.connectionId && (
          <Link
            to={`/admin/sessions/${encodeURIComponent(story.connectionId)}`}
            className="text-xs text-muted-foreground hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            {humanizeConnectionId(story.connectionId)}
          </Link>
        )}

        <button
          onClick={() => isMarked
            ? bookmarks.removeBookmark(story.correlationId, 'story')
            : bookmarks.addBookmark('story', story.correlationId, `${typeConfig.label} ${story.correlationId.slice(0, 8)}`)}
          className={cn('text-muted-foreground/40 hover:text-primary', isMarked && '!text-primary')}
        >
          {isMarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </button>

        <span className="text-xs tabular-nums text-muted-foreground">{formatRelativeTime(story.latestUtc)}</span>

        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-4">
          <p className="mb-3 ml-11 text-sm leading-relaxed text-muted-foreground">{narrative}</p>
          <div className="relative ml-10 border-l-2 border-border pl-5">
            {story.events.map((evt) => <TimelineEventRow key={evt.id} event={evt} />)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Feed view (flat chronological) ──────────────────────────────── */

function FeedView({ events }: { events: DiagnosticsEventRecord[] }) {
  const pagination = usePagination(events, 50)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50">
        {pagination.items.map((evt) => <FeedRow key={evt.id} event={evt} />)}
      </div>
      <PaginationBar
        page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
        pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}
      />
    </div>
  )
}

function FeedRow({ event }: { event: DiagnosticsEventRecord }) {
  const [showPayload, setShowPayload] = useState(false)
  const isErr = event.severity === 'Error'
  const isWarn = event.severity === 'Warning'
  const dot = isErr ? 'bg-red-500' : isWarn ? 'bg-amber-500' : event.severity === 'Metric' ? 'bg-slate-400' : 'bg-sky-500'
  const hasPayload = !!(event.payload && typeof event.payload === 'object' && Object.keys(event.payload as object).length > 0)
  const shortName = event.name.split('.').pop() ?? event.name
  const domainShort = DOMAIN_LABELS[event.domain] ?? event.domain

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          'flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/10 cursor-default',
          isErr && 'bg-red-500/[0.04]',
        )}>
          <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
            {new Date(event.utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <div className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
          <span className={cn('min-w-0 flex-1 truncate text-sm', isErr ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-foreground')}>
            {shortName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{domainShort}</span>
          {hasPayload && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowPayload(!showPayload) }}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground"
            >
              <Braces className="h-4 w-4" />
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-sm text-sm">
        <p className="font-medium">{event.name}</p>
        <p className="mt-0.5 text-muted-foreground">{describeEvent(event.name)}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{domainShort}</span> · <span>{event.severity}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/* ── Shared event rows ────────────────────────────────────────────── */

function TimelineEventRow({ event }: { event: DiagnosticsEventRecord }) {
  const [showPayload, setShowPayload] = useState(false)
  const isErr = event.severity === 'Error' || event.name.includes('Rejected') || event.name.includes('Failed')
  const isWarn = event.severity === 'Warning'
  const dot = isErr ? 'bg-red-500' : isWarn ? 'bg-amber-500' : event.severity === 'Metric' ? 'bg-slate-400' : 'bg-sky-500'
  const hasPayload = !!(event.payload && typeof event.payload === 'object' && Object.keys(event.payload as object).length > 0)
  const errorCode = hasPayload ? (event.payload as Record<string, unknown>).errorCode as string | undefined : undefined

  return (
    <div className="relative py-2.5">
      <div className={cn('absolute -left-[calc(1.25rem+4px)] top-[16px] h-2.5 w-2.5 rounded-full ring-2 ring-card', dot)} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{event.name}</span>
            <DomainBadge domain={event.domain} showTooltip={false} />
            <SeverityBadge severity={event.severity} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{describeEvent(event.name)}</p>
          {errorCode && <ErrorExplanation code={errorCode} />}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <span className="text-xs tabular-nums text-muted-foreground">{new Date(event.utc).toLocaleTimeString()}</span>
          {hasPayload && (
            <button onClick={() => setShowPayload(!showPayload)} className="text-muted-foreground/50 hover:text-foreground">
              <Braces className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {showPayload && event.payload != null && (
        <div className="mt-2 rounded-lg border border-border bg-muted/10 p-3">
          {Object.entries(event.payload as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="truncate text-right font-mono text-foreground">{formatPayloadValue(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CompactEventRow({ event }: { event: DiagnosticsEventRecord }) {
  const isErr = event.severity === 'Error'
  const dot = isErr ? 'bg-red-500' : event.severity === 'Warning' ? 'bg-amber-500' : event.severity === 'Metric' ? 'bg-slate-400' : 'bg-sky-500'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/20">
          <div className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
          <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{formatRelativeTime(event.utc)}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{event.name.split('.').pop()}</span>
          <DomainBadge domain={event.domain} showTooltip={false} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-sm">
        <p className="font-medium">{event.name}</p>
        <p className="mt-1 text-muted-foreground">{describeEvent(event.name)}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function ErrorExplanation({ code }: { code: string }) {
  const info = describeErrorCode(code)
  return (
    <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-bold text-red-400">
        <AlertTriangle className="h-4 w-4" /> {info.summary}
      </div>
      <p className="mt-1 text-sm text-red-400/70 leading-relaxed">{info.detail}</p>
      {info.action && (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-primary">
          <HelpCircle className="h-3.5 w-3.5" /> {info.action}
        </p>
      )}
    </div>
  )
}

function formatPayloadValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
