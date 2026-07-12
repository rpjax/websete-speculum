import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { getApiKey } from '@/lib/auth'
import { API_URL } from '@/lib/env'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

interface SubdomainConfig {
  enabled: boolean
  edgeTls?: { provider: string; email: string; apiToken: string }
}

export default function SubdomainMirroringPage() {
  const [enabled, setEnabled] = useState(false)
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [status, setStatus] = useState<ConfigStatus['subdomainMirroring']>()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [cfg, st] = await Promise.all([
      api.getSection<SubdomainConfig>('SubdomainMirroring').catch((): SubdomainConfig => ({ enabled: false })),
      fetch(`${API_URL}/api/admin/config/status`, {
        headers: { Authorization: `Bearer ${getApiKey() ?? ''}` },
      }).then((r) => r.json() as Promise<ConfigStatus>),
    ])
    setEnabled(!!cfg.enabled)
    setEmail(cfg.edgeTls?.email ?? '')
    setApiToken(cfg.edgeTls?.apiToken === '***' ? '' : (cfg.edgeTls?.apiToken ?? ''))
    setStatus(st.subdomainMirroring)
  }

  useEffect(() => { void load().catch(() => {}) }, [])

  async function save(nextEnabled = enabled) {
    setMessage(null)
    setError(null)
    try {
      const body = nextEnabled
        ? {
            enabled: true,
            edgeTls: {
              provider: 'cloudflare',
              email: email.trim(),
              apiToken: apiToken.trim() || '***',
            },
          }
        : { enabled: false }
      await api.putSection('SubdomainMirroring', body)
      await load()
      setMessage(nextEnabled ? 'Subdomain mirroring enabled' : 'Subdomain mirroring disabled')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const badge = !enabled
    ? 'Disabled'
    : status?.operational
      ? 'Operational'
      : 'Misconfigured'

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Subdomain Mirroring</h1>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Status: {badge}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled">ON</Label>
            <Switch
              id="enabled"
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v)
                if (!v) void save(false)
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            When enabled, target subdomains (e.g. www.olx.com.br) mirror to motor subdomains
            (www.speculum.com). Requires Cloudflare for wildcard TLS.
          </p>
          <div className="space-y-2">
            <Label htmlFor="email">Cloudflare ACME email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Cloudflare API token (Zone:DNS:Edit)</Label>
            <Input id="token" type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Leave blank to keep existing" />
          </div>
          {enabled && status?.missing && status.missing.length > 0 && (
            <ul className="list-disc pl-5 text-destructive">
              {status.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <p>
            Requires wildcard in <Link className="text-primary underline" to="/admin/forwarding">Forwarding.domains</Link>.
            Traefik container restart may be required after saving.
          </p>
          <Button onClick={() => void save(true)} disabled={!enabled}>Save &amp; enable</Button>
          {message && <p className="text-green-400">{message}</p>}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
