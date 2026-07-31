import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminJson } from '@/lib/adminFetch'
import { AdminPage, DataCard, EmptyState, HelperCallout, IdChip, MetaRow, PageHeader, SearchFilter, StatusPill } from '@/features/admin/components'

type Profile = { profileId: string; createdAt: string; lastUsedAt: string | null }
type ProfileList = { items: Profile[]; total: number }

const take = 50

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
        new Date(value),
      )
    : 'Never'

export function ProfilesListPage() {
  const [params, setParams] = useSearchParams()
  const skip = Math.max(0, Number(params.get('skip') ?? 0))
  const query = params.get('q') ?? ''
  const [data, setData] = useState<ProfileList | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    adminJson<ProfileList>(`/api/profiles?skip=${skip}&take=${take}`)
      .then(setData)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load profiles.'))
  }, [skip])

  useEffect(load, [load])
  const filtered = useMemo(
    () => (data?.items ?? []).filter((profile) => profile.profileId.toLowerCase().includes(query.toLowerCase())),
    [data, query],
  )
  const setQuery = (value: string) => setParams(value ? { q: value, ...(skip ? { skip: String(skip) } : {}) } : skip ? { skip: String(skip) } : {})

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Profiles"
        description="Persisted browser identities and state summaries."
        actions={
          <MetaRow>
            {data ? <StatusPill label={`${data.total} profile${data.total === 1 ? '' : 's'}`} tone="info" /> : null}
            <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
          </MetaRow>
        }
      />
      <SearchFilter value={query} onChange={setQuery} placeholder="Filter profiles" />

      {!data && !error ? <Skeleton className="h-40 w-full rounded-lg" /> : null}

      {error ? (
        <HelperCallout tone="danger" title="Profiles unavailable">
          {error}
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </HelperCallout>
      ) : null}

      {data && !data.items.length ? (
        <EmptyState
          title="No profiles yet"
          body="Profiles are created when clients ensure an identity for browsing."
        />
      ) : null}

      {data && data.items.length && !filtered.length ? <EmptyState title="No matching profiles" body="Try a different profile identifier." tone="reassure" /> : null}

      {data && filtered.length ? (
        <DataCard>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-3">Profile</TableHead>
                <TableHead className="h-9 px-3 w-[9.5rem]">Created</TableHead>
                <TableHead className="h-9 px-3 w-[9.5rem]">Last used</TableHead>
                <TableHead className="h-9 w-10 px-2">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((profile) => {
                const href = `/admin/profiles/${encodeURIComponent(profile.profileId)}`
                return (
                  <TableRow key={profile.profileId} className="group">
                    <TableCell className="px-3 py-2.5">
                      <IdChip id={profile.profileId} href={href} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm text-foreground/80 tabular-nums">
                      {date(profile.createdAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm text-foreground/80 tabular-nums">
                      {date(profile.lastUsedAt)}
                    </TableCell>
                    <TableCell className="w-10 px-2 py-2.5 text-right">
                      <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground group-hover:text-foreground">
                        <Link to={href} aria-label={`Open profile ${profile.profileId}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm text-muted-foreground">
            <span>
              Showing {skip + 1}–{Math.min(skip + data.items.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={skip === 0}
                onClick={() => setParams({ ...(query ? { q: query } : {}), skip: String(Math.max(0, skip - take)) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={skip + take >= data.total}
                onClick={() => setParams({ ...(query ? { q: query } : {}), skip: String(skip + take) })}
              >
                Next
              </Button>
            </div>
          </div>
        </DataCard>
      ) : null}
    </AdminPage>
  )
}
