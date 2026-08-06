import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminApiError, adminFetch, adminJson } from '@/lib/adminFetch'
import { useAdminToast } from '@/features/admin/shell/AdminToastContext'
import {
  AdminPage,
  ConfirmDestructive,
  DataCard,
  EmptyState,
  FieldGrid,
  HelperCallout,
  IdChip,
  MetaRow,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'
import { formatDuration, type SessionListItem } from './LiveSessionsPage'

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—'

const stateTone = (state: SessionListItem['state']) =>
  state === 'Live' ? 'success' : state === 'Aborted' ? 'danger' : state === 'Stopped' ? 'neutral' : 'info'

const mirrorLabel = (mode: SessionListItem['mirrorMode']) =>
  mode === 'VideoStreaming' ? 'Video streaming' : mode === 'DomProjection' ? 'DOM projection' : '—'

export function LiveSessionDetailPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useAdminToast()
  const [session, setSession] = useState<SessionListItem | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setNotFound(false)
    adminJson<SessionListItem>(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then(setSession)
      .catch((cause: unknown) => {
        if (cause instanceof AdminApiError && cause.status === 404) setNotFound(true)
        else setError(cause instanceof Error ? cause.message : 'Unable to load session.')
      })
  }, [sessionId])
  useEffect(load, [load])

  const exportJournal = async () => {
    setExporting(true)
    try {
      const res = await adminFetch(`/api/sessions/${encodeURIComponent(sessionId)}/journal-export`)
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const payload = await res.json()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `session-${sessionId}-journal.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${payload.factCount ?? 0} journal fact(s)`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Journal export failed.')
    } finally {
      setExporting(false)
    }
  }

  const deleteSession = async () => {
    setDeleting(true)
    try {
      await adminJson(`/api/admin/maintenance/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      toast.success('Session deleted')
      navigate('/w7s/admin/sessions', { replace: true })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to delete session.')
      setConfirmingDelete(false)
    } finally {
      setDeleting(false)
    }
  }

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
          title="Session not found"
          body="This session id does not exist in the durable session store."
          cta={{ label: 'Back to sessions', href: '/w7s/admin/sessions' }}
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

  const isLive = session.state === 'Live'

  return (
    <AdminPage width="editor" className="space-y-6">
      <PageHeader
        title={`Session ${session.sessionId.slice(0, 8)}`}
        description="Full record of this remote browser session."
        actions={
          <MetaRow>
            <Button variant="outline" onClick={() => void exportJournal()} disabled={exporting}>
              <Download className="mr-1.5 h-4 w-4" />
              {exporting ? 'Exporting…' : 'Export journal JSON'}
            </Button>
            <Button
              variant="destructive"
              disabled={isLive}
              onClick={() => setConfirmingDelete(true)}
              title={isLive ? 'Stop the session before deleting it' : undefined}
            >
              Delete session
            </Button>
          </MetaRow>
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
              <IdChip id={session.profileId} href={`/w7s/admin/profiles/${encodeURIComponent(session.profileId)}`} />
            </div>
          </div>
          <div className="space-y-2 sm:text-right">
            <MetaRow className="sm:justify-end">
              <StatusPill label={session.state} tone={stateTone(session.state)} />
              {isLive ? (
                <StatusPill
                  label={session.connectionOpen ? 'Connection open' : 'Connection closed'}
                  tone={session.connectionOpen ? 'success' : 'neutral'}
                />
              ) : null}
              {isLive ? (
                <StatusPill
                  label={session.jsBridgeEnabled ? 'JsBridge on' : 'JsBridge off'}
                  tone={session.jsBridgeEnabled ? 'info' : 'neutral'}
                />
              ) : null}
            </MetaRow>
            {isLive && session.uptimeMs != null ? (
              <>
                <p className="text-2xl font-bold tabular-nums">{formatDuration(session.uptimeMs)}</p>
                <p className="text-xs text-muted-foreground">Uptime · {session.uptimeMs.toLocaleString()} ms</p>
              </>
            ) : null}
          </div>
        </div>
      </DataCard>

      <DataCard className="p-4">
        <h2 className="font-semibold">Lifecycle</h2>
        <FieldGrid className="mt-4 text-sm">
          <div>
            <p className="text-muted-foreground">Started</p>
            <p className="mt-1">{formatDate(session.startedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Ended</p>
            <p className="mt-1">{formatDate(session.endedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">End reason</p>
            <p className="mt-1">{session.endReason ?? '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Mirror mode</p>
            <p className="mt-1">{mirrorLabel(session.mirrorMode)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Viewport</p>
            <p className="mt-1">
              {session.viewportWidth && session.viewportHeight
                ? `${session.viewportWidth} × ${session.viewportHeight}`
                : '—'}
            </p>
          </div>
        </FieldGrid>
      </DataCard>

      <Link className="inline-block text-sm underline" to="/w7s/admin/sessions">
        Back to sessions
      </Link>

      <ConfirmDestructive
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this session?"
        body="This permanently deletes the session record and cascades to delete every journal fact associated with it. This cannot be undone."
        confirmLabel="Delete permanently"
        submitting={deleting}
        onConfirm={() => void deleteSession()}
      />
    </AdminPage>
  )
}
