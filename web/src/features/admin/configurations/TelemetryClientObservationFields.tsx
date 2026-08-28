import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Wire shape of Telemetry.ClientObservation (engine section). */
export interface TelemetryClientObservationValue {
  isEnabled: boolean
  sessionWire: boolean
  videoStreamingInput: boolean
  pageProjectionFrame: boolean
  pageProjectionIntent: boolean
}

export const EMPTY_TELEMETRY_CLIENT_OBSERVATION: TelemetryClientObservationValue = {
  isEnabled: false,
  sessionWire: true,
  videoStreamingInput: false,
  pageProjectionFrame: false,
  pageProjectionIntent: false,
}

export function normalizeClientObservation(raw: unknown): TelemetryClientObservationValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_TELEMETRY_CLIENT_OBSERVATION }
  }
  const o = raw as Record<string, unknown>
  return {
    isEnabled: o.isEnabled === true,
    sessionWire: o.sessionWire !== false,
    videoStreamingInput: o.videoStreamingInput === true,
    pageProjectionFrame: o.pageProjectionFrame === true,
    pageProjectionIntent: o.pageProjectionIntent === true,
  }
}

const PLANES = [
  {
    key: 'sessionWire' as const,
    label: 'Session wire',
    help: 'Connect, start/stop, URL sync, notifications.',
  },
  {
    key: 'videoStreamingInput' as const,
    label: 'Video input',
    help: 'Mouse/keyboard on the screencast path.',
  },
  {
    key: 'pageProjectionFrame' as const,
    label: 'PageProjection Frame',
    help: 'Frames received, applied, desync/resync, arm.',
  },
  {
    key: 'pageProjectionIntent' as const,
    label: 'PageProjection Intent',
    help: 'Clicks and typing on the PageProjection path.',
  },
]

interface TelemetryClientObservationFieldsProps {
  value: TelemetryClientObservationValue
  onChange: (next: TelemetryClientObservationValue) => void
  /** Prefix for control ids (admin vs lab). */
  idPrefix?: string
  /**
   * When embedded under Events (Admin), skip the outer status line —
   * parent already summarizes open/closed.
   */
  compact?: boolean
}

/**
 * Telemetry.ClientObservation — browser overlay planes (Live/Lab).
 * Not Journal facts; operators pair planes with Telemetry.Events for correlation.
 */
export function TelemetryClientObservationFields({
  value,
  onChange,
  idPrefix = 'telemetry-client-obs',
  compact = false,
}: TelemetryClientObservationFieldsProps) {
  const patch = (partial: Partial<TelemetryClientObservationValue>) => {
    onChange({ ...value, ...partial })
  }

  const planesOn = PLANES.filter((plane) => value[plane.key]).length

  return (
    <div className="space-y-3">
      {!compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {value.isEnabled ? (
              <>
                <span className="font-medium text-foreground">{planesOn}</span>
                {' of '}
                {PLANES.length} planes on
              </>
            ) : (
              'Off — no Live/Lab overlay.'
            )}
          </p>
        </div>
      ) : null}

      <ul
        className={cn(
          'overflow-hidden divide-y divide-border',
          compact ? 'rounded-lg border border-border/70' : 'rounded-xl border border-border',
        )}
      >
        <li className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-master`} className="text-sm font-medium text-foreground">
              Show client ring
            </Label>
            <p className="text-xs text-muted-foreground">
              Live/Lab overlay only — not Journal facts. Refresh the session after save.
            </p>
          </div>
          <Switch
            id={`${idPrefix}-master`}
            className="shrink-0"
            checked={value.isEnabled}
            onCheckedChange={(checked) => patch({ isEnabled: checked })}
          />
        </li>

        {PLANES.map((row) => (
          <li
            key={row.key}
            className={cn(
              'flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:pl-14',
              !value.isEnabled && 'pointer-events-none opacity-45',
            )}
          >
            <div className="min-w-0">
              <Label
                htmlFor={`${idPrefix}-${row.key}`}
                className="block text-sm text-foreground"
              >
                {row.label}
              </Label>
              <p className="text-xs text-muted-foreground">{row.help}</p>
            </div>
            <Switch
              id={`${idPrefix}-${row.key}`}
              className="shrink-0"
              checked={value[row.key]}
              disabled={!value.isEnabled}
              onCheckedChange={(checked) => patch({ [row.key]: checked })}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
