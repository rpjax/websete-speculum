import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConfigStatus } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

interface HostingProfile {
  domain: string
  acmeEmail?: string | null
  subdomainMirroringEnabled: boolean
  edgeTls?: { provider: string; email: string; apiToken: string }
}

interface HostingConfig {
  acmeEmail: string
  profiles: HostingProfile[]
}

function emptyProfile(): HostingProfile {
  return { domain: '', subdomainMirroringEnabled: false }
}

export default function HostingPage() {
  const [acmeEmail, setAcmeEmail] = useState('')
  const [profiles, setProfiles] = useState<HostingProfile[]>([emptyProfile()])
  const [savedProfiles, setSavedProfiles] = useState<HostingProfile[]>([])
  const [status, setStatus] = useState<ConfigStatus['hosting']>()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [cfg, st] = await Promise.all([
      api.getSection<HostingConfig>('Hosting').catch((): HostingConfig => ({ acmeEmail: '', profiles: [] })),
      api.getStatus(),
    ])
    setAcmeEmail(cfg.acmeEmail ?? '')
    const loaded = cfg.profiles?.length ? cfg.profiles : [emptyProfile()]
    setProfiles(loaded)
    setSavedProfiles(loaded)
    setStatus(st.hosting)
  }

  useEffect(() => { void load().catch(() => {}) }, [])

  function updateProfile(index: number, patch: Partial<HostingProfile>) {
    setProfiles((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  async function save() {
    setMessage(null)
    setError(null)
    try {
      const body: HostingConfig = {
        acmeEmail: acmeEmail.trim(),
        profiles: profiles
          .filter((p) => p.domain.trim())
          .map((p) => {
            const domain = p.domain.trim()
            const saved = savedProfiles.find((s) => s.domain === domain)
            const hadMirroring = saved?.subdomainMirroringEnabled
            const tokenInput = p.edgeTls?.apiToken?.trim() ?? ''
            const useMaskedToken = hadMirroring && (tokenInput === '' || tokenInput === '***')

            if (p.subdomainMirroringEnabled && !useMaskedToken && !tokenInput) {
              throw new Error(`Cloudflare API token required for ${p.domain.trim()}`)
            }

            return {
              domain: p.domain.trim(),
              acmeEmail: p.acmeEmail?.trim() || null,
              subdomainMirroringEnabled: p.subdomainMirroringEnabled,
              edgeTls: p.subdomainMirroringEnabled
                ? {
                    provider: 'cloudflare',
                    email: p.edgeTls?.email?.trim() ?? '',
                    apiToken: useMaskedToken ? '***' : tokenInput,
                  }
                : undefined,
            }
          }),
      }
      await api.putSection('Hosting', body)
      await load()
      setMessage('Hosting configuration saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Hosting</h1>
      <p className="text-sm text-muted-foreground">
        One complete profile per motor domain: TLS, mirroring, and Cloudflare credentials.
        Forwarding target site is configured separately.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Global ACME email</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="email"
            placeholder="admin@example.com"
            value={acmeEmail}
            onChange={(e) => setAcmeEmail(e.target.value)}
          />
        </CardContent>
      </Card>

      {profiles.map((profile, index) => {
        const st = status?.profiles[index]?.domain === profile.domain
          ? status.profiles[index]
          : status?.profiles.find((p) => p.domain === profile.domain)
        const badge = !profile.subdomainMirroringEnabled
          ? 'Apex + NSO'
          : st?.mirroringOperational
            ? 'Mirroring OK'
            : 'Mirroring pending'

        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">{profile.domain || `Profile ${index + 1}`}</CardTitle>
              <span className="text-xs text-muted-foreground">{badge}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Motor domain</Label>
                <Input
                  value={profile.domain}
                  onChange={(e) => updateProfile(index, { domain: e.target.value })}
                  placeholder="meu-site.com"
                />
              </div>
              <div className="space-y-2">
                <Label>ACME email override (optional)</Label>
                <Input
                  type="email"
                  value={profile.acmeEmail ?? ''}
                  onChange={(e) => updateProfile(index, { acmeEmail: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={profile.subdomainMirroringEnabled}
                  onCheckedChange={(v) => updateProfile(index, { subdomainMirroringEnabled: v })}
                />
                <Label>Subdomain mirroring (wildcard TLS via Cloudflare DNS-01)</Label>
              </div>
              {profile.subdomainMirroringEnabled && (
                <>
                  <div className="space-y-2">
                    <Label>Cloudflare ACME email</Label>
                    <Input
                      type="email"
                      value={profile.edgeTls?.email ?? ''}
                      onChange={(e) => updateProfile(index, {
                        edgeTls: { provider: 'cloudflare', email: e.target.value, apiToken: profile.edgeTls?.apiToken ?? '' },
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cloudflare API token</Label>
                    <Input
                      type="password"
                      value={profile.edgeTls?.apiToken === '***' ? '' : (profile.edgeTls?.apiToken ?? '')}
                      onChange={(e) => updateProfile(index, {
                        edgeTls: { provider: 'cloudflare', email: profile.edgeTls?.email ?? '', apiToken: e.target.value },
                      })}
                      placeholder="Required for new profiles; leave blank to keep existing"
                    />
                  </div>
                </>
              )}
              {st?.missing && st.missing.length > 0 && (
                <ul className="list-disc pl-5 text-destructive text-sm">
                  {st.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              {profiles.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => setProfiles((p) => p.filter((_, i) => i !== index))}>
                  Remove profile
                </Button>
              )}
            </CardContent>
          </Card>
        )
      })}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setProfiles((p) => [...p, emptyProfile()])}>
          Add domain
        </Button>
        <Button onClick={() => void save()}>Save hosting</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Wildcard mirroring requires a wildcard entry in{' '}
        <Link className="text-primary underline" to="/admin/forwarding">Forwarding.domains</Link>.
        Saving hosting terminates active motor sessions.
      </p>
      {message && <p className="text-green-400">{message}</p>}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}
