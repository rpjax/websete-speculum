import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminApiError, adminJson } from '@/lib/adminFetch'
import {
  AdminPage,
  DataCard,
  EmptyState,
  FieldGrid,
  HelperCallout,
  IdChip,
  MetaRow,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'
import { formatDuration, type LiveSession } from './LiveSessionsPage'

export function LiveSessionDetailPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<LiveSession | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    setNotFound(false)
    adminJson<LiveSession>(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then(setSession)
      .catch((cause: unknown) => {
        if (cause instanceof AdminApiError && cause.status === 404) setNotFound(true)
        else setError(cause instanceof Error ? cause.message : 'Unable to load session.')
      })
  }, [sessionId])
  useEffect(load, [load])

  if (!session && !notFound && !error) {
    return (
      <AdminPage width="editor">
        <Skeleton className="h-64 w-full" />
      </AdminPage>
    )
  }
  if (notFound) {
    return (
      <AdminPage width="editor">
        <EmptyState
          title="This session is not live or was not found."
          body="Live sessions disappear when they end."
          cta={{ label: 'Back to sessions', href: '/admin/sessions' }}
        />
      </AdminPage>
    )
  }
  if (error) {
    return (
      <AdminPage width="editor">
        <HelperCallout tone="danger" title="Session unavailable">
          {error}
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </HelperCallout>
      </AdminPage>
    )
  }
  if (!session) return null

  return (
    <AdminPage width="editor">
      <PageHeader
        title={`Session ${session.sessionId.slice(0, 8)}`}
        description="Live remote browser session."
        actions={
          <Button asChild variant="outline">
            <Link to={`/admin/profiles/${encodeURIComponent(session.profileId)}`}>View profile</Link>
          </Button>
        }
      />
      <DataCard className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Session</p>
              <IdChip id={session.sessionId} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Profile</p>
              <IdChip id={session.profileId} href={`/admin/profiles/${encodeURIComponent(session.profileId)}`} />
            </div>
          </div>
          <div className="space-y-2 sm:text-right">
            <MetaRow className="sm:justify-end">
              <StatusPill
                label={session.connectionOpen ? 'Open' : 'Closed'}
                tone={session.connectionOpen ? 'success' : 'neutral'}
              />
              <StatusPill
                label={session.jsBridgeEnabled ? 'JsBridge on' : 'JsBridge off'}
                tone={session.jsBridgeEnabled ? 'info' : 'neutral'}
              />
            </MetaRow>
            <p className="text-2xl font-bold tabular-nums">{formatDuration(session.uptimeMs)}</p>
            <p className="text-xs text-muted-foreground">Uptime · {session.uptimeMs.toLocaleString()} ms</p>
          </div>
        </div>
      </DataCard>
      <DataCard className="p-4">
        <h2 className="font-semibold">Status</h2>
        <FieldGrid className="mt-4 text-sm">
          <div>
            <p className="text-muted-foreground">Connection</p>
            <p className="mt-1">{session.connectionOpen ? 'Open' : 'Closed'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">JavaScript bridge</p>
            <p className="mt-1">{session.jsBridgeEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
        </FieldGrid>
      </DataCard>
      <Link className="inline-block text-sm underline" to="/admin/sessions">
        Back to sessions
      </Link>
    </AdminPage>
  )
}
