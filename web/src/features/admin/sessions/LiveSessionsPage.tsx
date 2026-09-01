import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AdminPage,
  DataCard,
  DataTable,
  HelperCallout,
  IdChip,
  MetaRow,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'
import { adminJson } from '@/lib/adminFetch'

export type LifecycleState = 'Created' | 'Live' | 'Stopped' | 'Aborted'
export type MirrorMode = 'VideoStreaming' | 'PageProjection'

export type SessionListItem = {
  sessionId: string
  profileId: string
  state: LifecycleState
  startedAt: string
  endedAt: string | null
  endReason: string | null
  mirrorMode: MirrorMode | null
  viewportWidth: number | null
  viewportHeight: number | null
  connectionOpen: boolean | null
  uptimeMs: number | null
  jsBridgeEnabled: boolean | null
}

/** Kept for backward-compat with call sites (e.g. ProfileDetailPage) using the older live-only shape. */
export type LiveSession = SessionListItem

type SessionListResponse = { items: SessionListItem[]; total: number }

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—'

const stateTone = (state: LifecycleState) =>
  state === 'Live' ? 'success' : state === 'Aborted' ? 'danger' : state === 'Stopped' ? 'neutral' : 'info'

const mirrorLabel = (mode: MirrorMode | null) =>
  mode === 'VideoStreaming' ? 'Video streaming' : mode === 'PageProjection' ? 'DOM projection' : '—'

const PAGE_SIZE_OPTIONS = [25, 50, 100]

export function LiveSessionsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const skip = Math.max(0, Number(params.get('skip') ?? 0))
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get('take')))
    ? Number(params.get('take'))
    : 25
  const state = params.get('state') ?? ''
  const mirrorMode = params.get('mirrorMode') ?? ''
  const sessionIdFilter = params.get('sessionId') ?? ''
  const profileIdFilter = params.get('profileId') ?? ''
  const sortDescending = params.get('sortDescending') !== 'false'

  const [sessionIdDraft, setSessionIdDraft] = useState(sessionIdFilter)
  const [profileIdDraft, setProfileIdDraft] = useState(profileIdFilter)
  const [data, setData] = useState<SessionListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setSessionIdDraft(sessionIdFilter), [sessionIdFilter])
  useEffect(() => setProfileIdDraft(profileIdFilter), [profileIdFilter])

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: Math.floor(skip / pageSize), pageSize }),
    [skip, pageSize],
  )
  const sorting: SortingState = useMemo(
    () => [{ id: 'startedAt', desc: sortDescending }],
    [sortDescending],
  )

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const load = useCallback(() => {
    setError(null)
    const query = new URLSearchParams()
    query.set('skip', String(skip))
    query.set('take', String(pageSize))
    query.set('sortDescending', String(sortDescending))
    if (state) query.set('state', state)
    if (mirrorMode) query.set('mirrorMode', mirrorMode)
    if (sessionIdFilter && GUID_RE.test(sessionIdFilter)) query.set('sessionId', sessionIdFilter)
    if (profileIdFilter && GUID_RE.test(profileIdFilter)) query.set('profileId', profileIdFilter)

    adminJson<SessionListResponse>(`/api/sessions?${query.toString()}`)
      .then(setData)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load sessions.'))
  }, [skip, pageSize, state, mirrorMode, sessionIdFilter, profileIdFilter, sortDescending])

  useEffect(load, [load])

  const liveCount = data?.items.filter((item) => item.state === 'Live').length ?? 0

  const columns = useMemo<ColumnDef<SessionListItem, unknown>[]>(
    () => [
      {
        id: 'sessionId',
        header: 'Session',
        enableSorting: false,
        cell: ({ row }) => (
          <IdChip
            id={row.original.sessionId}
            href={`/w7s/admin/sessions/${encodeURIComponent(row.original.sessionId)}`}
          />
        ),
      },
      {
        id: 'profileId',
        header: 'Profile',
        enableSorting: false,
        cell: ({ row }) => (
          <IdChip
            id={row.original.profileId}
            href={`/w7s/admin/profiles/${encodeURIComponent(row.original.profileId)}`}
          />
        ),
      },
      {
        id: 'state',
        header: 'State',
        enableSorting: false,
        cell: ({ row }) => <StatusPill label={row.original.state} tone={stateTone(row.original.state)} />,
      },
      {
        id: 'mirrorMode',
        header: 'Mirror',
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm text-foreground/80">{mirrorLabel(row.original.mirrorMode)}</span>,
      },
      {
        id: 'startedAt',
        accessorKey: 'startedAt',
        header: 'Started',
        cell: ({ row }) => <span className="text-sm tabular-nums text-foreground/80">{formatDate(row.original.startedAt)}</span>,
      },
      {
        id: 'endedAt',
        header: 'Ended',
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm tabular-nums text-foreground/80">{formatDate(row.original.endedAt)}</span>,
      },
      {
        id: 'uptime',
        header: 'Uptime / connection',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original
          if (item.state !== 'Live' || item.uptimeMs == null) return <span className="text-sm text-muted-foreground">—</span>
          return (
            <MetaRow>
              <span className="text-sm tabular-nums text-foreground/80">{formatDuration(item.uptimeMs)}</span>
              <StatusPill label={item.connectionOpen ? 'Open' : 'Closed'} tone={item.connectionOpen ? 'success' : 'neutral'} />
            </MetaRow>
          )
        },
      },
    ],
    [],
  )

  const clearFilters = () => {
    setSessionIdDraft('')
    setProfileIdDraft('')
    patchParams({ state: null, mirrorMode: null, sessionId: null, profileId: null, skip: null })
  }

  const hasFilters = Boolean(state || mirrorMode || sessionIdFilter || profileIdFilter)

  return (
    <AdminPage width="overview" className="space-y-4">
      <PageHeader
        title="Sessions"
        description="Every remote browser session on this control plane — live and historical."
        actions={
          <MetaRow>
            {data ? <StatusPill label={`${liveCount} live · ${data.total} total`} tone="info" /> : null}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </MetaRow>
        }
      />

      <DataCard className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">State</Label>
            <Select
              value={state || 'any'}
              onValueChange={(value) => patchParams({ state: value === 'any' ? null : value, skip: null })}
            >
              <SelectTrigger aria-label="Filter by state"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any state</SelectItem>
                <SelectItem value="Live">Live</SelectItem>
                <SelectItem value="Created">Created</SelectItem>
                <SelectItem value="Stopped">Stopped</SelectItem>
                <SelectItem value="Aborted">Aborted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mirror mode</Label>
            <Select
              value={mirrorMode || 'any'}
              onValueChange={(value) => patchParams({ mirrorMode: value === 'any' ? null : value, skip: null })}
            >
              <SelectTrigger aria-label="Filter by mirror mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any mode</SelectItem>
                <SelectItem value="VideoStreaming">Video streaming</SelectItem>
                <SelectItem value="PageProjection">DOM projection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Session id (exact)</Label>
            <Input
              placeholder="Paste a full session id"
              value={sessionIdDraft}
              onChange={(event) => setSessionIdDraft(event.target.value)}
              onBlur={() => patchParams({ sessionId: sessionIdDraft || null, skip: null })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') patchParams({ sessionId: sessionIdDraft || null, skip: null })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Profile id (exact)</Label>
            <Input
              placeholder="Paste a full profile id"
              value={profileIdDraft}
              onChange={(event) => setProfileIdDraft(event.target.value)}
              onBlur={() => patchParams({ profileId: profileIdDraft || null, skip: null })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') patchParams({ profileId: profileIdDraft || null, skip: null })
              }}
            />
          </div>
        </div>
        {hasFilters ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </DataCard>

      {error ? (
        <HelperCallout tone="danger" title="Sessions unavailable">
          {error}
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </HelperCallout>
      ) : null}

      <DataTable<SessionListItem>
        columns={columns}
        data={data?.items ?? []}
        totalCount={data?.total ?? 0}
        isLoading={!data && !error}
        pagination={pagination}
        onPaginationChange={(updater) => {
          const next = typeof updater === 'function' ? updater(pagination) : updater
          patchParams({ skip: String(next.pageIndex * next.pageSize), take: String(next.pageSize) })
        }}
        sorting={sorting}
        onSortingChange={(updater) => {
          const next = typeof updater === 'function' ? updater(sorting) : updater
          const desc = next[0]?.desc ?? true
          patchParams({ sortDescending: String(desc), skip: null })
        }}
        getRowId={(row) => row.sessionId}
        onRowClick={(row) => navigate(`/w7s/admin/sessions/${encodeURIComponent(row.sessionId)}`)}
        emptyTitle={hasFilters ? 'No matching sessions' : 'No sessions yet'}
        emptyBody={hasFilters ? 'Try clearing a filter.' : 'Sessions appear here once a client starts browsing.'}
      />
    </AdminPage>
  )
}
