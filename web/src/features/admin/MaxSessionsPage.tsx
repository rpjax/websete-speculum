import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function MaxSessionsPage() {
  const [value, setValue] = useState('4')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSection<number>('MaxSessions').then((v) => setValue(String(v))).catch(() => {})
  }, [])

  async function save() {
    setMessage(null)
    setError(null)
    try {
      await api.putSection('MaxSessions', Number(value))
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Max Sessions</h1>
      <Card>
        <CardHeader><CardTitle>Concurrent session limit</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max">Max sessions (1–65535)</Label>
            <Input id="max" type="number" min={1} max={65535} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button onClick={() => void save()}>Save</Button>
          {message && <p className="text-green-400">{message}</p>}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
