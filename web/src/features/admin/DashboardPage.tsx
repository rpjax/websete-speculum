import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function profileBadge(p: NonNullable<ConfigStatus['hosting']>['profiles'][number]) {
  if (!p.subdomainMirroringEnabled) return { label: 'Apex + NSO', className: 'border-muted text-muted-foreground' }
  if (p.mirroringOperational) return { label: 'Mirroring OK', className: 'border-green-700 text-green-400' }
  return { label: 'Mirroring pending', className: 'border-amber-700 text-amber-400' }
}

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

      <Card>
        <CardHeader>
          <CardTitle>Hosting profiles</CardTitle>
          <CardDescription>Per-domain TLS, mirroring, and URL mode</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.hosting?.profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No domains configured — bootstrap via VPS IP.</p>
          )}
          {status?.hosting?.profiles.map((p) => {
            const b = profileBadge(p)
            return (
              <div key={p.domain} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.domain}</span>
                  <Badge className={b.className}>{b.label}</Badge>
                </div>
                {p.missing.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-amber-400">
                    {p.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
          <Link className="text-sm text-primary underline" to="/admin/hosting">
            Configure hosting
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
