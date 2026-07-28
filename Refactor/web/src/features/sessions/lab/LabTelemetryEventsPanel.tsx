import { Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { loadLabInputPathClientTrace } from '@/features/sessions/live/sessionConfig'
import {
  LAB_TELEMETRY_EVENT_GROUPS,
  LAB_TELEMETRY_EVENT_TYPES,
  LAB_TELEMETRY_INPUT_PATH_TYPES,
  emptyLabTelemetryEvents,
  type LabTelemetryEventType,
} from './labTelemetryEvents'

interface LabTelemetryEventsPanelProps {
  events: Record<LabTelemetryEventType, boolean>
  busy: boolean
  onChange: (next: Record<LabTelemetryEventType, boolean>) => void
  /** Persist immediately (Trace / turn-off presets). */
  onApply: (next: Record<LabTelemetryEventType, boolean>) => void
}

function countOn(events: Record<LabTelemetryEventType, boolean>): number {
  return LAB_TELEMETRY_EVENT_TYPES.filter((type) => events[type]).length
}

/**
 * Opt-in Telemetry.Sessions.* event toggles — full catalog, grouped by job.
 */
export function LabTelemetryEventsPanel({
  events,
  busy,
  onChange,
  onApply,
}: LabTelemetryEventsPanelProps) {
  const onCount = countOn(events)
  const inputPathOn = LAB_TELEMETRY_INPUT_PATH_TYPES.some((type) => events[type])
  const hotOn = LAB_TELEMETRY_EVENT_GROUPS.some((group) =>
    group.events.some((def) => def.hotPath && events[def.type]),
  )

  const setType = (type: LabTelemetryEventType, checked: boolean) => {
    onChange({ ...events, [type]: checked })
  }

  const setGroup = (types: LabTelemetryEventType[], checked: boolean) => {
    const next = { ...events }
    for (const type of types) {
      next[type] = checked
    }
    onChange(next)
  }

  const enableAll = () => {
    const next = emptyLabTelemetryEvents()
    for (const type of LAB_TELEMETRY_EVENT_TYPES) {
      next[type] = true
    }
    onChange(next)
  }

  const disableAll = () => {
    onChange(emptyLabTelemetryEvents())
  }

  const traceInputPath = () => {
    const next = { ...events }
    for (const type of LAB_TELEMETRY_INPUT_PATH_TYPES) {
      next[type] = true
    }
    onChange(next)
    onApply(next)
  }

  const turnOffHotPath = () => {
    const next = { ...events }
    for (const group of LAB_TELEMETRY_EVENT_GROUPS) {
      for (const def of group.events) {
        if (def.hotPath) {
          next[def.type] = false
        }
      }
    }
    onChange(next)
    onApply(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{onCount}</span>
          {' / '}
          {LAB_TELEMETRY_EVENT_TYPES.length} event probes on. Sampling facts are under Sampling —
          not here. Pair input path with Wire <code>client_sent</code>.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={enableAll}>
            All on
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={disableAll}>
            All off
          </Button>
        </div>
      </div>

      {hotOn && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <p className="font-medium">
            Hot-path telemetry is on — use only while diagnosing delay or a dead input stream.
          </p>
          {inputPathOn && !loadLabInputPathClientTrace() && (
            <p className="mt-1 text-warning/90">
              Wire <code className="text-foreground">client_sent</code> is still off — enable hop 0
              on the Wire tab.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={turnOffHotPath}
          >
            Turn off hot path &amp; apply
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {LAB_TELEMETRY_EVENT_GROUPS.map((group) => {
          const types = group.events.map((e) => e.type)
          const groupOn = types.filter((t) => events[t]).length
          const allOn = groupOn === types.length
          const noneOn = groupOn === 0

          return (
            <section
              key={group.id}
              className="rounded-md border border-border bg-card/40 px-3 py-3"
            >
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h4 className="text-sm font-medium text-foreground">{group.title}</h4>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {groupOn}/{types.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{group.blurb}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {group.id === 'input-path' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={traceInputPath}
                    >
                      <Route className="h-3.5 w-3.5" />
                      Trace path
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || allOn}
                    onClick={() => setGroup(types, true)}
                  >
                    On
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || noneOn}
                    onClick={() => setGroup(types, false)}
                  >
                    Off
                  </Button>
                </div>
              </div>

              <ul className="space-y-2.5 border-t border-border/60 pt-2.5">
                {group.events.map((def) => (
                  <li key={def.type} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Label
                        htmlFor={`lab-tel-ev-${def.type}`}
                        className="text-xs font-medium leading-snug"
                      >
                        {def.label}
                        {def.hotPath ? (
                          <span className="ml-1.5 text-[10px] font-normal text-warning">hot</span>
                        ) : null}
                      </Label>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {def.help}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                        {def.type}
                      </p>
                    </div>
                    <Switch
                      id={`lab-tel-ev-${def.type}`}
                      className="mt-0.5 shrink-0"
                      checked={events[def.type]}
                      onCheckedChange={(checked) => setType(def.type, checked)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
