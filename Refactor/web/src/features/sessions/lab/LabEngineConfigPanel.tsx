import { useEffect, useState } from 'react'
import { Rocket, Save } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LAB_TELEMETRY_EVENT_TYPES,
  createLabReadyNavigation,
  createLabResourceManagementBaseline,
  createLabSessionsBaseline,
  createLabTelemetryBaseline,
  emptyLabTelemetryEvents,
  fetchLabEngineConfig,
  formatAllowlistLines,
  formatHostingDomainLines,
  parseAllowlistLines,
  parseHostingDomainLines,
  putLabEngineConfig,
  type LabConfigStatus,
  type LabEngineConfig,
  type LabTelemetryEventType,
  type LabResourceManagementConfig,
  type LabSessionsConfig,
  type LabTelemetryConfig,
} from './labEngineConfig'
import { LabSessionReadinessPanel } from './LabSessionReadinessPanel'
import { LabTelemetryEventsPanel } from './LabTelemetryEventsPanel'
import { LabTelemetrySamplingPanel } from './LabTelemetrySamplingPanel'

interface LabEngineConfigPanelProps {
  hubOrigin: string
  /** Live sessions keep the sidecar allowlist from Start — warn the operator. */
  sessionLive: boolean
}

/**
 * Lab Config tab: readiness (Start) · Telemetry sampling · Telemetry event probes.
 * Composes focused panels — full Telemetry.Sessions.* catalog lives in Events.
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
  /** Maps to Telemetry.events on save. */
  const [journal, setJournal] = useState<Record<LabTelemetryEventType, boolean>>(
    emptyLabTelemetryEvents,
  )
  /** Unknown Telemetry.events keys preserved (API replaces events wholesale). */
  const [eventExtras, setEventExtras] = useState<Record<string, boolean>>({})
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
    const nextJournal = emptyLabTelemetryEvents()
    const extras: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(config.journal ?? {})) {
      if ((LAB_TELEMETRY_EVENT_TYPES as readonly string[]).includes(key)) {
        nextJournal[key as LabTelemetryEventType] = Boolean(value)
      } else {
        extras[key] = Boolean(value)
      }
    }
    setJournal(nextJournal)
    setEventExtras(extras)
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
      journal: Record<LabTelemetryEventType, boolean>
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
        ...eventExtras,
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
  const canSave = Boolean(defaultTargetHost.trim())
  const eventsOn = LAB_TELEMETRY_EVENT_TYPES.filter((type) => journal[type]).length

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={operational ? 'success' : 'warning'}>
            {operational ? 'Ready for sessions' : 'Setup required'}
          </Badge>
          {telemetry.isEnabled ? (
            <Badge variant="muted">Sampling on</Badge>
          ) : (
            <Badge variant="muted">Sampling off</Badge>
          )}
          <Badge variant={eventsOn > 0 ? 'warning' : 'muted'}>
            {eventsOn}/{LAB_TELEMETRY_EVENT_TYPES.length} events
          </Badge>
          {savedAt ? (
            <span className="text-[11px] text-muted-foreground">Last applied {savedAt}</span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Readiness unblocks Start. Sampling writes composite resource facts. Events are opt-in
          Act→Assert probes — leave off while casually browsing.
        </p>
      </div>

      <Accordion
        type="multiple"
        defaultValue={operational ? ['events'] : ['readiness']}
        className="w-full"
      >
        <AccordionItem value="readiness">
          <AccordionTrigger className="text-sm">
            <span className="flex flex-wrap items-center gap-2">
              Session readiness
              <Badge variant={operational ? 'success' : 'warning'} className="font-normal">
                {operational ? 'ready' : 'needed'}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <LabSessionReadinessPanel
              operational={operational}
              missing={missing}
              busy={busy}
              sessionLive={sessionLive}
              defaultTargetHost={defaultTargetHost}
              allowAny={allowAny}
              allowlistText={allowlistText}
              hostingText={hostingText}
              certificateEmail={certificateEmail}
              sessions={sessions}
              resourceManagement={resourceManagement}
              onDefaultTargetHostChange={setDefaultTargetHost}
              onAllowAnyChange={setAllowAny}
              onAllowlistTextChange={setAllowlistText}
              onHostingTextChange={setHostingText}
              onCertificateEmailChange={setCertificateEmail}
              onSessionsChange={setSessions}
              onResourceManagementChange={setResourceManagement}
              onApplyLabDefaults={applyLabDefaultsAndSave}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sampling">
          <AccordionTrigger className="text-sm">
            <span className="flex flex-wrap items-center gap-2">
              Telemetry · Sampling
              <Badge variant="muted" className="font-normal">
                {telemetry.isEnabled ? `${telemetry.intervalSeconds}s` : 'off'}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <LabTelemetrySamplingPanel telemetry={telemetry} onChange={setTelemetry} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="events">
          <AccordionTrigger className="text-sm">
            <span className="flex flex-wrap items-center gap-2">
              Telemetry · Events
              <Badge variant={eventsOn > 0 ? 'warning' : 'muted'} className="font-normal">
                {eventsOn}/{LAB_TELEMETRY_EVENT_TYPES.length}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <LabTelemetryEventsPanel
              events={journal}
              busy={busy}
              onChange={setJournal}
              onApply={(next) => {
                setJournal(next)
                void persist(buildBody({ journal: next }))
              }}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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
