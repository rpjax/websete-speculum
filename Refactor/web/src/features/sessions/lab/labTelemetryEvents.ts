/**
 * Lab catalog of opt-in Telemetry.events (Telemetry.Sessions.*).
 * Sampling facts (SampleCollected / SessionSampleCollected) are gated by the
 * sampler master + sections — not this map.
 */

export const LAB_TELEMETRY_EVENT_TYPES = [
  'Telemetry.Sessions.Capacity.SlotAcquired',
  'Telemetry.Sessions.Capacity.SlotReleased',
  'Telemetry.Sessions.Capacity.NoSlotAvailable',
  'Telemetry.Sessions.Start.UrlResolved',
  'Telemetry.Sessions.Start.UrlResolveFailed',
  'Telemetry.Sessions.Navigate.UrlResolved',
  'Telemetry.Sessions.Input.ControlReceived',
  'Telemetry.Sessions.Input.WebTransportReceived',
  'Telemetry.Sessions.Input.SidecarPushWritten',
  'Telemetry.Sessions.Input.SidecarAdmitted',
  'Telemetry.Sessions.Input.Applied',
  'Telemetry.Sessions.Input.Rejected',
  'Telemetry.Sessions.Resize.Applied',
  'Telemetry.Sessions.Resize.Rejected',
  'Telemetry.Sessions.Browse.LocationChanged',
  'Telemetry.Sessions.Persist.SkippedNoConnection',
  'Telemetry.Sessions.Persist.SkippedProfileNotFound',
  'Telemetry.Sessions.Client.AttachedCommandFailed',
] as const

export type LabTelemetryEventType = (typeof LAB_TELEMETRY_EVENT_TYPES)[number]

export type LabTelemetryEventGroupId =
  | 'input-path'
  | 'input-outcomes'
  | 'resize'
  | 'capacity'
  | 'start-navigate'
  | 'browse'
  | 'persist'
  | 'client'

export interface LabTelemetryEventDef {
  type: LabTelemetryEventType
  /** Short operator label (catalog Name). */
  label: string
  /** One-line why / when. */
  help: string
  /** Expensive on hot path — warn when on. */
  hotPath?: boolean
}

export interface LabTelemetryEventGroup {
  id: LabTelemetryEventGroupId
  title: string
  blurb: string
  events: LabTelemetryEventDef[]
}

/** Ordered groups for the Lab Events editor. */
export const LAB_TELEMETRY_EVENT_GROUPS: LabTelemetryEventGroup[] = [
  {
    id: 'input-path',
    title: 'Input path',
    blurb: 'Server hops after Wire client_sent. Hot path — enable only while diagnosing delay.',
    events: [
      {
        type: 'Telemetry.Sessions.Input.ControlReceived',
        label: 'Hop 1 · Control received',
        help: 'User input admitted on SignalR (product path).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.Input.WebTransportReceived',
        label: 'Hop 1b · WebTransport received',
        help: 'Optional late WT UserInput pipe (lab/debug). Not the product path.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.Input.SidecarPushWritten',
        label: 'Hop 2 · Sidecar push written',
        help: 'API wrote the event on the PushInput client stream.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.Input.SidecarAdmitted',
        label: 'Hop 3 · Sidecar admitted',
        help: 'Sidecar admitted the event into the browser session.',
        hotPath: true,
      },
    ],
  },
  {
    id: 'input-outcomes',
    title: 'Input outcomes',
    blurb: 'Applied / Rejected after the path. Prefer off while casually typing.',
    events: [
      {
        type: 'Telemetry.Sessions.Input.Applied',
        label: 'Input applied',
        help: 'Input accepted and pushed toward the sidecar.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.Input.Rejected',
        label: 'Input rejected',
        help: 'Input rejected before or while pushing to the sidecar.',
      },
    ],
  },
  {
    id: 'resize',
    title: 'Resize',
    blurb: 'Viewport resize applied or rejected.',
    events: [
      {
        type: 'Telemetry.Sessions.Resize.Applied',
        label: 'Resize applied',
        help: 'Session viewport resize was applied.',
      },
      {
        type: 'Telemetry.Sessions.Resize.Rejected',
        label: 'Resize rejected',
        help: 'Session viewport resize was rejected.',
      },
    ],
  },
  {
    id: 'capacity',
    title: 'Capacity',
    blurb: 'Live session slot reserve / release / exhaustion.',
    events: [
      {
        type: 'Telemetry.Sessions.Capacity.SlotAcquired',
        label: 'Slot acquired',
        help: 'A live session slot was reserved.',
      },
      {
        type: 'Telemetry.Sessions.Capacity.SlotReleased',
        label: 'Slot released',
        help: 'A live session slot was released.',
      },
      {
        type: 'Telemetry.Sessions.Capacity.NoSlotAvailable',
        label: 'No slot available',
        help: 'Start rejected — no live session slot available.',
      },
    ],
  },
  {
    id: 'start-navigate',
    title: 'Start & navigate',
    blurb: 'URL resolve on StartSession and runtime Navigate.',
    events: [
      {
        type: 'Telemetry.Sessions.Start.UrlResolved',
        label: 'Start URL resolved',
        help: 'Target URL resolved during session start.',
      },
      {
        type: 'Telemetry.Sessions.Start.UrlResolveFailed',
        label: 'Start URL resolve failed',
        help: 'Target URL resolution failed during session start.',
      },
      {
        type: 'Telemetry.Sessions.Navigate.UrlResolved',
        label: 'Navigate URL resolved',
        help: 'Runtime navigate path/query resolved to a target URL.',
      },
    ],
  },
  {
    id: 'browse',
    title: 'Browse',
    blurb: 'Main-frame location changes — high churn.',
    events: [
      {
        type: 'Telemetry.Sessions.Browse.LocationChanged',
        label: 'Location changed',
        help: 'Browser main-frame location changed.',
        hotPath: true,
      },
    ],
  },
  {
    id: 'persist',
    title: 'Persist',
    blurb: 'State export skipped (connection gone / profile missing).',
    events: [
      {
        type: 'Telemetry.Sessions.Persist.SkippedNoConnection',
        label: 'Skipped · no connection',
        help: 'State export skipped — sidecar connection already gone.',
      },
      {
        type: 'Telemetry.Sessions.Persist.SkippedProfileNotFound',
        label: 'Skipped · profile missing',
        help: 'State export skipped — profile row was missing.',
      },
    ],
  },
  {
    id: 'client',
    title: 'Attached client',
    blurb: 'Hub → attached browser client command failures.',
    events: [
      {
        type: 'Telemetry.Sessions.Client.AttachedCommandFailed',
        label: 'Attached command failed',
        help: 'Pushing a command to the attached browser client failed.',
      },
    ],
  },
]

const INPUT_PATH_TYPES = LAB_TELEMETRY_EVENT_GROUPS.find((g) => g.id === 'input-path')!.events.map(
  (e) => e.type,
)

export const LAB_TELEMETRY_INPUT_PATH_TYPES = INPUT_PATH_TYPES

export function emptyLabTelemetryEvents(): Record<LabTelemetryEventType, boolean> {
  const next = {} as Record<LabTelemetryEventType, boolean>
  for (const type of LAB_TELEMETRY_EVENT_TYPES) {
    next[type] = false
  }
  return next
}

export function createLabTelemetryEventsBaseline(): Record<LabTelemetryEventType, boolean> {
  return emptyLabTelemetryEvents()
}
