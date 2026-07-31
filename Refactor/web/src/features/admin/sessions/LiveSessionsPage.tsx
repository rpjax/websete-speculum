import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminJson } from '@/lib/adminFetch'
import { AdminPage, DataCard, EmptyState, HelperCallout, IdChip, MetaRow, PageHeader, SearchFilter, StatusPill } from '@/features/admin/components'

export type LiveSession = {
  sessionId: string
  profileId: string
  connectionOpen: boolean
  uptimeMs: number
  jsBridgeEnabled: boolean
}

type ListResponse = { items: LiveSession[] }

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

export function LiveSessionsPage() {
  const [items, setItems] = useState<LiveSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''

  const load = useCallback(() => {
    setError(null)
    adminJson<ListResponse>('/api/sessions')
      .then((data) => setItems(data.items))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load live sessions.'),
      )
  }, [])

  useEffect(load, [load])

  const filtered = useMemo(
    () =>
      (items ?? []).filter((item) =>
        `${item.sessionId} ${item.profileId}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  )

  return (
    <AdminPage width="overview">
      <PageHeader
        title="Sessions"
        description="Live remote browser sessions attached to this control plane."
        actions={
          <MetaRow>
            {items ? <StatusPill label={`${filtered.length} live`} tone="info" /> : null}
            <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
          </MetaRow>
        }
      />
      <SearchFilter
        value={query}
        onChange={(value) => setParams(value ? { q: value } : {})}
        placeholder="Filter sessions"
      />

      {!items && !error ? <Skeleton className="h-40 w-full rounded-lg" /> : null}

      {error ? (
        <HelperCallout tone="danger" title="Sessions unavailable">
          {error}
          <Button size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </HelperCallout>
      ) : null}

      {items && !filtered.length ? (
        <EmptyState
          title="No live sessions"
          body="This is normal when nobody is browsing. Sessions appear here while they are Live."
          tone="reassure"
        />
      ) : null}

      {filtered.length ? (
        <DataCard>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-3">Session</TableHead>
                <TableHead className="h-9 px-3">Profile</TableHead>
                <TableHead className="h-9 px-3 w-[7rem]">Connection</TableHead>
                <TableHead className="h-9 px-3 w-[6rem]">Uptime</TableHead>
                <TableHead className="h-9 w-10 px-2">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const href = `/admin/sessions/${encodeURIComponent(item.sessionId)}`
                return (
                  <TableRow key={item.sessionId} className="group">
                    <TableCell className="px-3 py-2.5">
                      <IdChip id={item.sessionId} href={href} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <IdChip id={item.profileId} href={`/admin/profiles/${encodeURIComponent(item.profileId)}`} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <StatusPill
                        label={item.connectionOpen ? 'Open' : 'Closed'}
                        tone={item.connectionOpen ? 'success' : 'neutral'}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm tabular-nums text-foreground/80">
                      {formatDuration(item.uptimeMs)}
                    </TableCell>
                    <TableCell className="w-10 px-2 py-2.5 text-right">
                      <Button
                        asChild
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground group-hover:text-foreground"
                      >
                        <Link to={href} aria-label={`Open session ${item.sessionId}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </DataCard>
      ) : null}
    </AdminPage>
  )
}
