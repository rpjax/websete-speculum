import { useEffect, useState } from 'react'
import { diagnosticsApi, type DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EventTimeline } from '@/components/admin/EventTimeline'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'
import { EmptyState } from '@/components/admin/EmptyState'

export default function DiagnosticsEventsPage() {
  const [events, setEvents] = useState<DiagnosticsEventRecord[]>([])
  const [namePrefix, setNamePrefix] = useState('')
  const [since, setSince] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setEvents(await diagnosticsApi.listEvents({
        namePrefix: namePrefix || undefined,
        since: since || undefined,
      }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        setEvents(await diagnosticsApi.listEvents({}))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load events')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="prefix">Name prefix</Label>
            <Input id="prefix" value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} placeholder="Motor." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="since">Since (ISO)</Label>
            <Input id="since" value={since} onChange={(e) => setSince(e.target.value)} placeholder="2026-01-01T00:00:00Z" />
          </div>
          <Button disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Apply'}</Button>
        </CardContent>
      </Card>

      {error && <p className="text-destructive">{error}</p>}

      {!loading && events.length === 0 && !error ? (
        <EmptyState
          title="No events"
          description="Try widening the filter or confirm Diagnostics is enabled and levels allow Events."
          action={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
        />
      ) : (
        <EventTimeline events={events} />
      )}

      {events.length > 0 && <JsonTechnicalDetails data={events.slice(0, 20)} title="Raw sample (first 20)" />}
    </div>
  )
}
