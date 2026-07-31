import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getAdminAuth } from '@/lib/adminAuth'
import { fetchClientConfig, type ClientConfig } from '@/lib/clientConfig'
import { HelperCallout, NextBestAction, PageHeader, StatusPill } from '@/features/admin/components'

export function ReadinessGatePage() {
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    fetchClientConfig('', true).then(setConfig).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load setup status.'))
  }, [])
  useEffect(load, [load])
  if (config?.operational) return <Navigate to="/admin" replace />

  return <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
    <PageHeader title="Setup" />
    {!config && !error ? <Skeleton className="h-56 w-full" /> : null}
    {error ? <HelperCallout tone="danger" title="Setup status unavailable"> {error}<Button variant="outline" size="sm" className="mt-3" onClick={load}>Retry</Button></HelperCallout> : null}
    {config ? <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><StatusPill label="Not ready" tone="warning" /> Setup required</CardTitle><CardDescription>Speculum will not start live sessions until mandatory engine sections are valid.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div><h2 className="text-sm font-medium">Missing sections</h2><div className="mt-2 flex flex-wrap gap-2">{config.missing.map((section) => <StatusPill key={section} label={section} tone="neutral" />)}</div></div>
        <NextBestAction title="Start guided configuration" body="Configure each missing mandatory section one step at a time." ctaLabel="Start guided configuration" href="/setup/configure" />
        {getAdminAuth() ? <Link className="text-sm underline" to="/admin">Back to Home</Link> : <p className="text-sm text-muted-foreground">You need to <Link className="underline" to="/admin/login?returnUrl=%2Fsetup%2Fconfigure">sign in to apply changes</Link> before changes can be applied.</p>}
      </CardContent>
    </Card> : null}
  </main>
}
