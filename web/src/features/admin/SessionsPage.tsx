import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SessionMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      setSessions(await api.listSessions())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Browser Sessions</h1>
        <Button variant="outline" onClick={() => void load()}>Refresh</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Persisted browser state</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {error && <p className="text-destructive">{error}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Session</th>
                <th className="p-2">Client token</th>
                <th className="p-2">Counts</th>
                <th className="p-2">Updated</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId} className="border-b border-border/50">
                  <td className="p-2 font-mono text-xs">{s.sessionId.slice(0, 8)}…</td>
                  <td className="p-2 font-mono text-xs">{s.clientToken.slice(0, 8)}…</td>
                  <td className="p-2 text-xs">
                    c:{s.cookieCount} ls:{s.localStorageCount} idb:{s.idbRecordCount} h:{s.historyCount}
                  </td>
                  <td className="p-2 text-xs">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td className="p-2 space-x-2">
                    <Link className="text-primary underline" to={`/admin/sessions/${s.sessionId}`}>View</Link>
                    <button type="button" className="text-destructive" onClick={() => void api.deleteSession(s.sessionId).then(load)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
