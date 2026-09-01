import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleOff,
  ExternalLink,
  Gauge,
  Radar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  INTERVAL_PRESETS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  TELEMETRY_PRESETS,
  applyTelemetryPreset,
  asObject,
  clampIntervalSeconds,
  matchTelemetryPreset,
  samplesPerHour,
  summarizeTelemetry,
  type JsonObject,
  type TelemetrySamplerPresetId,
  type TelemetrySectionKey,
} from './telemetryHelpers'
import {
  TelemetryClientObservationFields,
  normalizeClientObservation,
} from './TelemetryClientObservationFields'
import {
  TelemetrySessionEventsFields,
  flattenTelemetrySessionEvents,
  mergeTelemetrySessionEvents,
  type TelemetrySessionEventsMap,
} from './TelemetrySessionEventsFields'
import { TelemetrySamplerSectionFields } from './TelemetrySamplerSectionFields'
import { ConfigChip, ConfigChipRow, ConfigField } from './configFieldPrimitives'
import { HelperCallout } from '@/features/admin/components'

const MODE_ICONS = {
  off: CircleOff,
  lean: Gauge,
  operable: Radar,
  deep: Bug,
} as const

function TabHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function TabBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'info' }) {
  return (
    <span
      className={cn(
        'ml-1.5 rounded px-1.5 py-0.5 text-[10px]',
        tone === 'info' ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground',
      )}
    >
      {children}
    </span>
  )
}

export function TelemetryEditor({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const [showCustomInterval, setShowCustomInterval] = useState(() => {
    const seconds = clampIntervalSeconds(value.intervalSeconds ?? 30)
    return !INTERVAL_PRESETS.some((preset) => preset.seconds === seconds)
  })
  const [customizeOpen, setCustomizeOpen] = useState(
    () => matchTelemetryPreset(value) === 'custom',
  )
  const [clientRingOpen, setClientRingOpen] = useState(false)

  const summary = summarizeTelemetry(value)
  const matchedMode = matchTelemetryPreset(value)
  const activeMode =
    matchedMode !== 'custom'
      ? TELEMETRY_PRESETS.find((preset) => preset.id === matchedMode) ?? null
      : null
  const samplerOn = summary.enabled

  const eventsRaw =
    value.events && typeof value.events === 'object' && !Array.isArray(value.events)
      ? (value.events as Record<string, boolean>)
      : {}
  const { catalog: sessionEvents, extras: eventExtras } = mergeTelemetrySessionEvents(eventsRaw)
  const clientObservation = normalizeClientObservation(value.clientObservation)

  const eventCount = summary.eventOptIns

  const applyMode = (id: TelemetrySamplerPresetId) => {
    const preset = TELEMETRY_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const next = applyTelemetryPreset(value, preset)
    const nextInterval = clampIntervalSeconds(next.intervalSeconds ?? value.intervalSeconds ?? 30)
    setShowCustomInterval(!INTERVAL_PRESETS.some((item) => item.seconds === nextInterval))
    setCustomizeOpen(false)
    replace(next)
  }

  const patchSection = (key: TelemetrySectionKey, patch: JsonObject) => {
    setCustomizeOpen(true)
    replace({ ...value, [key]: { ...asObject(value[key]), ...patch } })
  }

  const setSessionEvents = (next: TelemetrySessionEventsMap) => {
    replace({
      ...value,
      events: flattenTelemetrySessionEvents(next, eventExtras),
    })
  }

  const samplesStatus = useMemo(() => {
    if (!samplerOn) return 'Not collecting'
    if (activeMode) return `${activeMode.label} · every ${summary.intervalLabel}`
    return `Custom · every ${summary.intervalLabel}`
  }, [activeMode, samplerOn, summary.intervalLabel])

  const clientRingSummary = clientObservation.isEnabled
    ? [
        clientObservation.sessionWire && 'wire',
        clientObservation.videoStreamingInput && 'video',
        clientObservation.pageProjectionFrame && 'page frame',
        clientObservation.pageProjectionIntent && 'page intent',
      ]
        .filter(Boolean)
        .join(' · ') || 'on · no planes'
    : 'off'

  return (
    <div className="space-y-5">
      <Tabs defaultValue="samples" className="space-y-5">
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="samples">Samples</TabsTrigger>
          <TabsTrigger value="events">
            Events
            {eventCount > 0 ? <TabBadge>{eventCount}</TabBadge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="samples" className="space-y-4">
          <TabHeader
            title="Samples"
            body="Pick how closely Speculum watches this host. Save when ready."
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span
                className={cn(
                  'inline-flex h-2 w-2 shrink-0 rounded-full',
                  samplerOn ? 'bg-success' : 'bg-muted-foreground',
                )}
                aria-hidden
              />
              <span className="font-medium text-foreground">{samplesStatus}</span>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/w7s/admin/diagnostics/telemetry">
                See charts
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>

          <div role="radiogroup" aria-label="Sampling mode">
            <ul className="overflow-hidden rounded-xl border border-border divide-y divide-border">
              {TELEMETRY_PRESETS.map((preset) => {
                const selected = matchedMode === preset.id
                const Icon = MODE_ICONS[preset.id]
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => applyMode(preset.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors sm:px-4',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        selected ? 'bg-primary/10' : 'hover:bg-muted/20',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
                        )}
                      >
                        {selected ? <Check className="h-3 w-3" aria-hidden /> : null}
                      </span>
                      <span
                        className={cn(
                          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-medium text-foreground">{preset.label}</span>
                          <span className="text-xs text-muted-foreground">{preset.description}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {preset.effect}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {samplerOn ? (
            <ul className="overflow-hidden rounded-xl border border-border divide-y divide-border">
              <li>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-4',
                    'hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  )}
                  aria-expanded={customizeOpen}
                  onClick={() => setCustomizeOpen((open) => !open)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Customize</p>
                    <p className="text-xs text-muted-foreground">
                      Interval and sections
                      {matchedMode === 'custom' ? ' · currently custom' : ''}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    {customizeOpen ? 'Hide' : 'Open'}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        customizeOpen && 'rotate-180',
                      )}
                      aria-hidden
                    />
                  </span>
                </button>
              </li>

              {customizeOpen ? (
                <li className="space-y-5 bg-muted/10 px-3 py-4 sm:px-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">How often</h3>
                      <p className="text-xs text-muted-foreground">
                        Most hosts are fine at 30s–1 min.
                      </p>
                    </div>
                    <ConfigChipRow label="Sample interval">
                      {INTERVAL_PRESETS.map((preset) => (
                        <ConfigChip
                          key={preset.seconds}
                          active={!showCustomInterval && summary.intervalSeconds === preset.seconds}
                          label={preset.label}
                          onClick={() => {
                            setShowCustomInterval(false)
                            update(['intervalSeconds'], preset.seconds)
                          }}
                        />
                      ))}
                      <ConfigChip
                        active={showCustomInterval}
                        label="Custom"
                        onClick={() => setShowCustomInterval(true)}
                      />
                    </ConfigChipRow>
                    {showCustomInterval ? (
                      <ConfigField
                        id="intervalSeconds"
                        label="Seconds between samples"
                        type="number"
                        min={MIN_INTERVAL_SECONDS}
                        max={MAX_INTERVAL_SECONDS}
                        value={String(summary.intervalSeconds)}
                        helper={`About ${samplesPerHour(clampIntervalSeconds(summary.intervalSeconds)).toLocaleString()} / hour.`}
                        onChange={(v) => update(['intervalSeconds'], clampIntervalSeconds(v))}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        About {summary.samplesPerHour.toLocaleString()} samples per hour.
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="space-y-1">
                        <h3 className="text-sm font-medium">What goes in each sample</h3>
                        <p className="text-xs text-muted-foreground">
                          Flip a section, or open Tune for fields.
                        </p>
                      </div>
                    </div>
                    <TelemetrySamplerSectionFields
                      value={value}
                      samplerOn={samplerOn}
                      patchSection={patchSection}
                      onReplaceSections={(next) => {
                        setCustomizeOpen(true)
                        replace(next)
                      }}
                    />
                  </div>
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <CircleOff className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">Sampling is off</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose Lean for everyday hosts, or Operable for production.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" size="sm" onClick={() => applyMode('lean')}>
                  Use Lean
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyMode('operable')}
                >
                  Use Operable
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <TabHeader
            title="Events"
            body="Optional Journal facts for session investigation. Leave off unless you need them."
          />

          <TelemetrySessionEventsFields events={sessionEvents} onChange={setSessionEvents} />

          <ul className="overflow-hidden rounded-xl border border-border divide-y divide-border">
            <li>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-4',
                  'hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                )}
                aria-expanded={clientRingOpen}
                onClick={() => setClientRingOpen((open) => !open)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Client ring</p>
                  <p className="text-xs text-muted-foreground">
                    Live/Lab overlay planes · pairs with facts above · {clientRingSummary}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                  {clientRingOpen ? 'Hide' : 'Open'}
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      clientRingOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </span>
              </button>
            </li>
            {clientRingOpen ? (
              <li className="bg-muted/10 px-3 py-4 sm:px-4">
                <TelemetryClientObservationFields
                  value={clientObservation}
                  onChange={(next) => replace({ ...value, clientObservation: next })}
                  compact
                />
              </li>
            ) : null}
          </ul>

          {Object.keys(eventExtras).length > 0 ? (
            <HelperCallout tone="warning" title="Extra event keys kept">
              This host still has {Object.keys(eventExtras).length} key(s) outside the catalog.
            </HelperCallout>
          ) : null}
        </TabsContent>
      </Tabs>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Diagnostics capability toggles live under Diagnostics
        <ChevronRight className="h-3 w-3" aria-hidden />
        not on this page.
      </p>
    </div>
  )
}
