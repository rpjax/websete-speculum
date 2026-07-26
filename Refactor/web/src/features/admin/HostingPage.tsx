import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { api, ConfigSections, type ConfigStatus } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/admin/PageHeader'
import { HealthStatusStrip } from '@/components/admin/HealthStatusStrip'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'
import { profileBadge } from '@/lib/hostingStatus'
import { HostingProfileList } from './hosting/HostingProfileList'
import {
  HostingProfileSheet,
  type HostingProfile,
} from './hosting/HostingProfileSheet'

interface HostingConfig {
  acmeEmail: string
  profiles: HostingProfile[]
}

function emptyProfile(): HostingProfile {
  return { domain: '', subdomainMirroringEnabled: false }
}

export default function HostingPage() {
  const [acmeEmail, setAcmeEmail] = useState('')
  const [profiles, setProfiles] = useState<HostingProfile[]>([])
  const [savedProfiles, setSavedProfiles] = useState<HostingProfile[]>([])
  const [status, setStatus] = useState<ConfigStatus['hosting']>()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, st] = await Promise.all([
        api.getSection<HostingConfig>(ConfigSections.Hosting).catch((): HostingConfig => ({ acmeEmail: '', profiles: [] })),
        api.getStatus(),
      ])
      setAcmeEmail(cfg.acmeEmail ?? '')
      const loaded = cfg.profiles ?? []
      setProfiles(loaded)
      setSavedProfiles(loaded)
      setStatus(st.hosting)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load().catch(() => {})
  }, [load])

  function openProfile(index: number) {
    setEditingIndex(index)
    setSheetOpen(true)
  }

  function addProfile() {
    const newIdx = profiles.length
    setProfiles((prev) => [...prev, emptyProfile()])
    openProfile(newIdx)
  }

  function updateProfile(patch: Partial<HostingProfile>) {
    if (editingIndex === null) return
    setProfiles((prev) => prev.map((p, i) => (i === editingIndex ? { ...p, ...patch } : p)))
  }

  function removeProfile() {
    if (editingIndex === null) return
    setProfiles((prev) => prev.filter((_, i) => i !== editingIndex))
    setEditingIndex(null)
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

  const editingProfile = editingIndex !== null ? profiles[editingIndex] ?? null : null
  const editingStatus = editingProfile
    ? status?.profiles.find((s) => s.domain === editingProfile.domain)
    : undefined

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Hosting"
        description="Motor domains and TLS certificates. Saving applies changes and terminates active motor sessions."
      />

      {!loading && status?.profiles && status.profiles.length > 0 && (
        <HealthStatusStrip
          items={status.profiles.map((p) => {
            const b = profileBadge(p)
            const idx = profiles.findIndex((x) => x.domain === p.domain)
            return {
              id: p.domain,
              label: p.domain,
              value: b.label,
              tone: b.tone,
              onClick: idx >= 0 ? () => openProfile(idx) : undefined,
            }
          })}
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Global ACME email</CardTitle>
              <CardDescription>
                Default Let's Encrypt email for all profiles unless individually overridden.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="global-acme" className="sr-only">Global ACME email</Label>
                <Input
                  id="global-acme"
                  type="email"
                  placeholder="ops@yourcompany.com"
                  value={acmeEmail}
                  onChange={(e) => setAcmeEmail(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Domain profiles</h2>
              <span className="text-xs text-muted-foreground">
                {profiles.filter((p) => p.domain.trim()).length} configured
              </span>
            </div>

            <HostingProfileList
              profiles={profiles}
              statusProfiles={status?.profiles ?? []}
              onSelect={openProfile}
              onAdd={addProfile}
            />
          </section>

          <SaveFeedbackStrip
            pending={pending}
            message={message}
            error={error}
            onSave={() => void save()}
            saveLabel="Save hosting"
          />

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Wildcard mirroring requires a matching entry in{' '}
            <Link className="text-primary underline" to="/admin/forwarding">Forwarding</Link>.
          </p>
        </>
      )}

      <HostingProfileSheet
        profile={editingProfile}
        status={editingStatus}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChange={updateProfile}
        onRemove={removeProfile}
        profileIndex={editingIndex ?? 0}
        profileCount={profiles.length}
      />
    </div>
  )
}
