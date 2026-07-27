import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  LAB_JOURNAL_TYPES,
  createLabResourceManagementBaseline,
  createLabSessionsBaseline,
  fetchLabEngineConfig,
  formatAllowlistLines,
  formatHostingDomainLines,
  parseAllowlistLines,
  parseHostingDomainLines,
  putLabEngineConfig,
  type LabConfigStatus,
  type LabEngineConfig,
  type LabJournalType,
  type LabResourceManagementConfig,
  type LabSessionsConfig,
} from './labEngineConfig'

interface LabEngineConfigPanelProps {
  hubOrigin: string
  /** Live sessions keep the sidecar allowlist from Start — warn the operator. */
  sessionLive: boolean
}

function emptyJournal(): Record<LabJournalType, boolean> {
  return {
    'Sessions.InputApplied': false,
    'Sessions.InputRejected': false,
    'Sessions.ResizeApplied': false,
    'Sessions.ResizeRejected': false,
  }
}

/**
 * Lab editor for Hosting + Navigation + Sessions + ResourceManagement + Journal.
 * Writes through `/api/configurations/{section}` → Load/Apply store.
 */
export function LabEngineConfigPanel({
  hubOrigin,
  sessionLive,
}: LabEngineConfigPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [status, setStatus] = useState<LabConfigStatus | null>(null)
  const [defaultTargetHost, setDefaultTargetHost] = useState('')
  const [allowAny, setAllowAny] = useState(false)
  const [allowlistText, setAllowlistText] = useState('')
  const [hostingText, setHostingText] = useState('')
  const [certificateEmail, setCertificateEmail] = useState('')
  const [sessions, setSessions] = useState<LabSessionsConfig>(createLabSessionsBaseline())
  const [resourceManagement, setResourceManagement] = useState<LabResourceManagementConfig>(
    createLabResourceManagementBaseline(),
  )
  const [hostingDomains, setHostingDomains] = useState<LabEngineConfig['hosting']['domains']>([])
  const [navigationRules, setNavigationRules] = useState<
    LabEngineConfig['navigation']['allowedMainFrameUrls']
  >([])
  const [journal, setJournal] = useState<Record<LabJournalType, boolean>>(emptyJournal)
  const [journalAll, setJournalAll] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const applySnapshot = (config: LabEngineConfig) => {
    setStatus(config.status ?? null)
    setDefaultTargetHost(config.navigation.defaultTargetHost ?? '')
    const allowlist = formatAllowlistLines(config.navigation.allowedMainFrameUrls ?? [])
    setAllowAny(allowlist.allowAny)
    setAllowlistText(allowlist.text)
    setNavigationRules(config.navigation.allowedMainFrameUrls ?? [])
    setHostingText(formatHostingDomainLines(config.hosting.domains ?? []))
    setHostingDomains(config.hosting.domains ?? [])
    setCertificateEmail(config.hosting.defaultCertificateEmail ?? '')
    setSessions(config.sessions)
    setResourceManagement(config.resourceManagement)
    setJournalAll({ ...(config.journal ?? {}) })
    const nextJournal = emptyJournal()
    for (const type of LAB_JOURNAL_TYPES) {
      nextJournal[type] = Boolean(config.journal?.[type])
    }
    setJournal(nextJournal)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await fetchLabEngineConfig(hubOrigin)
        if (cancelled) {
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
      const body: LabEngineConfig = {
        hosting: {
          defaultCertificateEmail: certificateEmail.trim(),
          domains: parseHostingDomainLines(hostingText, hostingDomains),
        },
        navigation: {
          defaultTargetHost: defaultTargetHost.trim(),
          allowedMainFrameUrls: parseAllowlistLines(
            allowlistText,
            allowAny,
            navigationRules,
          ),
        },
        sessions,
        resourceManagement,
        journal: {
          ...journalAll,
          ...journal,
        },
      }
      const saved = await putLabEngineConfig(body, hubOrigin)
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
        Configuration API unavailable. Expect{' '}
        <code>GET /api/configurations/status</code> (and Hosting / Navigation / Sessions /
        ResourceManagement / Journal). When <code>SPECULUM_BYPASS_API_AUTH</code> is not
        enabled, these routes require <code>Authorization: Bearer</code> matching{' '}
        <code>SPECULUM_API_AUTH_TOKEN</code>.
        {error ? (
          <>
            <br />
            <span className="text-destructive">{error}</span>
          </>
        ) : null}
      </p>
    )
  }

  const defaultViewport = sessions.viewportPolicy.default

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Writes Hosting, Navigation, Sessions, ResourceManagement, and Journal through{' '}
        Writes through <code>PUT /api/configurations</code> (atomic batch Apply). Mandatory
        sections must be complete before <code>/health/ready</code> and StartSession.
      </p>

      <div
        className={
          status?.operational
            ? 'rounded-md border border-border px-2 py-1.5 text-[11px]'
            : 'rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning'
        }
      >
        {status?.operational ? (
          <>Operational — mandatory configuration satisfied.</>
        ) : (
          <>
            Pending config
            {status?.missing?.length ? `: ${status.missing.join(', ')}` : ''}. Fill Sessions /
            ResourceManagement / Navigation below, then Save.
          </>
        )}
      </div>

      {sessionLive && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          Session is live — allowlist changes apply to resolve now, but the browser guard
          updates only on the next Start.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="lab-default-host">Default target host</Label>
        <Input
          id="lab-default-host"
          className="font-mono text-xs"
          value={defaultTargetHost}
          spellCheck={false}
          placeholder="www.google.com"
          onChange={(event) => setDefaultTargetHost(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="lab-allow-any">Allow any main-frame host</Label>
          <p className="text-[11px] text-muted-foreground">
            Sets <code>AllowedMainFrameUrls[].Domain.Scope = Any</code>
          </p>
        </div>
        <Switch
          id="lab-allow-any"
          checked={allowAny}
          onCheckedChange={setAllowAny}
        />
      </div>

      {!allowAny && (
        <div className="space-y-2">
          <Label htmlFor="lab-allowlist">Allowlist (one host per line)</Label>
          <Textarea
            id="lab-allowlist"
            className="min-h-[96px] font-mono text-xs"
            value={allowlistText}
            spellCheck={false}
            placeholder={'example.com\n*.example.com\nwww.google.com'}
            onChange={(event) => setAllowlistText(event.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="lab-hosting">Hosting domains (one per line)</Label>
        <Textarea
          id="lab-hosting"
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
        <Label htmlFor="lab-cert-email">Default certificate email</Label>
        <Input
          id="lab-cert-email"
          className="font-mono text-xs"
          value={certificateEmail}
          spellCheck={false}
          placeholder="optional"
          onChange={(event) => setCertificateEmail(event.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium">Sessions + capacity (mandatory)</p>
            <p className="text-[11px] text-muted-foreground">
              Required for ready / StartSession. Use Fill lab baseline for a complete
              operator-chosen snapshot, then edit.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setSessions(createLabSessionsBaseline())
              setResourceManagement((prev) => ({
                ...createLabResourceManagementBaseline(),
                profiles: prev.profiles,
                diagnostics: prev.diagnostics,
              }))
            }}
          >
            Fill lab baseline
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="lab-max-sessions">Max concurrent sessions</Label>
            <Input
              id="lab-max-sessions"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={resourceManagement.sessions.maxConcurrentSessions || ''}
              onChange={(event) => {
                const value = Number(event.target.value)
                setResourceManagement((prev) => ({
                  ...prev,
                  sessions: {
                    ...prev.sessions,
                    maxConcurrentSessions: Number.isFinite(value) ? value : 0,
                  },
                }))
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-detached">Detached timeout</Label>
            <Input
              id="lab-detached"
              className="font-mono text-xs"
              value={sessions.detachedSessionTimeout}
              spellCheck={false}
              placeholder="00:05:00"
              onChange={(event) =>
                setSessions((prev) => ({
                  ...prev,
                  detachedSessionTimeout: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-vp-w">Default viewport width</Label>
            <Input
              id="lab-vp-w"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={defaultViewport.width || ''}
              onChange={(event) => {
                const width = Number(event.target.value)
                setSessions((prev) => ({
                  ...prev,
                  viewportPolicy: {
                    ...prev.viewportPolicy,
                    default: {
                      ...prev.viewportPolicy.default,
                      width: Number.isFinite(width) ? width : 0,
                    },
                  },
                }))
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-vp-h">Default viewport height</Label>
            <Input
              id="lab-vp-h"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={defaultViewport.height || ''}
              onChange={(event) => {
                const height = Number(event.target.value)
                setSessions((prev) => ({
                  ...prev,
                  viewportPolicy: {
                    ...prev.viewportPolicy,
                    default: {
                      ...prev.viewportPolicy.default,
                      height: Number.isFinite(height) ? height : 0,
                    },
                  },
                }))
              }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div>
          <p className="text-xs font-medium">Journal (test / debug only)</p>
          <p className="text-[11px] text-muted-foreground">
            Opt-in facts stay off until you enable them. Expensive for real traffic — never
            on by default.
          </p>
        </div>
        {LAB_JOURNAL_TYPES.map((type) => (
          <div key={type} className="flex items-center justify-between gap-3">
            <Label htmlFor={`lab-journal-${type}`} className="font-mono text-[11px]">
              {type}
            </Label>
            <Switch
              id={`lab-journal-${type}`}
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
