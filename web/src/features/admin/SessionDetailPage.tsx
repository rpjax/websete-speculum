import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SessionDetailPage() {
  const { sessionId } = useParams()
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.getSession>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    api.getSession(sessionId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [sessionId])

  if (error) return <p className="text-destructive">{error}</p>
  if (!detail) return <p className="text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-4">
      <Link to="/admin/sessions" className="text-primary underline">← Sessions</Link>
      <h1 className="font-mono text-lg">{detail.sessionId}</h1>
      <p className="text-sm text-muted-foreground">Client token: {detail.clientToken}</p>

      <Card>
        <CardHeader><CardTitle>Cookies ({detail.cookies.length})</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-auto text-xs font-mono">
          {detail.cookies.map((c, i) => (
            <div key={i} className="border-b py-1">{c.domain}{c.path} {c.name}={c.value.slice(0, 40)}</div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Local Storage ({detail.localStorage.length})</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-auto text-xs font-mono">
          {detail.localStorage.map((l, i) => (
            <div key={i} className="border-b py-1">{l.origin} {l.key}={l.value.slice(0, 60)}</div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>IndexedDB ({detail.idbRecords.length})</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-auto text-xs font-mono">
          {detail.idbRecords.map((r, i) => (
            <div key={i} className="border-b py-1">{r.origin}/{r.databaseName}/{r.storeName} key={r.keyJson}</div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>History ({detail.history.length})</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-auto text-xs">
          {detail.history.map((h, i) => (
            <div key={i} className="border-b py-1">{h.indexOrder}. {h.url}</div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
