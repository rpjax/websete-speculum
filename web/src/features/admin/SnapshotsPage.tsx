import { useEffect, useState } from 'react'
import { api, type SnapshotMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setSnapshots(await api.listSnapshots())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }

  useEffect(() => { void load() }, [])

  async function remove(sessionId: string) {
    try {
      await api.deleteSnapshot(sessionId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Snapshots</h1>
      <Card>
        <CardHeader><CardTitle>Browser profile snapshots (metadata only)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">Session ID</th>
                  <th className="py-2 pr-4">Last URL</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4">Updated</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.sessionId} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-xs">{s.sessionId.slice(0, 12)}…</td>
                    <td className="py-2 pr-4 max-w-xs truncate">{s.lastUrl}</td>
                    <td className="py-2 pr-4">{s.byteSize}</td>
                    <td className="py-2 pr-4 text-xs">{new Date(s.updatedAt).toLocaleString()}</td>
                    <td className="py-2">
                      <Button variant="destructive" size="sm" onClick={() => void remove(s.sessionId)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}
