import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function profileBadge(p: NonNullable<ConfigStatus['hosting']>['profiles'][number]) {
  if (!p.subdomainMirroringEnabled) return { label: 'Apex + NSO', className: 'border-muted text-muted-foreground' }
  if (p.mirroringOperational) return { label: 'Mirroring OK', className: 'border-green-700 text-green-400' }
  return { label: 'Mirroring pending', className: 'border-amber-700 text-amber-400' }
}

export default function SetupPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load status'))
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold tracking-wide">Speculum — Setup</h1>
      <p className="mb-8 text-muted-foreground">Motor bootstrap wizard (W7S)</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Runtime configuration state</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-destructive">{error}</p>}
          {status && (
            <>
              <div className="flex items-center gap-2">
                <span>Operational:</span>
                <Badge className={status.operational ? 'border-green-700 text-green-400' : 'border-amber-700 text-amber-400'}>
                  {status.operational ? 'yes' : 'no'}
                </Badge>
              </div>
              {!status.operational && status.missing.length > 0 && (
                <ul className="list-disc pl-5 text-amber-400">
                  {status.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Hosting profiles</CardTitle>
          <CardDescription>Per-domain TLS and URL mode</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.hosting?.profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No domains configured yet — on a virgin VPS, open <code className="text-xs">/admin</code> via the server IP first.
            </p>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Sign in to the admin panel and configure required motor sections.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li><strong>Hosting</strong> — motor domain(s), optional subdomain mirroring + Cloudflare</li>
            <li><strong>Forwarding</strong> — target site apex and navigation allowlist</li>
            <li><strong>MaxSessions</strong> — concurrent browser cap</li>
          </ol>
          <Button asChild>
            <Link to="/admin/login">Open admin</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
