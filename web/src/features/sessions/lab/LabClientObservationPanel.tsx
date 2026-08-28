import {
  TelemetryClientObservationFields,
  type TelemetryClientObservationValue,
} from '@/features/admin/configurations/TelemetryClientObservationFields'
import type { LabTelemetryClientObservationConfig, LabTelemetryConfig } from './labEngineConfig'

interface LabClientObservationPanelProps {
  telemetry: LabTelemetryConfig
  onChange: (next: LabTelemetryConfig) => void
}

/**
 * Lab shortcut — same ClientObservation fields as Admin Telemetry;
 * persists via `/api/configurations` (Telemetry.clientObservation).
 */
export function LabClientObservationPanel({
  telemetry,
  onChange,
}: LabClientObservationPanelProps) {
  return (
    <TelemetryClientObservationFields
      idPrefix="lab-client-obs"
      value={telemetry.clientObservation as TelemetryClientObservationValue}
      onChange={(next) =>
        onChange({
          ...telemetry,
          clientObservation: next as LabTelemetryClientObservationConfig,
        })
      }
    />
  )
}
