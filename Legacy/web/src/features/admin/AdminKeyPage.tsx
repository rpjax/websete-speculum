import { useState } from 'react'
import { api, ConfigSections } from '@/lib/api'
import { setApiKey } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/admin/PageHeader'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'
import { Button } from '@/components/ui/button'

export default function AdminKeyPage() {
  const [newKey, setNewKey] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function rotate() {
    setMessage(null)
    setError(null)
    if (!newKey.trim()) {
      setError('New API key is required')
      return
    }
    setPending(true)
    try {
      await api.putSection(ConfigSections.Admin, { apiKey: newKey.trim() })
      setApiKey(newKey.trim())
      setNewKey('')
      setMessage('API key rotated. This browser session now uses the new key.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Rotate failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title="API key"
        description="Rotate the admin bearer key. GET Admin never returns the current secret."
      />
      <Card>
        <CardHeader>
          <CardTitle>Rotate admin API key</CardTitle>
          <CardDescription>
            Other open admin tabs will stop working until they sign in again with the new key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newKey">New API key</Label>
            <Input
              id="newKey"
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <ConfirmDestructive
            title="Rotate API key?"
            description="This immediately invalidates the previous key for all admin clients."
            confirmLabel="Rotate key"
            onConfirm={() => void rotate()}
            trigger={
              <Button type="button" variant="destructive" disabled={pending || !newKey.trim()}>
                {pending ? 'Rotating…' : 'Rotate key'}
              </Button>
            }
          />
          {message && <p className="text-sm text-success" role="status">{message}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
