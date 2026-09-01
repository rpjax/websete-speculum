import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { setApiKey, clearApiKey } from '@/lib/auth'
import { API_URL, MOCK_MODE } from '@/lib/env'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (MOCK_MODE) navigate('/admin', { replace: true })
  }, [navigate])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!key.trim()) {
      setError('API key is required')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/config/Admin`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        credentials: 'include',
      })
      if (!res.ok) {
        clearApiKey()
        setError(res.status === 401 ? 'Invalid API key' : `Login failed (${res.status})`)
        return
      }
      setApiKey(key)
      navigate('/admin')
    } catch {
      setError('Cannot reach API')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin login</CardTitle>
          <CardDescription>Paste the bootstrap API key from container logs or ADMIN_BOOTSTRAP_KEY</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
