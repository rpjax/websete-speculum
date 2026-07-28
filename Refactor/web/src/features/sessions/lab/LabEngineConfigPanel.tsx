import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Rocket, Save } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  LAB_CONFIG_SECTION_LABELS,
  LAB_JOURNAL_TYPES,
  createLabReadyNavigation,
  createLabResourceManagementBaseline,
  createLabSessionsBaseline,
  createLabTelemetryBaseline,
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
  type LabTelemetryConfig,
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

function sectionLabel(key: string): string {
  return LAB_CONFIG_SECTION_LABELS[key] ?? key
}

const JOURNAL_HELP: Record<LabJournalType, string> = {
  'Sessions.InputApplied': 'Record successful clicks / keys',
  'Sessions.InputRejected': 'Record blocked or failed input',
  'Sessions.ResizeApplied': 'Record successful viewport resizes',
  'Sessions.ResizeRejected': 'Record rejected resizes',
}

/**
 * Lab facilitator to complete mandatory engine config and unblock StartSession.
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
  const [telemetry, setTelemetry] = useState<LabTelemetryConfig>(createLabTelemetryBaseline())
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
    setTelemetry(config.telemetry)
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

  const buildBody = (
    overrides?: Partial<{
      defaultTargetHost: string
      allowAny: boolean
      allowlistText: string
      sessions: LabSessionsConfig
      resourceManagement: LabResourceManagementConfig
      journal: Record<LabJournalType, boolean>
      telemetry: LabTelemetryConfig
    }>,
  ): LabEngineConfig => {
    const host = (overrides?.defaultTargetHost ?? defaultTargetHost).trim()
    const openAllow = overrides?.allowAny ?? allowAny
    const listText = overrides?.allowlistText ?? allowlistText
    const nextSessions = overrides?.sessions ?? sessions
    const nextRm = overrides?.resourceManagement ?? resourceManagement
    const nextJournal = overrides?.journal ?? journal
    const nextTelemetry = overrides?.telemetry ?? telemetry

    return {
      hosting: {
        defaultCertificateEmail: certificateEmail.trim(),
        domains: parseHostingDomainLines(hostingText, hostingDomains),
      },
      navigation: {
        defaultTargetHost: host,
        allowedMainFrameUrls: parseAllowlistLines(listText, openAllow, navigationRules),
      },
      sessions: nextSessions,
      resourceManagement: nextRm,
      telemetry: nextTelemetry,
      journal: {
        ...journalAll,
        ...nextJournal,
      },
    }
  }

  const persist = async (body: LabEngineConfig) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await putLabEngineConfig(body, hubOrigin)
      applySnapshot(saved)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () => void persist(buildBody())

  /** One click: fill mandatory lab snapshot + save so StartSession can proceed. */
  const applyLabDefaultsAndSave = () => {
    const navigation = createLabReadyNavigation(defaultTargetHost || 'www.google.com')
    const nextSessions = createLabSessionsBaseline()
    const nextRm = {
      ...createLabResourceManagementBaseline(),
      profiles: resourceManagement.profiles,
      diagnostics: resourceManagement.diagnostics,
    }

    setDefaultTargetHost(navigation.defaultTargetHost)
    setAllowAny(true)
    setAllowlistText('')
    setNavigationRules(navigation.allowedMainFrameUrls)
    setSessions(nextSessions)
    setResourceManagement(nextRm)

    void persist(
      buildBody({
        defaultTargetHost: navigation.defaultTargetHost,
        allowAny: true,
        allowlistText: '',
        sessions: nextSessions,
        resourceManagement: nextRm,
      }),
    )
  }

  if (available === null) {
    return <p className="text-xs text-muted-foreground">Loading configuration…</p>
  }

  if (!available) {
    return (
      <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Configuration API unreachable</p>
        <p>
          Confirm the API is up and, if auth bypass is off, that this origin can send{' '}
          <code className="text-foreground">Authorization: Bearer</code> for{' '}
          <code className="text-foreground">SPECULUM_API_AUTH_TOKEN</code>.
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    )
  }

  const missing = status?.missing ?? []
  const operational = Boolean(status?.operational)
  const defaultViewport = sessions.viewportPolicy.default
  const canSave = Boolean(defaultTargetHost.trim())

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={operational ? 'success' : 'warning'}>
            {operational ? 'Ready for sessions' : 'Setup required'}
          </Badge>
          {savedAt ? (
            <span className="text-[11px] text-muted-foreground">Last applied {savedAt}</span>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Speculum will not start a browsing session until these settings are applied. Use lab
          defaults to finish in one step, or edit the sections below and save.
        </p>

        {!operational && (
          <div className="space-y-3 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-medium text-warning">Still needed before Start</p>
            <ul className="space-y-1.5">
              {(['Navigation', 'Sessions', 'ResourceManagement'] as const).map((key) => {
                const done = !missing.includes(key)
                return (
                  <li key={key} className="flex items-start gap-2 text-xs">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    )}
                    <span className={done ? 'text-muted-foreground' : 'text-foreground'}>
                      {sectionLabel(key)}
                    </span>
                  </li>
                )
              })}
            </ul>
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={applyLabDefaultsAndSave}
            >
              <Rocket className="h-3.5 w-3.5" />
              Apply lab defaults &amp; save
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Sets browse-anywhere on your default host (or www.google.com), session capacity,
              and 1280×720 viewport — then applies. Journal probes stay off (they add input lag).
            </p>
          </div>
        )}

        {operational && (
          <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            Mandatory settings are applied. You can still tighten the allowlist or capacity below.
          </div>
        )}

        {sessionLive && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            A session is already live. Allowlist changes affect URL resolve immediately; the
            browser main-frame guard updates only after you stop and start again.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Where sessions may browse</h3>
            <p className="text-[11px] text-muted-foreground">
              Default site when a session starts, plus which hosts the remote browser is allowed
              to open as the main page.
            </p>
          </div>

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
            <p className="text-[11px] text-muted-foreground">
              Hostname only — no <code>https://</code> or path.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="lab-allow-any">Allow any website</Label>
              <p className="text-[11px] text-muted-foreground">
                Open lab mode — any main-frame host is allowed. Turn off to restrict.
              </p>
            </div>
            <Switch id="lab-allow-any" checked={allowAny} onCheckedChange={setAllowAny} />
          </div>

          {!allowAny && (
            <div className="space-y-2">
              <Label htmlFor="lab-allowlist">Allowed hosts (one per line)</Label>
              <Textarea
                id="lab-allowlist"
                className="min-h-[96px] font-mono text-xs"
                value={allowlistText}
                spellCheck={false}
                placeholder={'www.google.com\n*.example.com'}
                onChange={(event) => setAllowlistText(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Exact host or <code>*.apex.com</code> for subdomains. Include your default host.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-md border border-border p-3">
          <div>
            <h3 className="text-sm font-medium">Capacity &amp; viewport</h3>
            <p className="text-[11px] text-muted-foreground">
              How many sessions can run and the default remote screen size.
            </p>
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
              <Label htmlFor="lab-vp-w">Viewport width</Label>
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
              <Label htmlFor="lab-vp-h">Viewport height</Label>
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
        </section>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="hosting">
            <AccordionTrigger className="text-sm">
              Public session domains (optional)
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Domains Speculum presents to users (certificates / mirroring). Leave empty for
                plain lab browsing through the default target host.
              </p>
              <div className="space-y-2">
                <Label htmlFor="lab-hosting">Domains (one per line)</Label>
                <Textarea
                  id="lab-hosting"
                  className="min-h-[72px] font-mono text-xs"
                  value={hostingText}
                  spellCheck={false}
                  placeholder={'lab.example.com\nlab.example.com +mirror'}
                  onChange={(event) => setHostingText(event.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Append <code>+mirror</code> to mirror subdomains for that entry.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lab-cert-email">Certificate contact email</Label>
                <Input
                  id="lab-cert-email"
                  className="font-mono text-xs"
                  value={certificateEmail}
                  spellCheck={false}
                  placeholder="optional"
                  onChange={(event) => setCertificateEmail(event.target.value)}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="telemetry">
            <AccordionTrigger className="text-sm">Telemetry (resource samples)</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Periodic host / API / sessions / sidecar snapshots written as{' '}
                <code className="text-foreground">Telemetry.SampleCollected</code> Journal facts.
                Apply here enables those facts — no separate Journal toggle.
              </p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="lab-telemetry-enabled">Enable telemetry</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Master switch for the sampler and composite Journal fact.
                  </p>
                </div>
                <Switch
                  id="lab-telemetry-enabled"
                  checked={telemetry.isEnabled}
                  onCheckedChange={(checked) =>
                    setTelemetry((prev) => ({ ...prev, isEnabled: checked }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lab-telemetry-interval">Sample interval (seconds)</Label>
                <Input
                  id="lab-telemetry-interval"
                  type="number"
                  min={1}
                  max={3600}
                  className="font-mono text-xs"
                  disabled={!telemetry.isEnabled}
                  value={telemetry.intervalSeconds || ''}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setTelemetry((prev) => ({
                      ...prev,
                      intervalSeconds: Number.isFinite(value) ? value : prev.intervalSeconds,
                    }))
                  }}
                />
              </div>
              {(
                [
                  ['host', 'Host (machine)'],
                  ['apiProcess', 'API process'],
                  ['sessions', 'Live sessions'],
                  ['sidecar', 'Sidecar'],
                  ['profiles', 'Profiles'],
                  ['journal', 'Journal pressure'],
                  ['docker', 'Docker'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`lab-telemetry-${key}`} className="text-xs">
                    {label}
                  </Label>
                  <Switch
                    id={`lab-telemetry-${key}`}
                    disabled={!telemetry.isEnabled}
                    checked={telemetry[key].isEnabled}
                    onCheckedChange={(checked) =>
                      setTelemetry((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], isEnabled: checked },
                      }))
                    }
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                <div>
                  <Label htmlFor="lab-telemetry-per-session">Per-session samples</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Extra <code>Telemetry.SessionSampleCollected</code> per live session — more RPC
                    load.
                  </p>
                </div>
                <Switch
                  id="lab-telemetry-per-session"
                  disabled={!telemetry.isEnabled || !telemetry.sessions.isEnabled}
                  checked={telemetry.sessions.includePerSession ?? false}
                  onCheckedChange={(checked) =>
                    setTelemetry((prev) => ({
                      ...prev,
                      sessions: { ...prev.sessions, includePerSession: checked },
                    }))
                  }
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="journal">
            <AccordionTrigger className="text-sm">
              Lab journal probes (debug)
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Opt-in session facts for Act→Assert. Leave off while browsing — especially
                Input applied, which records every click/key and slows the input path.
              </p>
              {journal['Sessions.InputApplied'] && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <p className="font-medium">Input applied is on — expect input lag.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => {
                      const next = { ...journal, 'Sessions.InputApplied': false }
                      setJournal(next)
                      void persist(buildBody({ journal: next }))
                    }}
                  >
                    Turn off &amp; apply
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="lab-journal-all">Enable all lab probes</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Turns on the four Sessions.* trails below. Prefer off while typing.
                  </p>
                </div>
                <Switch
                  id="lab-journal-all"
                  checked={LAB_JOURNAL_TYPES.every((type) => journal[type])}
                  onCheckedChange={(checked) => {
                    const next = emptyJournal()
                    for (const type of LAB_JOURNAL_TYPES) {
                      next[type] = checked
                    }
                    setJournal(next)
                  }}
                />
              </div>
              {LAB_JOURNAL_TYPES.map((type) => (
                <div key={type} className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor={`lab-journal-${type}`} className="text-xs">
                      {JOURNAL_HELP[type]}
                    </Label>
                    <p className="font-mono text-[10px] text-muted-foreground">{type}</p>
                  </div>
                  <Switch
                    id={`lab-journal-${type}`}
                    checked={journal[type]}
                    onCheckedChange={(checked) =>
                      setJournal((prev) => ({ ...prev, [type]: checked }))
                    }
                  />
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background pt-3">
        <Button size="sm" disabled={busy || !canSave} onClick={save}>
          <Save className="h-3.5 w-3.5" />
          Save &amp; apply
        </Button>
        {!operational && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={applyLabDefaultsAndSave}
          >
            <Rocket className="h-3.5 w-3.5" />
            Lab defaults
          </Button>
        )}
        {!canSave && (
          <span className="text-[11px] text-muted-foreground">Set a default target host to save.</span>
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
