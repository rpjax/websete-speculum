import { useEffect, useState } from 'react'
import { api, type ConfigStatus } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function DashboardPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Motor status</CardTitle>
          <CardDescription>Public status from /api/admin/config/status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-destructive">{error}</p>}
          {status && (
            <>
              <div className="flex items-center gap-2">
                <span>Operational</span>
                <Badge className={status.operational ? 'border-green-700 text-green-400' : 'border-amber-700 text-amber-400'}>
                  {status.operational ? 'yes' : 'no'}
                </Badge>
              </div>
              {status.missing.length > 0 && (
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">Missing sections:</p>
                  <ul className="list-disc pl-5 text-amber-400">
                    {status.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
