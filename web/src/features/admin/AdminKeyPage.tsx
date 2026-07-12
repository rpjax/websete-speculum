import { useState } from 'react'
import { api } from '@/lib/api'
import { setApiKey } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AdminKeyPage() {
  const [newKey, setNewKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function rotate() {
    setMessage(null)
    setError(null)
    if (!newKey.trim()) {
      setError('New API key is required')
      return
    }
    try {
      await api.putSection('Admin', { apiKey: newKey.trim() })
      setApiKey(newKey.trim())
      setNewKey('')
      setMessage('API key rotated. Session updated with new key.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Rotate failed')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">API Key</h1>
      <Card>
        <CardHeader>
          <CardTitle>Rotate admin API key</CardTitle>
          <CardDescription>GET Admin never returns the current key — only confirms configured=true</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newKey">New API key</Label>
            <Input id="newKey" type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          </div>
          <Button onClick={() => void rotate()}>Rotate key</Button>
          {message && <p className="text-green-400">{message}</p>}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
