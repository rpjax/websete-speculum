import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticsApi, type DiagnosticsOverview } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HealthStatusStrip } from '@/components/admin/HealthStatusStrip'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

export default function DiagnosticsOverviewPage() {
  const [overview, setOverview] = useState<DiagnosticsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [elevateFloor, setElevateFloor] = useState('BrowserQuery')
  const [elevateMinutes, setElevateMinutes] = useState('15')

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setOverview(await diagnosticsApi.getOverview())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function recover() {
    setPending(true)
    setMessage(null)
    try {
      const r = await diagnosticsApi.recover()
      setMessage(r.recovered ? 'Circuit recovered' : 'Already healthy')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Recover failed')
    } finally {
      setPending(false)
    }
  }

  async function elevate() {
    setPending(true)
    setMessage(null)
    try {
      await diagnosticsApi.elevate({
        browserQueryFloor: elevateFloor as 'BrowserQuery',
        minutes: Number(elevateMinutes),
      })
      setMessage('Elevate applied')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Elevate failed')
    } finally {
      setPending(false)
    }
  }

  if (!overview && !error) return <Skeleton className="h-40 w-full" />

  return (
    <div className="space-y-4">
      {error && <p className="text-destructive">{error}</p>}
      {message && <p className="text-success">{message}</p>}
      {overview && (
        <>
          <HealthStatusStrip
            items={[
              {
                id: 'health',
                label: 'Circuit',
                value: overview.degraded ? 'Degraded' : 'Healthy',
                tone: overview.degraded ? 'destructive' : 'success',
              },
              {
                id: 'enabled',
                label: 'Pipeline',
                value: overview.enabled ? 'Enabled' : 'Off',
                tone: overview.enabled ? 'success' : 'muted',
              },
              {
                id: 'live',
                label: 'Live sessions',
                value: String(overview.liveSessions.total),
                tone: overview.liveSessions.total > 0 ? 'success' : 'muted',
                onClick: () => { window.location.href = '/admin/diagnostics/live' },
              },
              {
                id: 'bytes',
                label: 'Storage',
                value: formatBytes(overview.bytesUsed),
                tone: 'muted',
              },
            ]}
          />

          {overview.needsAttention.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.needsAttention.map((n) => (
                  <p key={n} className="text-sm text-warning">{n}</p>
                ))}
                <Button disabled={pending} onClick={() => void recover()}>
                  Recover diagnostics
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Events stored</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{overview.eventsStored}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Dropped</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{overview.eventsDropped}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Probes in flight</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{overview.probeInFlight}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elevate BrowserQuery</CardTitle>
              <CardDescription>Temporarily raise browser-query floor for deep probes (ops/lab).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Floor</Label>
                <Select value={elevateFloor} onValueChange={setElevateFloor}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Metrics', 'Events', 'StateSnapshots', 'BrowserQuery'].map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mins">Minutes</Label>
                <Input id="mins" className="w-24" value={elevateMinutes} onChange={(e) => setElevateMinutes(e.target.value)} />
              </div>
              <Button disabled={pending} onClick={() => void elevate()}>Elevate</Button>
              <Button variant="outline" disabled={pending} onClick={() => void diagnosticsApi.clearElevate().then(refresh)}>
                Clear elevate
              </Button>
            </CardContent>
          </Card>

          <Accordion type="single" collapsible>
            <AccordionItem value="levels">
              <AccordionTrigger>Effective levels</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-1 text-sm">
                  {Object.entries(overview.effectiveLevels).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-4 border-b border-border/40 py-1">
                      <span className="text-muted-foreground">{k}</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/admin/diagnostics/events">View events</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/admin/diagnostics/probes">Run probes</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/admin/diagnostics/config">Edit config</Link></Button>
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>Refresh</Button>
          </div>
        </>
      )}
    </div>
  )
}
