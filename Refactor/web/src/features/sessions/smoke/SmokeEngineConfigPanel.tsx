import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  DEV_JOURNAL_TYPES,
  fetchDevEngineConfig,
  formatAllowlistLines,
  formatHostingDomainLines,
  parseAllowlistLines,
  parseHostingDomainLines,
  putDevEngineConfig,
  type DevEngineConfig,
  type DevJournalType,
} from './devEngineConfig'

interface SmokeEngineConfigPanelProps {
  hubOrigin: string
  /** Live sessions keep the sidecar allowlist from Start — warn the operator. */
  sessionLive: boolean
}

/**
 * Development backdoor editor for Hosting + Navigation (allowlist).
 * Writes through GET/PUT /api/dev/engine-config → IConfigurationService.
 */
export function SmokeEngineConfigPanel({
  hubOrigin,
  sessionLive,
}: SmokeEngineConfigPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [defaultTargetHost, setDefaultTargetHost] = useState('')
  const [allowAny, setAllowAny] = useState(false)
  const [allowlistText, setAllowlistText] = useState('')
  const [hostingText, setHostingText] = useState('')
  const [certificateEmail, setCertificateEmail] = useState('')
  const [journal, setJournal] = useState<Record<DevJournalType, boolean>>({
    'Sessions.InputApplied': false,
    'Sessions.ResizeApplied': false,
    'Sessions.ResizeRejected': false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const applySnapshot = (config: DevEngineConfig) => {
    setDefaultTargetHost(config.navigation.defaultTargetHost ?? '')
    const allowlist = formatAllowlistLines(config.navigation.allowedMainFrameUrls ?? [])
    setAllowAny(allowlist.allowAny)
    setAllowlistText(allowlist.text)
    setHostingText(formatHostingDomainLines(config.hosting.domains ?? []))
    setCertificateEmail(config.hosting.defaultCertificateEmail ?? '')
    const nextJournal = { ...journal }
    for (const type of DEV_JOURNAL_TYPES) {
      nextJournal[type] = Boolean(config.journal?.[type])
    }
    setJournal(nextJournal)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await fetchDevEngineConfig(hubOrigin)
        if (cancelled) {
          return
        }
        if (!config) {
          setAvailable(false)
          return
        }
        setAvailable(true)
        applySnapshot(config)
      } catch (err) {
        if (!cancelled) {
          setAvailable(false)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hubOrigin])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body: DevEngineConfig = {
        hosting: {
          defaultCertificateEmail: certificateEmail.trim(),
          domains: parseHostingDomainLines(hostingText),
        },
        navigation: {
          defaultTargetHost: defaultTargetHost.trim(),
          allowedMainFrameUrls: parseAllowlistLines(allowlistText, allowAny),
        },
        journal,
      }
      const saved = await putDevEngineConfig(body, hubOrigin)
      applySnapshot(saved)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (available === null) {
    return <p className="text-[11px] text-muted-foreground">Loading engine config…</p>
  }

  if (!available) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        Dev backdoor unavailable. Expect <code>GET /api/dev/engine-config</code> when the
        API is <code>Development</code> or <code>SPECULUM_ENABLE_DEV_BACKDOOR=true</code>
        (dockup <code>dev</code>).
        {error ? (
          <>
            <br />
            <span className="text-destructive">{error}</span>
          </>
        ) : null}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Writes Hosting + Navigation through <code>IConfigurationService</code>. URL resolve
        picks up Navigation on the next Navigate; sidecar main-frame guard is fixed at Start
        — stop/start the session after allowlist changes.
      </p>

      {sessionLive && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          Session is live — allowlist changes apply to resolve now, but the browser guard
          updates only on the next Start.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="dev-default-host">Default target host</Label>
        <Input
          id="dev-default-host"
          className="font-mono text-xs"
          value={defaultTargetHost}
          spellCheck={false}
          placeholder="www.google.com"
          onChange={(event) => setDefaultTargetHost(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="dev-allow-any">Allow any main-frame host</Label>
          <p className="text-[11px] text-muted-foreground">
            Sets <code>AllowedMainFrameUrls[].Domain.Scope = Any</code>
          </p>
        </div>
        <Switch
          id="dev-allow-any"
          checked={allowAny}
          onCheckedChange={setAllowAny}
        />
      </div>

      {!allowAny && (
        <div className="space-y-2">
          <Label htmlFor="dev-allowlist">Allowlist (one host per line)</Label>
          <Textarea
            id="dev-allowlist"
            className="min-h-[96px] font-mono text-xs"
            value={allowlistText}
            spellCheck={false}
            placeholder={'example.com\n*.example.com\nwww.google.com'}
            onChange={(event) => setAllowlistText(event.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="dev-hosting">Hosting domains (one per line)</Label>
        <Textarea
          id="dev-hosting"
          className="min-h-[72px] font-mono text-xs"
          value={hostingText}
          spellCheck={false}
          placeholder={'speculum.test\nspeculum.test +mirror'}
          onChange={(event) => setHostingText(event.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Append <code>+mirror</code> to enable subdomain mirroring for that session domain.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dev-cert-email">Default certificate email</Label>
        <Input
          id="dev-cert-email"
          className="font-mono text-xs"
          value={certificateEmail}
          spellCheck={false}
          placeholder="optional"
          onChange={(event) => setCertificateEmail(event.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div>
          <p className="text-xs font-medium">Journal (test / debug only)</p>
          <p className="text-[11px] text-muted-foreground">
            Opt-in facts stay off until you enable them. Expensive for real traffic — never
            on by default.
          </p>
        </div>
        {DEV_JOURNAL_TYPES.map((type) => (
          <div key={type} className="flex items-center justify-between gap-3">
            <Label htmlFor={`dev-journal-${type}`} className="font-mono text-[11px]">
              {type}
            </Label>
            <Switch
              id={`dev-journal-${type}`}
              checked={journal[type]}
              onCheckedChange={(checked) =>
                setJournal((prev) => ({ ...prev, [type]: checked }))
              }
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !defaultTargetHost.trim()} onClick={() => void save()}>
          Save engine config
        </Button>
        {savedAt && (
          <span className="text-[11px] text-muted-foreground">Saved {savedAt}</span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
