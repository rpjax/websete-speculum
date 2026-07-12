import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function subdomainBadge(sub?: ConfigStatus['subdomainMirroring']) {
  if (!sub?.enabled) return { label: 'Disabled', className: 'border-muted text-muted-foreground' }
  if (sub.operational) return { label: 'Operational', className: 'border-green-700 text-green-400' }
  return { label: 'Misconfigured', className: 'border-amber-700 text-amber-400' }
}

export default function DashboardPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
  }, [])

  const sub = status ? subdomainBadge(status.subdomainMirroring) : null

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
          <CardTitle>Subdomain mirroring</CardTitle>
          <CardDescription>Optional — mirrors target subdomains on the motor domain</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && sub && (
            <>
              <div className="flex items-center gap-2">
                <span>Status</span>
                <Badge className={sub.className}>{sub.label}</Badge>
              </div>
              {status.subdomainMirroring?.enabled && status.subdomainMirroring.missing.length > 0 && (
                <ul className="list-disc pl-5 text-amber-400">
                  {status.subdomainMirroring.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              <Link className="text-sm text-primary underline" to="/admin/subdomain-mirroring">
                Configure subdomain mirroring
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
