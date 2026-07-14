import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ConfigSections, type ConfigStatus } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { PageHeader } from '@/components/admin/PageHeader'
import { HealthStatusStrip } from '@/components/admin/HealthStatusStrip'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'
import { profileBadge } from '@/lib/hostingStatus'

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
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function load() {
    const [cfg, st] = await Promise.all([
      api.getSection<HostingConfig>(ConfigSections.Hosting).catch((): HostingConfig => ({ acmeEmail: '', profiles: [] })),
      api.getStatus(),
    ])
    setAcmeEmail(cfg.acmeEmail ?? '')
    const loaded = cfg.profiles?.length ? cfg.profiles : [emptyProfile()]
    setProfiles(loaded)
    setSavedProfiles(loaded)
    setStatus(st.hosting)
    setSelected(0)
  }

  useEffect(() => {
    void load().catch(() => {})
  }, [])

  function updateProfile(index: number, patch: Partial<HostingProfile>) {
    setProfiles((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  async function save() {
    setMessage(null)
    setError(null)
    setPending(true)
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
              throw new Error(`Cloudflare API token required for ${domain}`)
            }

            return {
              domain,
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
      await api.putSection(ConfigSections.Hosting, body)
      await load()
      setMessage('Hosting configuration saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setPending(false)
    }
  }

  const profile = profiles[selected] ?? profiles[0]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Hosting"
        description="Motor domains, TLS, and optional subdomain mirroring. Select a profile to edit — saving terminates active motor sessions."
      />

      <HealthStatusStrip
        items={(status?.profiles ?? []).map((p) => {
          const b = profileBadge(p)
          const idx = profiles.findIndex((x) => x.domain === p.domain)
          return {
            id: p.domain,
            label: p.domain,
            value: b.label,
            tone: b.tone,
            onClick: idx >= 0 ? () => setSelected(idx) : undefined,
          }
        })}
      />

      <Card>
        <CardHeader>
          <CardTitle>Global ACME email</CardTitle>
          <CardDescription>Used when a profile does not override email.</CardDescription>
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

      {profile && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">{profile.domain || `Profile ${selected + 1}`}</CardTitle>
              <CardDescription>Editing profile {selected + 1} of {profiles.length}</CardDescription>
            </div>
            <div className="flex gap-1">
              {profiles.map((_, i) => (
                <Button key={i} size="sm" variant={i === selected ? 'default' : 'outline'} onClick={() => setSelected(i)}>
                  {i + 1}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Motor domain</Label>
              <Input
                value={profile.domain}
                onChange={(e) => updateProfile(selected, { domain: e.target.value })}
                placeholder="example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>ACME email override (optional)</Label>
              <Input
                type="email"
                value={profile.acmeEmail ?? ''}
                onChange={(e) => updateProfile(selected, { acmeEmail: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={profile.subdomainMirroringEnabled}
                onCheckedChange={(v) => updateProfile(selected, { subdomainMirroringEnabled: v })}
              />
              <Label>Subdomain mirroring</Label>
            </div>
            {profile.subdomainMirroringEnabled && (
              <Accordion type="single" collapsible defaultValue="cf">
                <AccordionItem value="cf">
                  <AccordionTrigger>Cloudflare DNS-01</AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Cloudflare ACME email</Label>
                      <Input
                        type="email"
                        value={profile.edgeTls?.email ?? ''}
                        onChange={(e) =>
                          updateProfile(selected, {
                            edgeTls: {
                              provider: 'cloudflare',
                              email: e.target.value,
                              apiToken: profile.edgeTls?.apiToken ?? '',
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Cloudflare API token</Label>
                      <Input
                        type="password"
                        value={profile.edgeTls?.apiToken === '***' ? '' : (profile.edgeTls?.apiToken ?? '')}
                        onChange={(e) =>
                          updateProfile(selected, {
                            edgeTls: {
                              provider: 'cloudflare',
                              email: profile.edgeTls?.email ?? '',
                              apiToken: e.target.value,
                            },
                          })
                        }
                        placeholder="Leave blank to keep existing token"
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
            {status?.profiles.find((p) => p.domain === profile.domain)?.missing?.map((m) => (
              <Badge key={m} variant="warning">{m}</Badge>
            ))}
            {profiles.length > 1 && (
              <ConfirmDestructive
                title="Remove profile?"
                description="This profile will be removed when you save hosting."
                confirmLabel="Remove"
                onConfirm={() => {
                  setProfiles((p) => p.filter((_, i) => i !== selected))
                  setSelected(0)
                }}
                trigger={<Button variant="outline" size="sm">Remove profile</Button>}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setProfiles((p) => [...p, emptyProfile()]); setSelected(profiles.length) }}>
          Add domain
        </Button>
      </div>

      <SaveFeedbackStrip
        pending={pending}
        message={message}
        error={error}
        onSave={() => void save()}
        saveLabel="Save hosting"
      />

      <p className="text-sm text-muted-foreground">
        Wildcard mirroring requires a wildcard entry in{' '}
        <Link className="text-primary underline" to="/admin/forwarding">Forwarding</Link>.
      </p>
    </div>
  )
}
