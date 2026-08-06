import { useState } from 'react'
import { ChevronDown, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  TELEMETRY_SESSION_EVENT_GROUPS,
  TELEMETRY_SESSION_EVENT_TYPES,
  TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES,
  emptyTelemetrySessionEvents,
  type TelemetrySessionEventGroup,
  type TelemetrySessionEventType,
} from './telemetrySessionEventsCatalog'

export type TelemetrySessionEventsMap = Record<TelemetrySessionEventType, boolean>

interface TelemetrySessionEventsFieldsProps {
  events: TelemetrySessionEventsMap
  busy?: boolean
  onChange: (next: TelemetrySessionEventsMap) => void
  /**
   * Optional immediate persist (Lab shortcut). Admin uses section Save instead —
   * when omitted, Trace / Turn off only update the draft via onChange.
   */
  onApply?: (next: TelemetrySessionEventsMap) => void
  idPrefix?: string
}

function countOn(events: TelemetrySessionEventsMap): number {
  return TELEMETRY_SESSION_EVENT_TYPES.filter((type) => events[type]).length
}

function groupStats(group: TelemetrySessionEventGroup, events: TelemetrySessionEventsMap) {
  const types = group.events.map((e) => e.type)
  const on = types.filter((t) => events[t]).length
  const hotOn = group.events.some((def) => def.hotPath && events[def.type])
  return {
    types,
    on,
    total: types.length,
    allOn: on === types.length,
    noneOn: on === 0,
    hotOn,
  }
}

/**
 * Dedicated per-fact toggles for Telemetry.Events (Journal Telemetry facts).
 * Canonical in Admin Configurations → Telemetry; Lab may embed as a shortcut
 * that still PUTs `/api/configurations` (same section family).
 */
export function TelemetrySessionEventsFields({
  events,
  busy = false,
  onChange,
  onApply,
  idPrefix = 'telemetry-ev',
}: TelemetrySessionEventsFieldsProps) {
  const [openGroups, setOpenGroups] = useState<Partial<Record<string, boolean>>>({})
  const onCount = countOn(events)
  const hotOn = TELEMETRY_SESSION_EVENT_GROUPS.some((group) =>
    group.events.some((def) => def.hotPath && events[def.type]),
  )

  const setType = (type: TelemetrySessionEventType, checked: boolean) => {
    onChange({ ...events, [type]: checked })
  }

  const setGroup = (types: TelemetrySessionEventType[], checked: boolean) => {
    const next = { ...events }
    for (const type of types) {
      next[type] = checked
    }
    onChange(next)
  }

  const disableAll = () => {
    onChange(emptyTelemetrySessionEvents())
  }

  const applyOrChange = (next: TelemetrySessionEventsMap) => {
    onChange(next)
    onApply?.(next)
  }

  const traceVideoStreamingInputPath = () => {
    const next = { ...events }
    for (const type of TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES) {
      next[type] = true
    }
    applyOrChange(next)
    setOpenGroups((prev) => ({ ...prev, 'video-streaming-input-path': true }))
  }

  const turnOffHotPath = () => {
    const next = { ...events }
    for (const group of TELEMETRY_SESSION_EVENT_GROUPS) {
      for (const def of group.events) {
        if (def.hotPath) {
          next[def.type] = false
        }
      }
    }
    applyOrChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {onCount === 0 ? (
            'None on — good default.'
          ) : (
            <>
              <span className="font-medium text-foreground">{onCount}</span>
              {' of '}
              {TELEMETRY_SESSION_EVENT_TYPES.length} on
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={traceVideoStreamingInputPath}
          >
            <Route className="h-3.5 w-3.5" aria-hidden />
            Trace video path
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || onCount === 0}
            onClick={disableAll}
          >
            Clear all
          </Button>
        </div>
      </div>

      {hotOn ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
          <p className="text-xs text-warning">Heavy debug events are on.</p>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={turnOffHotPath}>
            Turn off
            {onApply ? ' & apply' : ''}
          </Button>
        </div>
      ) : null}

      <ul className="overflow-hidden rounded-xl border border-border divide-y divide-border">
        {TELEMETRY_SESSION_EVENT_GROUPS.map((group) => {
          const stats = groupStats(group, events)
          const open = Boolean(openGroups[group.id])
          const groupSwitchId = `${idPrefix}-group-${group.id}`

          return (
            <li key={group.id}>
              <div className="flex items-stretch">
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 sm:px-4">
                  <Switch
                    id={groupSwitchId}
                    checked={!stats.noneOn}
                    disabled={busy}
                    onCheckedChange={(checked) => setGroup(stats.types, checked)}
                    aria-label={
                      stats.noneOn ? `Enable ${group.title}` : `Disable ${group.title}`
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={groupSwitchId}
                      className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-foreground"
                    >
                      {group.title}
                      <span className="text-xs font-normal text-muted-foreground">
                        {stats.on}/{stats.total}
                      </span>
                      {stats.hotOn ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-normal text-warning">
                          heavy
                        </span>
                      ) : null}
                    </label>
                    <p className="truncate text-xs text-muted-foreground">{group.blurb}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={cn(
                    'flex shrink-0 items-center gap-1 border-l border-border px-3 text-xs font-medium',
                    'text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  )}
                  aria-expanded={open}
                  onClick={() =>
                    setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                  }
                >
                  {open ? 'Hide' : 'Facts'}
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </button>
              </div>

              {open ? (
                <ul className="space-y-0 border-t border-border/70 bg-muted/10">
                  {group.events.map((def) => (
                    <li
                      key={def.type}
                      className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 sm:px-4 sm:pl-14"
                    >
                      <div className="min-w-0">
                        <label
                          htmlFor={`${idPrefix}-${def.type}`}
                          className="block text-sm text-foreground"
                          title={def.type}
                        >
                          {def.label}
                          {def.hotPath ? (
                            <span className="ml-1.5 text-[10px] text-warning">heavy</span>
                          ) : null}
                        </label>
                        <p className="text-xs text-muted-foreground">{def.help}</p>
                      </div>
                      <Switch
                        id={`${idPrefix}-${def.type}`}
                        className="shrink-0"
                        checked={events[def.type]}
                        disabled={busy}
                        onCheckedChange={(checked) => setType(def.type, checked)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Merge stored Telemetry.events onto the catalog baseline (unknown keys preserved separately). */
export function mergeTelemetrySessionEvents(
  stored: Record<string, boolean> | undefined,
): { catalog: TelemetrySessionEventsMap; extras: Record<string, boolean> } {
  const catalog = emptyTelemetrySessionEvents()
  const extras: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(stored ?? {})) {
    if ((TELEMETRY_SESSION_EVENT_TYPES as readonly string[]).includes(key)) {
      catalog[key as TelemetrySessionEventType] = Boolean(value)
    } else {
      extras[key] = Boolean(value)
    }
  }
  return { catalog, extras }
}

export function flattenTelemetrySessionEvents(
  catalog: TelemetrySessionEventsMap,
  extras: Record<string, boolean> = {},
): Record<string, boolean> {
  return { ...extras, ...catalog }
}
