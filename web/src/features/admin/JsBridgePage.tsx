import { useEffect, useState } from 'react'
import { api, ConfigSections } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function JsBridgePage() {
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSection<{ enable: boolean }>(ConfigSections.JsBridge).then((v) => setEnabled(v.enable)).catch(() => {})
  }, [])

  async function save() {
    setMessage(null)
    setError(null)
    try {
      await api.putSection(ConfigSections.JsBridge, { enable: enabled })
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function remove() {
    try {
      await api.deleteSection(ConfigSections.JsBridge)
      setEnabled(false)
      setMessage('Deleted (disabled by default)')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">JsBridge</h1>
      <Card>
        <CardHeader><CardTitle>vcon() eval bridge</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="jsbridge" />
            <Label htmlFor="jsbridge">Enable JsBridge</Label>
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
