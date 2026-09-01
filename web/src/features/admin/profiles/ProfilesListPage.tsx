import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export type ProfileListItem = {
  profileId: string
  createdAt: string
  lastUsedAt: string | null
  hasLiveSession: boolean
}

type ProfileListResponse = { items: ProfileListItem[]; total: number }

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE_OPTIONS = [25, 50, 100]

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
        new Date(value),
      )
    : 'Never'

export function ProfilesListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const skip = Math.max(0, Number(params.get('skip') ?? 0))
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get('take')))
    ? Number(params.get('take'))
    : 25
  const profileIdFilter = params.get('profileId') ?? ''
  const sortBy = params.get('sortBy') === 'lastUsedAt' ? 'lastUsedAt' : 'createdAt'
  const sortDescending = params.get('sortDescending') !== 'false'

  const [profileIdDraft, setProfileIdDraft] = useState(profileIdFilter)
  const [data, setData] = useState<ProfileListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setProfileIdDraft(profileIdFilter), [profileIdFilter])

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: Math.floor(skip / pageSize), pageSize }),
    [skip, pageSize],
  )
  const sorting: SortingState = useMemo(() => [{ id: sortBy, desc: sortDescending }], [sortBy, sortDescending])

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
    query.set('sortBy', sortBy === 'lastUsedAt' ? 'LastUsedAt' : 'CreatedAt')
    query.set('sortDescending', String(sortDescending))
    if (profileIdFilter && GUID_RE.test(profileIdFilter)) query.set('profileId', profileIdFilter)

    adminJson<ProfileListResponse>(`/api/profiles?${query.toString()}`)
      .then(setData)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load profiles.'))
  }, [skip, pageSize, sortBy, sortDescending, profileIdFilter])

  useEffect(load, [load])

  const liveCount = data?.items.filter((item) => item.hasLiveSession).length ?? 0

  const columns = useMemo<ColumnDef<ProfileListItem, unknown>[]>(
    () => [
      {
        id: 'profileId',
        header: 'Profile',
        enableSorting: false,
        cell: ({ row }) => (
          <IdChip id={row.original.profileId} href={`/w7s/admin/profiles/${encodeURIComponent(row.original.profileId)}`} />
        ),
      },
      {
        id: 'liveSession',
        header: 'Live session',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.hasLiveSession ? (
            <StatusPill label="Live" tone="success" />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => <span className="text-sm tabular-nums text-foreground/80">{date(row.original.createdAt)}</span>,
      },
      {
        id: 'lastUsedAt',
        accessorKey: 'lastUsedAt',
        header: 'Last used',
        cell: ({ row }) => <span className="text-sm tabular-nums text-foreground/80">{date(row.original.lastUsedAt)}</span>,
      },
    ],
    [],
  )

  const clearFilters = () => {
    setProfileIdDraft('')
    patchParams({ profileId: null, skip: null })
  }

  return (
    <AdminPage width="overview" className="space-y-4">
      <PageHeader
        title="Profiles"
        description="Persisted browser identities and state summaries."
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
        <div className="grid gap-3 sm:grid-cols-2">
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
        {profileIdFilter ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </DataCard>

      {error ? (
        <HelperCallout tone="danger" title="Profiles unavailable">
          {error}
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </HelperCallout>
      ) : null}

      <DataTable<ProfileListItem>
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
          const first = next[0]
          patchParams({
            sortBy: first?.id === 'lastUsedAt' ? 'lastUsedAt' : null,
            sortDescending: String(first?.desc ?? true),
            skip: null,
          })
        }}
        getRowId={(row) => row.profileId}
        onRowClick={(row) => navigate(`/w7s/admin/profiles/${encodeURIComponent(row.profileId)}`)}
        emptyTitle={profileIdFilter ? 'No matching profiles' : 'No profiles yet'}
        emptyBody={
          profileIdFilter
            ? 'Try a different profile identifier.'
            : 'Profiles are created when clients ensure an identity for browsing.'
        }
      />
    </AdminPage>
  )
}
