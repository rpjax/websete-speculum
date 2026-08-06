/**
 * Lab-compatible aliases — canonical catalog lives under Admin configurations
 * (`/api/configurations/Telemetry` is the only write path).
 */
export {
  TELEMETRY_SESSION_EVENT_TYPES as LAB_TELEMETRY_EVENT_TYPES,
  TELEMETRY_SESSION_EVENT_GROUPS as LAB_TELEMETRY_EVENT_GROUPS,
  TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES as LAB_TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES,
  TELEMETRY_DOM_PROJECTION_INPUT_PATH_TYPES as LAB_TELEMETRY_DOM_PROJECTION_INPUT_PATH_TYPES,
  emptyTelemetrySessionEvents as emptyLabTelemetryEvents,
  createTelemetrySessionEventsBaseline as createLabTelemetryEventsBaseline,
  type TelemetrySessionEventType as LabTelemetryEventType,
  type TelemetrySessionEventGroup as LabTelemetryEventGroup,
  type TelemetrySessionEventGroupId as LabTelemetryEventGroupId,
  type TelemetrySessionEventDef as LabTelemetryEventDef,
} from '@/features/admin/configurations/telemetrySessionEventsCatalog'
