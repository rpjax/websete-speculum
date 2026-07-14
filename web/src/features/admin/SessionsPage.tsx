import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SessionMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { EmptyState } from '@/components/admin/EmptyState'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setError(null)
    setLoading(true)
    try {
      setSessions(await api.listSessions())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function remove(id: string) {
    await api.deleteSession(id)
    await load()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Browser sessions"
        description="Persisted Chrome state restored across Motor reconnects. Open a row for cookies, storage, and history."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      {error && <p className="text-destructive">{error}</p>}
      {!loading && sessions.length === 0 && !error && (
        <EmptyState
          title="No persisted sessions"
          description="Browse in Motor to create persisted state when SessionPolicy and identity cookies are active."
        />
      )}
      {sessions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>Client token</TableHead>
              <TableHead>Cookies</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.sessionId}>
                <TableCell className="font-mono text-xs">{s.sessionId.slice(0, 10)}…</TableCell>
                <TableCell className="font-mono text-xs">{s.clientToken.slice(0, 10)}…</TableCell>
                <TableCell>{s.cookieCount}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  LS {s.localStorageCount} · IDB {s.idbRecordCount} · Hist {s.historyCount}
                </TableCell>
                <TableCell className="text-xs">{new Date(s.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="space-x-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/admin/sessions/${s.sessionId}`}>Open</Link>
                  </Button>
                  <ConfirmDestructive
                    title="Delete persisted session?"
                    description="This removes stored cookies and site state for this identity. The next browse starts fresh."
                    confirmLabel="Delete"
                    onConfirm={() => void remove(s.sessionId)}
                    trigger={<Button size="sm" variant="destructive">Delete</Button>}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
