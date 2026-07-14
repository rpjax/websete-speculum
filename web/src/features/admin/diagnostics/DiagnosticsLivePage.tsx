import { useEffect, useState } from 'react'
import { diagnosticsApi, type MotorSessionDiagnosticsSnapshot, type MotorSessionListItem } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/admin/EmptyState'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'

export default function DiagnosticsLivePage() {
  const [sessions, setSessions] = useState<MotorSessionListItem[]>([])
  const [counts, setCounts] = useState({ active: 0, starting: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<MotorSessionDiagnosticsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await diagnosticsApi.listSessions()
      setSessions(res.sessions)
      setCounts({ active: res.activeCount, starting: res.startingCount })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to list sessions')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    void diagnosticsApi.getSession(selected)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Detail failed'))
  }, [selected])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">Active {counts.active}</Badge>
        <Badge variant="warning">Starting {counts.starting}</Badge>
        <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}

      {sessions.length === 0 ? (
        <EmptyState
          title="No live motor sessions"
          description="Connect from the Motor surface to start a remote browser session."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Connection</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>URL</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.connectionId}>
                <TableCell className="font-mono text-xs">{s.connectionId.slice(0, 12)}…</TableCell>
                <TableCell>
                  <Badge variant={s.starting ? 'warning' : 'success'}>{s.phase}</Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-xs">{s.currentUrl || '—'}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setSelected(s.connectionId)}>
                    Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Live session</SheetTitle>
            <SheetDescription className="font-mono text-xs">{selected}</SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="text-muted-foreground">Phase</span> {detail.phase}</p>
              <p><span className="text-muted-foreground">FPS</span> {detail.fps}</p>
              <p><span className="text-muted-foreground">URL</span> {detail.currentUrl || '—'}</p>
              <p><span className="text-muted-foreground">Sidecar</span> {detail.sidecarConnected ? 'connected' : 'down'}</p>
              <p><span className="text-muted-foreground">Fault</span> {detail.lastFault || 'none'}</p>
              <JsonTechnicalDetails data={detail} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
