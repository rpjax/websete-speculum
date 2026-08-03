import { useState, type ReactNode } from 'react'
import { Activity, Gauge, Layers, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  DataCard,
  FieldGrid,
  GuidedPreset,
  HelperCallout,
  InlineValidation,
  RevealPanel,
  StatCard,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import {
  INTERVAL_PRESETS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  TELEMETRY_PRESETS,
  TELEMETRY_SECTIONS,
  applyTelemetryPreset,
  asObject,
  clampIntervalSeconds,
  describeSectionDetail,
  samplesPerHour,
  sectionEnabled,
  setAllSections,
  summarizeTelemetry,
  type JsonObject,
  type TelemetrySectionKey,
} from './telemetryHelpers'

function Field({
  id,
  label,
  helper,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  placeholder,
  error,
  disabled,
}: {
  id: string
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
  type?: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
  error?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      <InlineValidation message={error} />
    </div>
  )
}

function SectionCard({
  sectionKey,
  label,
  helper,
  detail,
  enabled,
  samplerOn,
  onToggle,
  children,
}: {
  sectionKey: TelemetrySectionKey
  label: string
  helper: string
  detail: string
  enabled: boolean
  samplerOn: boolean
  onToggle: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <li
      className={`rounded-lg border border-border bg-background/40 p-3 transition-opacity ${
        samplerOn ? '' : 'opacity-55'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{helper}</p>
          <p className="mt-1 text-xs text-foreground/80">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor={`telemetry-section-${sectionKey}`} className="text-xs text-muted-foreground">
            {enabled ? 'On' : 'Off'}
          </Label>
          <Switch
            id={`telemetry-section-${sectionKey}`}
            checked={enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
      {enabled ? <div className="mt-3 border-t border-border/70 pt-3">{children}</div> : null}
    </li>
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
  const summary = summarizeTelemetry(value)
  const samplerOn = summary.enabled
  const [draftEvent, setDraftEvent] = useState('')
  const events =
    value.events && typeof value.events === 'object' && !Array.isArray(value.events)
      ? (value.events as Record<string, boolean>)
      : {}
  const eventEntries = Object.entries(events)

  const patchSection = (key: TelemetrySectionKey, patch: JsonObject) => {
    replace({ ...value, [key]: { ...asObject(value[key]), ...patch } })
  }

  const setEvent = (key: string, enabled: boolean) => {
    replace({ ...value, events: { ...events, [key]: enabled } })
  }

  const removeEvent = (key: string) => {
    const next = { ...events }
    delete next[key]
    replace({ ...value, events: next })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={samplerOn ? 'Sampler on' : 'Sampler off'}
          tone={samplerOn ? 'success' : 'warning'}
        />
        <StatusPill
          label={`Cadence · ${summary.intervalSeconds}s`}
          tone={samplerOn ? 'info' : 'neutral'}
        />
        <StatusPill
          label={`Sections · ${summary.activeSectionCount}/${summary.totalSections}`}
          tone={summary.activeSectionCount ? 'success' : 'warning'}
        />
        {summary.eventOptIns ? (
          <StatusPill label={`Event facts · ${summary.eventOptIns}`} tone="info" />
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Sampler"
          value={samplerOn ? 'Collecting' : 'Idle'}
          icon={<Radio className="h-4 w-4" />}
          sub={samplerOn ? 'Telemetry.SampleCollected composites' : 'No compose work while off'}
          tone={samplerOn ? 'success' : 'warning'}
        />
        <StatCard
          label="Cadence"
          value={`${summary.intervalSeconds}s`}
          icon={<Gauge className="h-4 w-4" />}
          sub={`~${summary.samplesPerHour.toLocaleString()} samples / hour`}
        />
        <StatCard
          label="Active sections"
          value={`${summary.activeSectionCount}/${summary.totalSections}`}
          icon={<Layers className="h-4 w-4" />}
          sub={
            summary.activeSectionLabels.length
              ? summary.activeSectionLabels.slice(0, 3).join(', ') +
                (summary.activeSectionLabels.length > 3 ? '…' : '')
              : 'None selected'
          }
          tone={summary.activeSectionCount ? 'default' : 'warning'}
        />
      </div>

      <DataCard className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-medium">Sampler presets</h3>
          <p className="text-xs text-muted-foreground">
            Apply a starting posture. Section detail toggles stay editable afterward. Opt-in event facts are
            preserved.
          </p>
        </div>
        <GuidedPreset
          presets={TELEMETRY_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
            apply: () => replace(applyTelemetryPreset(value, preset)),
          }))}
        />
        <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          {TELEMETRY_PRESETS.map((preset) => (
            <li key={preset.id} className="rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="font-medium text-foreground">{preset.label}</p>
              <p className="mt-0.5">{preset.description}</p>
            </li>
          ))}
        </ul>
      </DataCard>

      <section className="space-y-4">
        <SwitchField
          id="telemetry-enabled"
          label="Enable telemetry sampler"
          helper="Master switch. Off = no composite samples; section preferences are kept for when you turn it back on."
          checked={samplerOn}
          onCheckedChange={(checked) => update(['isEnabled'], checked)}
        />

        <div className={samplerOn ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-55'}>
          <div>
            <h3 className="text-sm font-medium">Sample interval</h3>
            <p className="text-xs text-muted-foreground">
              Cadence for Telemetry.SampleCollected. Clamped to {MIN_INTERVAL_SECONDS}–{MAX_INTERVAL_SECONDS}s.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {INTERVAL_PRESETS.map((preset) => (
              <Button
                key={preset.seconds}
                type="button"
                size="sm"
                variant={summary.intervalSeconds === preset.seconds ? 'default' : 'outline'}
                onClick={() => update(['intervalSeconds'], preset.seconds)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Field
            id="intervalSeconds"
            label="Custom interval (seconds)"
            type="number"
            min={MIN_INTERVAL_SECONDS}
            max={MAX_INTERVAL_SECONDS}
            value={String(summary.intervalSeconds)}
            helper={`~${samplesPerHour(clampIntervalSeconds(summary.intervalSeconds)).toLocaleString()} samples / hour.`}
            onChange={(v) => update(['intervalSeconds'], clampIntervalSeconds(v))}
          />
        </div>
      </section>

      {!samplerOn ? (
        <HelperCallout tone="warning" title="Sampler is off">
          Section toggles below still save, but nothing is composed until you enable the sampler. Prefer a preset
          when turning it on.
        </HelperCallout>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Sample sections</h3>
            <p className="text-xs text-muted-foreground">
              Each section is one slice of the composite sample. Expand an enabled section for field-level includes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => replace(setAllSections(value, true))}>
              Enable all
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => replace(setAllSections(value, false))}>
              Disable all
            </Button>
          </div>
        </div>

        <ul className="space-y-2">
          {TELEMETRY_SECTIONS.map((section) => {
            const enabled = sectionEnabled(value, section.key)
            const child = asObject(value[section.key])
            return (
              <SectionCard
                key={section.key}
                sectionKey={section.key}
                label={section.label}
                helper={section.helper}
                detail={describeSectionDetail(value, section.key)}
                enabled={enabled}
                samplerOn={samplerOn}
                onToggle={(checked) => patchSection(section.key, { isEnabled: checked })}
              >
                {section.key === 'host' ? (
                  <div className="space-y-3">
                    <FieldGrid>
                      <Field
                        id="host-proc-path"
                        label="Proc path"
                        helper="e.g. /proc or dockup /host/proc"
                        value={typeof child.procPath === 'string' ? child.procPath : '/proc'}
                        onChange={(v) => patchSection('host', { procPath: v })}
                      />
                      <Field
                        id="host-disk-path"
                        label="Disk path (optional)"
                        helper="Empty = auto (content root)."
                        value={typeof child.diskPath === 'string' ? child.diskPath : ''}
                        onChange={(v) => patchSection('host', { diskPath: v || null })}
                      />
                      <Field
                        id="host-sample-interval"
                        label="Collector cache (ms)"
                        type="number"
                        min={100}
                        max={60_000}
                        value={String(typeof child.sampleIntervalMs === 'number' ? child.sampleIntervalMs : 1000)}
                        onChange={(v) => patchSection('host', { sampleIntervalMs: Number(v) || 1000 })}
                      />
                    </FieldGrid>
                    <SwitchField
                      id="host-load"
                      label="Include load average"
                      checked={child.includeLoadAverage !== false}
                      onCheckedChange={(checked) => patchSection('host', { includeLoadAverage: checked })}
                    />
                    <SwitchField
                      id="host-swap"
                      label="Include swap"
                      checked={child.includeSwap !== false}
                      onCheckedChange={(checked) => patchSection('host', { includeSwap: checked })}
                    />
                    <SwitchField
                      id="host-disk-io"
                      label="Include disk I/O"
                      checked={Boolean(child.includeDiskIo)}
                      onCheckedChange={(checked) => patchSection('host', { includeDiskIo: checked })}
                    />
                    <SwitchField
                      id="host-network"
                      label="Include network"
                      checked={Boolean(child.includeNetwork)}
                      onCheckedChange={(checked) => patchSection('host', { includeNetwork: checked })}
                    />
                  </div>
                ) : null}

                {section.key === 'apiProcess' ? (
                  <div className="space-y-3">
                    <Field
                      id="api-sample-interval"
                      label="Collector cache (ms)"
                      type="number"
                      min={100}
                      max={60_000}
                      value={String(typeof child.sampleIntervalMs === 'number' ? child.sampleIntervalMs : 1000)}
                      onChange={(v) => patchSection('apiProcess', { sampleIntervalMs: Number(v) || 1000 })}
                    />
                    <SwitchField
                      id="api-memory"
                      label="Include private memory"
                      checked={child.includePrivateMemory !== false}
                      onCheckedChange={(checked) => patchSection('apiProcess', { includePrivateMemory: checked })}
                    />
                    <SwitchField
                      id="api-gc"
                      label="Include garbage collection"
                      checked={child.includeGarbageCollection !== false}
                      onCheckedChange={(checked) =>
                        patchSection('apiProcess', { includeGarbageCollection: checked })
                      }
                    />
                    <SwitchField
                      id="api-thread-pool"
                      label="Include thread pool"
                      checked={child.includeThreadPool !== false}
                      onCheckedChange={(checked) => patchSection('apiProcess', { includeThreadPool: checked })}
                    />
                  </div>
                ) : null}

                {section.key === 'sessions' ? (
                  <div className="space-y-3">
                    <HelperCallout title="Identity is opt-in">
                      Session ids and URL hosts increase usefulness and sensitivity. Prefer aggregate-only in
                      shared production hosts unless you need per-session rows.
                    </HelperCallout>
                    <SwitchField
                      id="sessions-ids"
                      label="Include session ids"
                      checked={Boolean(child.includeSessionIds)}
                      onCheckedChange={(checked) => patchSection('sessions', { includeSessionIds: checked })}
                    />
                    <SwitchField
                      id="sessions-url-host"
                      label="Include URL host"
                      checked={Boolean(child.includeUrlHost)}
                      onCheckedChange={(checked) => patchSection('sessions', { includeUrlHost: checked })}
                    />
                    <SwitchField
                      id="sessions-per-session"
                      label="Include per-session rows"
                      helper="Heavier samples — useful in lab / assertive postures."
                      checked={Boolean(child.includePerSession)}
                      onCheckedChange={(checked) => patchSection('sessions', { includePerSession: checked })}
                    />
                  </div>
                ) : null}

                {section.key === 'sidecar' ? (
                  <div className="space-y-3">
                    <Field
                      id="sidecar-timeout"
                      label="Collect timeout (ms)"
                      type="number"
                      min={100}
                      value={String(typeof child.timeoutMs === 'number' ? child.timeoutMs : 2000)}
                      onChange={(v) => patchSection('sidecar', { timeoutMs: Number(v) || 2000 })}
                    />
                    <SwitchField
                      id="sidecar-process"
                      label="Include process"
                      checked={child.includeProcess !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeProcess: checked })}
                    />
                    <SwitchField
                      id="sidecar-event-loop"
                      label="Include event loop"
                      checked={child.includeEventLoop !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeEventLoop: checked })}
                    />
                    <SwitchField
                      id="sidecar-chrome"
                      label="Include Chrome"
                      checked={child.includeChrome !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeChrome: checked })}
                    />
                    <SwitchField
                      id="sidecar-queues"
                      label="Include queues"
                      checked={child.includeQueues !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeQueues: checked })}
                    />
                    <SwitchField
                      id="sidecar-sessions-summary"
                      label="Include sessions summary"
                      checked={child.includeSessionsSummary !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeSessionsSummary: checked })}
                    />
                    <SwitchField
                      id="sidecar-faulted"
                      label="Include faulted ids"
                      checked={child.includeFaultedIds !== false}
                      onCheckedChange={(checked) => patchSection('sidecar', { includeFaultedIds: checked })}
                    />
                    <SwitchField
                      id="sidecar-alloc-summary"
                      label="Include allocations summary"
                      checked={child.includeAllocationsSummary !== false}
                      onCheckedChange={(checked) =>
                        patchSection('sidecar', { includeAllocationsSummary: checked })
                      }
                    />
                    <SwitchField
                      id="sidecar-alloc-sessions"
                      label="Include allocation sessions"
                      helper="Heavier — off in lean/operable defaults."
                      checked={Boolean(child.includeAllocationSessions)}
                      onCheckedChange={(checked) =>
                        patchSection('sidecar', { includeAllocationSessions: checked })
                      }
                    />
                  </div>
                ) : null}

                {section.key === 'profiles' ? (
                  <SwitchField
                    id="profiles-storage"
                    label="Include storage bytes"
                    checked={child.includeStorageBytes !== false}
                    onCheckedChange={(checked) => patchSection('profiles', { includeStorageBytes: checked })}
                  />
                ) : null}

                {section.key === 'journal' ? (
                  <SwitchField
                    id="journal-pressure"
                    label="Include pressure"
                    checked={child.includePressure !== false}
                    onCheckedChange={(checked) => patchSection('journal', { includePressure: checked })}
                  />
                ) : null}

                {section.key === 'docker' ? (
                  <div className="space-y-3">
                    <Field
                      id="docker-endpoint"
                      label="Docker endpoint"
                      helper="Engine API endpoint."
                      value={
                        typeof child.endpoint === 'string'
                          ? child.endpoint
                          : 'unix:///var/run/docker.sock'
                      }
                      onChange={(v) => patchSection('docker', { endpoint: v })}
                    />
                    <Field
                      id="docker-timeout"
                      label="HTTP timeout (ms)"
                      type="number"
                      min={100}
                      value={String(typeof child.timeoutMs === 'number' ? child.timeoutMs : 2000)}
                      onChange={(v) => patchSection('docker', { timeoutMs: Number(v) || 2000 })}
                    />
                    <SwitchField
                      id="docker-runtime"
                      label="Include runtime"
                      checked={child.includeRuntime !== false}
                      onCheckedChange={(checked) => patchSection('docker', { includeRuntime: checked })}
                    />
                    <SwitchField
                      id="docker-containers"
                      label="Include containers"
                      checked={child.includeContainers !== false}
                      onCheckedChange={(checked) => patchSection('docker', { includeContainers: checked })}
                    />
                  </div>
                ) : null}
              </SectionCard>
            )
          })}
        </ul>
      </section>

      <RevealPanel title="Opt-in Telemetry event facts">
        <div className="space-y-3">
          <HelperCallout title="Separate from sampling">
            These are catalogued Telemetry <span className="font-medium text-foreground">event</span> facts
            written to the Journal when enabled — not slices of SampleCollected. Omitted keys stay off.
          </HelperCallout>
          {eventEntries.length ? (
            <DataCard>
              <ul className="divide-y divide-border">
                {eventEntries.map(([key, enabled]) => (
                  <li key={key} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate font-mono text-xs">{key}</span>
                    <div className="flex items-center gap-2">
                      <SwitchField
                        id={`telemetry-event-${key}`}
                        label="On"
                        checked={Boolean(enabled)}
                        onCheckedChange={(checked) => setEvent(key, checked)}
                      />
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeEvent(key)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </DataCard>
          ) : (
            <p className="text-sm text-muted-foreground">No opt-in Telemetry event facts configured.</p>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              const key = draftEvent.trim()
              if (!key || events[key]) return
              setEvent(key, true)
              setDraftEvent('')
            }}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="telemetry-event-draft">Fact type</Label>
              <Input
                id="telemetry-event-draft"
                className="font-mono text-xs"
                placeholder="Telemetry.Sessions.Input.WebTransportReceived"
                value={draftEvent}
                onChange={(event) => setDraftEvent(event.target.value)}
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Enable fact
            </Button>
          </form>
        </div>
      </RevealPanel>

      <HelperCallout
        title="Inspect live samples"
        action={{ label: 'Open Telemetry monitor', href: '/w7s/admin/diagnostics/telemetry' }}
      >
        After save, composites land in the Journal. Use the monitor to chart SampleCollected without leaving Admin.
      </HelperCallout>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>
          Diagnostics capability toggles are separate — this page only configures the Telemetry sampler section.
        </span>
      </div>
    </div>
  )
}
