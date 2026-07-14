import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { diagnosticsApi } from '@/lib/diagnosticsApi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'
import { HealthStatusStrip, type HealthItem } from '@/components/admin/HealthStatusStrip'
import { EmptyState } from '@/components/admin/EmptyState'
import { profileBadge, SECTION_HELP } from '@/lib/hostingStatus'

export default function DashboardPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [diagDegraded, setDiagDegraded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const st = await api.getStatus()
        setStatus(st)
        try {
          const ov = await diagnosticsApi.getOverview()
          setDiagDegraded(ov.degraded)
        } catch {
          setDiagDegraded(false)
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load status')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const health: HealthItem[] = status
    ? [
        {
          id: 'ops',
          label: 'Motor',
          value: status.operational ? 'Operational' : 'Needs setup',
          tone: status.operational ? 'success' : 'warning',
        },
        {
          id: 'diag',
          label: 'Diagnostics',
          value: diagDegraded ? 'Degraded' : 'Healthy',
          tone: diagDegraded ? 'destructive' : 'success',
          onClick: () => { window.location.href = '/admin/diagnostics' },
        },
        {
          id: 'profiles',
          label: 'Hosting',
          value: `${status.hosting?.profiles.length ?? 0} profile(s)`,
          tone: (status.hosting?.profiles.length ?? 0) > 0 ? 'success' : 'warning',
          onClick: () => { window.location.href = '/admin/hosting' },
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Operator overview — start with what needs attention, then drill into hosting and diagnostics."
      />

      {loading && <Skeleton className="h-16 w-full" />}
      {error && <p className="text-destructive">{error}</p>}
      {!loading && status && <HealthStatusStrip items={health} />}

      {!loading && status && status.missing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Missing configuration sections before the motor is fully operational.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {status.missing.map((m) => {
              const help = SECTION_HELP[m]
              return (
                <div key={m} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span className="text-sm">{m}</span>
                  {help && (
                    <Button asChild size="sm" variant="outline">
                      <Link to={help.href}>{help.title}</Link>
                    </Button>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {!loading && status && status.missing.length === 0 && status.operational && (
        <EmptyState
          title="Motor is operational"
          description="Configuration looks complete. Open Diagnostics for live health, or Sessions to inspect persisted browser state."
          action={
            <div className="flex gap-2">
              <Button asChild><Link to="/admin/diagnostics">Open diagnostics</Link></Button>
              <Button asChild variant="outline"><Link to="/admin/sessions">Browse sessions</Link></Button>
            </div>
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Hosting profiles</CardTitle>
          <CardDescription>Per-domain TLS, mirroring, and URL mode</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.hosting?.profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No domains configured — open Hosting to add the first profile.</p>
          )}
          {status?.hosting?.profiles.map((p) => {
            const b = profileBadge(p)
            return (
              <div key={p.domain} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.domain}</span>
                  <Badge variant={b.tone}>{b.label}</Badge>
                </div>
                {p.missing.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-warning">
                    {p.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/hosting">Configure hosting</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
