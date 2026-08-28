import {
  TelemetrySessionEventsFields,
  type TelemetrySessionEventsMap,
} from '@/features/admin/configurations/TelemetrySessionEventsFields'
import type { LabTelemetryEventType } from './labTelemetryEvents'

interface LabTelemetryEventsPanelProps {
  events: Record<LabTelemetryEventType, boolean>
  busy: boolean
  onChange: (next: Record<LabTelemetryEventType, boolean>) => void
  onApply: (next: Record<LabTelemetryEventType, boolean>) => void
}

/**
 * Lab shortcut — same fields as Admin Telemetry; persists via
 * `/api/configurations` batch (Telemetry.events).
 */
export function LabTelemetryEventsPanel({
  events,
  busy,
  onChange,
  onApply,
}: LabTelemetryEventsPanelProps) {
  return (
    <TelemetrySessionEventsFields
      events={events as TelemetrySessionEventsMap}
      busy={busy}
      idPrefix="lab-tel-ev"
      onChange={(next) => onChange(next as Record<LabTelemetryEventType, boolean>)}
      onApply={(next) => onApply(next as Record<LabTelemetryEventType, boolean>)}
    />
  )
}
