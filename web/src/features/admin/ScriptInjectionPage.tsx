import { useEffect, useState } from 'react'
import { api, ConfigSections } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ScriptInjectionPage() {
  const [json, setJson] = useState('[]')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSection<unknown>(ConfigSections.ScriptInjection)
      .then((v) => setJson(JSON.stringify(v, null, 2)))
      .catch(() => {})
  }, [])

  async function save() {
    setMessage(null)
    setError(null)
    try {
      const body = JSON.parse(json)
      await api.putSection(ConfigSections.ScriptInjection, body)
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid JSON or save failed')
    }
  }

  async function remove() {
    setMessage(null)
    setError(null)
    try {
      await api.deleteSection(ConfigSections.ScriptInjection)
      setJson('[]')
      setMessage('Deleted')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Script Injection</h1>
      <Card>
        <CardHeader><CardTitle>Injection entries (JSON array)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="json">ScriptInjection JSON</Label>
            <Textarea id="json" className="min-h-64 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
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
