import { useEffect, useState } from 'react'
import { api, ConfigSections } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SessionPolicyPage() {
  const [ttlDays, setTtlDays] = useState('30')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSection<{ ttlDays: number }>(ConfigSections.SessionPolicy)
      .then((v) => setTtlDays(String(v.ttlDays)))
      .catch(() => {})
  }, [])

  async function save() {
    setMessage(null)
    setError(null)
    try {
      await api.putSection(ConfigSections.SessionPolicy, { ttlDays: Number(ttlDays) })
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function remove() {
    setMessage(null)
    setError(null)
    try {
      await api.deleteSection(ConfigSections.SessionPolicy)
      setTtlDays('30')
      setMessage('Deleted (default 30-day TTL applies)')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Session Policy</h1>
      <Card>
        <CardHeader><CardTitle>Browser session TTL</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ttl">TTL (days)</Label>
            <Input id="ttl" type="number" min={1} value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Save</Button>
            <Button variant="outline" onClick={() => void remove()}>Delete</Button>
          </div>
          {message && <p className="text-green-400">{message}</p>}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
