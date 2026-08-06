/**
 * Catalog of opt-in Telemetry.events (Admin + Lab). Persisted only via /api/configurations/Telemetry (Telemetry.Sessions.*).
 * Sampling facts (SampleCollected / SessionSampleCollected) are gated by the
 * sampler master + sections — not this map.
 *
 * VideoStreamingInput and DomProjection each own distinct fact types — do not reuse.
 */

export const TELEMETRY_SESSION_EVENT_TYPES = [
  'Telemetry.Sessions.Capacity.SlotAcquired',
  'Telemetry.Sessions.Capacity.SlotReleased',
  'Telemetry.Sessions.Capacity.NoSlotAvailable',
  'Telemetry.Sessions.Start.UrlResolved',
  'Telemetry.Sessions.Start.UrlResolveFailed',
  'Telemetry.Sessions.Navigate.UrlResolved',
  'Telemetry.Sessions.VideoStreamingInput.ControlReceived',
  'Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived',
  'Telemetry.Sessions.VideoStreamingInput.SidecarPushWritten',
  'Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted',
  'Telemetry.Sessions.VideoStreamingInput.Applied',
  'Telemetry.Sessions.VideoStreamingInput.Rejected',
  'Telemetry.Sessions.DomProjection.Diff.FrameReceived',
  'Telemetry.Sessions.DomProjection.Diff.GenerationBumped',
  'Telemetry.Sessions.DomProjection.Input.DataPlaneReceived',
  'Telemetry.Sessions.DomProjection.Input.AdmissionDropped',
  'Telemetry.Sessions.DomProjection.Input.SidecarPushWritten',
  'Telemetry.Sessions.DomProjection.Input.SidecarAdmitted',
  'Telemetry.Sessions.DomProjection.Input.CdpDropped',
  'Telemetry.Sessions.DomProjection.Input.Applied',
  'Telemetry.Sessions.DomProjection.Input.Rejected',
  'Telemetry.Sessions.Resize.Applied',
  'Telemetry.Sessions.Resize.Rejected',
  'Telemetry.Sessions.Browse.LocationChanged',
  'Telemetry.Sessions.Persist.SkippedNoConnection',
  'Telemetry.Sessions.Persist.SkippedProfileNotFound',
  'Telemetry.Sessions.Client.AttachedCommandFailed',
  'Telemetry.Sessions.Sidecar.SessionAllocated',
  'Telemetry.Sessions.Sidecar.SessionReleased',
  'Telemetry.Sessions.Sidecar.DisplayAllocated',
  'Telemetry.Sessions.Sidecar.DisplayReleased',
  'Telemetry.Sessions.Sidecar.AllocationFaulted',
] as const

export type TelemetrySessionEventType = (typeof TELEMETRY_SESSION_EVENT_TYPES)[number]

export type TelemetrySessionEventGroupId =
  | 'video-streaming-input-path'
  | 'video-streaming-input-outcomes'
  | 'dom-projection-diff'
  | 'dom-projection-input-path'
  | 'dom-projection-input-outcomes'
  | 'resize'
  | 'capacity'
  | 'start-navigate'
  | 'browse'
  | 'persist'
  | 'client'
  | 'sidecar-alloc'

export interface TelemetrySessionEventDef {
  type: TelemetrySessionEventType
  /** Short operator label (catalog Name). */
  label: string
  /** One-line why / when. */
  help: string
  /** Expensive on hot path — warn when on. */
  hotPath?: boolean
}

export interface TelemetrySessionEventGroup {
  id: TelemetrySessionEventGroupId
  title: string
  blurb: string
  events: TelemetrySessionEventDef[]
}

/** Ordered groups for Admin Telemetry + Lab shortcut. */
export const TELEMETRY_SESSION_EVENT_GROUPS: TelemetrySessionEventGroup[] = [
  {
    id: 'video-streaming-input-path',
    title: 'Video input path',
    blurb: 'Client click → sidecar hops.',
    events: [
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.ControlReceived',
        label: 'Hop 1 · Control received',
        help: 'Input admitted outside the normal data plane (harness/admin).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived',
        label: 'Hop 1 · Data-plane received',
        help: 'Input arrived on the product data plane.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.SidecarPushWritten',
        label: 'Hop 2 · Sidecar push written',
        help: 'API pushed the input to the sidecar stream.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted',
        label: 'Hop 3 · Sidecar admitted',
        help: 'Sidecar accepted the input into the browser session.',
        hotPath: true,
      },
    ],
  },
  {
    id: 'video-streaming-input-outcomes',
    title: 'Video input outcomes',
    blurb: 'Applied or rejected after the path.',
    events: [
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.Applied',
        label: 'Input applied',
        help: 'Input accepted and handed to the sidecar.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.VideoStreamingInput.Rejected',
        label: 'Input rejected',
        help: 'Input rejected before or while pushing to the sidecar.',
      },
    ],
  },
  {
    id: 'dom-projection-diff',
    title: 'DOM diff',
    blurb: 'Diff frames from sidecar to client.',
    events: [
      {
        type: 'Telemetry.Sessions.DomProjection.Diff.FrameReceived',
        label: 'Diff frame received',
        help: 'API received a DOM diff frame from the sidecar.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Diff.GenerationBumped',
        label: 'Generation bumped',
        help: 'Sidecar Dom Projection generation changed (main_frame_navigated or page_emit_sync).',
        hotPath: true,
      },
    ],
  },
  {
    id: 'dom-projection-input-path',
    title: 'DOM input path',
    blurb: 'Element input hops (not video).',
    events: [
      {
        type: 'Telemetry.Sessions.DomProjection.Input.DataPlaneReceived',
        label: 'Hop 1 · Data-plane received',
        help: 'DOM input arrived on the data plane.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Input.AdmissionDropped',
        label: 'Hop · Admission dropped',
        help: 'DOM input evicted from the API DropOldest admission queue before push.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Input.SidecarPushWritten',
        label: 'Hop 2 · Sidecar push written',
        help: 'API wrote DOM input on PushDomInput (gRPC).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Input.SidecarAdmitted',
        label: 'Hop 3 · Sidecar admitted',
        help: 'Sidecar completed CDP dispatch successfully.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Input.CdpDropped',
        label: 'Hop · CDP dropped',
        help: 'Sidecar dropped the intent (generation_stale, ignored_wire_click, anchor_missing, invalid_coords, cdp_error, …).',
        hotPath: true,
      },
    ],
  },
  {
    id: 'dom-projection-input-outcomes',
    title: 'DOM input outcomes',
    blurb: 'Applied or rejected for DOM input.',
    events: [
      {
        type: 'Telemetry.Sessions.DomProjection.Input.Applied',
        label: 'Input applied (gRPC push)',
        help: 'DOM input accepted on the API→sidecar PushDomInput write — not CDP dispatch.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.DomProjection.Input.Rejected',
        label: 'Input rejected',
        help: 'DOM input rejected before or while pushing to the sidecar.',
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
    blurb: 'Live session slot reserve, release, or full.',
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
        help: 'Start rejected — no live session slot left.',
      },
    ],
  },
  {
    id: 'start-navigate',
    title: 'Start & navigate',
    blurb: 'URL resolve on start and navigate.',
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
        help: 'Runtime navigate resolved to a target URL.',
      },
    ],
  },
  {
    id: 'browse',
    title: 'Browse',
    blurb: 'Main-frame location changes — can be noisy.',
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
    blurb: 'State export skipped (no connection or missing profile).',
    events: [
      {
        type: 'Telemetry.Sessions.Persist.SkippedNoConnection',
        label: 'Skipped · no connection',
        help: 'State export skipped — connection already gone.',
      },
      {
        type: 'Telemetry.Sessions.Persist.SkippedProfileNotFound',
        label: 'Skipped · profile missing',
        help: 'State export skipped — profile was missing.',
      },
    ],
  },
  {
    id: 'client',
    title: 'Attached client',
    blurb: 'Failures pushing commands to an attached browser client.',
    events: [
      {
        type: 'Telemetry.Sessions.Client.AttachedCommandFailed',
        label: 'Attached command failed',
        help: 'Pushing a command to the attached browser client failed.',
      },
    ],
  },
  {
    id: 'sidecar-alloc',
    title: 'Sidecar allocations',
    blurb: 'Session and display allocate, release, and faults.',
    events: [
      {
        type: 'Telemetry.Sessions.Sidecar.SessionAllocated',
        label: 'Session allocated',
        help: 'Sidecar registered a browser session.',
      },
      {
        type: 'Telemetry.Sessions.Sidecar.SessionReleased',
        label: 'Session released',
        help: 'Sidecar disposed a browser session.',
      },
      {
        type: 'Telemetry.Sessions.Sidecar.DisplayAllocated',
        label: 'Display allocated',
        help: 'Sidecar started an X display for a session.',
      },
      {
        type: 'Telemetry.Sessions.Sidecar.DisplayReleased',
        label: 'Display released',
        help: 'Sidecar tore down an X display for a session.',
      },
      {
        type: 'Telemetry.Sessions.Sidecar.AllocationFaulted',
        label: 'Allocation faulted',
        help: 'Sidecar failed to allocate session or display resources.',
      },
    ],
  },
]

const VIDEO_STREAMING_INPUT_PATH_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'video-streaming-input-path',
)!.events.map((e) => e.type)

const DOM_PROJECTION_INPUT_PATH_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'dom-projection-input-path',
)!.events.map((e) => e.type)

/** Server hops for VideoStreamingInput path tracing (pair with Activity client_sent). */
export const TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES = VIDEO_STREAMING_INPUT_PATH_TYPES

/** Server hops for DomProjectionInput path tracing. */
export const TELEMETRY_DOM_PROJECTION_INPUT_PATH_TYPES = DOM_PROJECTION_INPUT_PATH_TYPES

export function emptyTelemetrySessionEvents(): Record<TelemetrySessionEventType, boolean> {
  const next = {} as Record<TelemetrySessionEventType, boolean>
  for (const type of TELEMETRY_SESSION_EVENT_TYPES) {
    next[type] = false
  }
  return next
}

export function createTelemetrySessionEventsBaseline(): Record<TelemetrySessionEventType, boolean> {
  return emptyTelemetrySessionEvents()
}
