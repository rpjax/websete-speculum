/**
 * Catalog of opt-in Telemetry.events (Admin + Lab). Persisted only via /api/configurations/Telemetry (Telemetry.Sessions.*).
 * Sampling facts (SampleCollected / SessionSampleCollected) are gated by the
 * sampler master + sections — not this map.
 *
 * VideoStreamingInput and PageProjection each own distinct fact types — do not reuse.
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
  'Telemetry.Sessions.PageProjection.Diff.FrameReceived',
  'Telemetry.Sessions.PageProjection.Diff.GenerationBumped',
  'Telemetry.Sessions.PageProjection.Diff.SoftNavObserved',
  'Telemetry.Sessions.PageProjection.Diff.QueueDropped',
  'Telemetry.Sessions.PageProjection.Diff.OutputStreamOpened',
  'Telemetry.Sessions.PageProjection.Diff.OutputStreamClosed',
  'Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued',
  'Telemetry.Sessions.PageProjection.Diff.StreamDequeued',
  'Telemetry.Sessions.PageProjection.Diff.WireDelivered',
  'Telemetry.Sessions.PageProjection.Diff.ResyncRequested',
  'Telemetry.Sessions.PageProjection.Diff.ResyncServed',
  'Telemetry.Sessions.PageProjection.Input.DataPlaneReceived',
  'Telemetry.Sessions.PageProjection.Input.AdmissionDropped',
  'Telemetry.Sessions.PageProjection.Input.SidecarPushWritten',
  'Telemetry.Sessions.PageProjection.Input.SidecarAdmitted',
  'Telemetry.Sessions.PageProjection.Input.CdpDropped',
  'Telemetry.Sessions.PageProjection.Input.Applied',
  'Telemetry.Sessions.PageProjection.Input.Rejected',
  'Telemetry.Sessions.PageProjection.Input.ScrollEchoHit',
  'Telemetry.Sessions.PageProjection.Virtual.BootMarked',
  'Telemetry.Sessions.PageProjection.Virtual.NavCommit',
  'Telemetry.Sessions.PageProjection.Virtual.NavTiming',
  'Telemetry.Sessions.PageProjection.Virtual.ResourceSummary',
  'Telemetry.Sessions.PageProjection.Virtual.PageError',
  'Telemetry.Sessions.PageProjection.Virtual.Lifecycle',
  'Telemetry.Sessions.PageProjection.Establish.StylesWaitStarted',
  'Telemetry.Sessions.PageProjection.Establish.StylesWaitCompleted',
  'Telemetry.Sessions.PageProjection.Establish.DomMapStarted',
  'Telemetry.Sessions.PageProjection.Establish.DomMapCompleted',
  'Telemetry.Sessions.PageProjection.Establish.CssomInstallStarted',
  'Telemetry.Sessions.PageProjection.Establish.CssomInstallCompleted',
  'Telemetry.Sessions.PageProjection.Establish.FirstDiffEmitted',
  'Telemetry.Sessions.PageProjection.Establish.EstablishCompleted',
  'Telemetry.Sessions.PageProjection.Establish.EstablishFailed',
  'Telemetry.Sessions.PageProjection.Asset.RewriteSummary',
  'Telemetry.Sessions.PageProjection.Asset.FetchFinished',
  'Telemetry.Sessions.PageProjection.Asset.ServeMiss',
  'Telemetry.Sessions.PageProjection.Asset.ServeSlow',
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
  | 'page-projection-diff'
  | 'page-projection-input-path'
  | 'page-projection-input-outcomes'
  | 'page-projection-virtual'
  | 'page-projection-establish'
  | 'page-projection-asset'
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
    id: 'page-projection-diff',
    title: 'PageProjection Diff',
    blurb: 'Diff chronology: sidecar → API → client (opt-in full capture).',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.FrameReceived',
        label: 'Diff · frame received',
        help: 'API received a PageProjectionDiff frame from the sidecar (includes sheet/rule counts on install).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.QueueDropped',
        label: 'Diff · queue dropped',
        help: 'DropAll overflow on sidecar bridge or API sequenced channel (client will desync). Fan-out stages include StreamId/ConsumerId/Kind when known.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.OutputStreamOpened',
        label: 'Diff · output stream opened',
        help: 'Mux Open*Stream registered one outbound stream of a single kind (frame | pageProjectionDiff | console | notification) owned by a consumer.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.OutputStreamClosed',
        label: 'Diff · output stream closed',
        help: 'Mux output stream disposed / unregistered.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued',
        label: 'Diff · fan-out enqueued',
        help: 'API accepted the Diff into an open Diff fan-out channel (WaitMs, StreamId, ConsumerId, Kind, DiffChannelCount).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.StreamDequeued',
        label: 'Diff · stream dequeued',
        help: 'Hub Diff pump took the Diff from the fan-out channel before writing the data-plane stream (StreamId, ConsumerId).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.WireDelivered',
        label: 'Diff · wire delivered',
        help: 'API finished writing the Diff onto the client data-plane stream (DurationMs, StreamId, ConsumerId).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.GenerationBumped',
        label: 'Diff · generation bumped',
        help: 'Sidecar PageProjection generation changed (main_frame_navigated or page_emit_sync).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.SoftNavObserved',
        label: 'Diff · soft nav observed',
        help: 'Same-document soft navigation (D4) — observe-only; no remount.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.ResyncRequested',
        label: 'Diff · resync requested',
        help: 'Client requested OOB joint Dom+Cssom resync.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Diff.ResyncServed',
        label: 'Diff · resync served',
        help: 'API served the OOB resync snapshot (sheet/rule/seed counts + duration).',
      },
    ],
  },
  {
    id: 'page-projection-input-path',
    title: 'PageProjection Intent path',
    blurb: 'Element intent hops (not video).',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Input.DataPlaneReceived',
        label: 'Hop 1 · Data-plane received',
        help: 'DOM input arrived on the data plane.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.AdmissionDropped',
        label: 'Hop · Admission dropped',
        help: 'DOM input evicted from the API DropOldest admission queue before push.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.SidecarPushWritten',
        label: 'Hop 2 · Sidecar push written',
        help: 'API wrote DOM input on PushDomInput (gRPC).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.SidecarAdmitted',
        label: 'Hop 3 · Sidecar admitted',
        help: 'Sidecar completed CDP dispatch successfully.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.CdpDropped',
        label: 'Hop · CDP dropped',
        help: 'Sidecar dropped the intent (generation_stale, ignored_wire_click, anchor_missing, invalid_coords, cdp_error, …).',
        hotPath: true,
      },
    ],
  },
  {
    id: 'page-projection-input-outcomes',
    title: 'DOM input outcomes',
    blurb: 'Applied or rejected for DOM input.',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Input.Applied',
        label: 'Input applied (gRPC push)',
        help: 'DOM input accepted on the API→sidecar PushDomInput write — not CDP dispatch.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.Rejected',
        label: 'Input rejected',
        help: 'DOM input rejected before or while pushing to the sidecar.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Input.ScrollEchoHit',
        label: 'Scroll echo hit',
        help: 'Virtual scroll sensor suppressed a Diff because intent echo matched exactly.',
        hotPath: true,
      },
    ],
  },
  {
    id: 'page-projection-virtual',
    title: 'PageProjection Virtual',
    blurb: 'Virtual (headless) navigation + resource facts, keyed by pageEpochId.',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.BootMarked',
        label: 'Virtual · boot marked',
        help: 'Browser launch → first commit (bootMs) — Chromium boot only, never mix into site load.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.NavCommit',
        label: 'Virtual · nav commit',
        help: 'New pageEpochId minted (hard navigation or SoftNav) with generation/documentEpoch.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.NavTiming',
        label: 'Virtual · nav timing',
        help: 'Redirect/dns/connect/ttfb/domInteractive/domContentLoaded/load (ms) for the epoch.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.ResourceSummary',
        label: 'Virtual · resource summary',
        help: 'Resource counts by type plus the slowest resources for the epoch.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.PageError',
        label: 'Virtual · page error',
        help: 'Console error / pageerror / requestfailed observed on Virtual, deduped by urlKey.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Virtual.Lifecycle',
        label: 'Virtual · lifecycle',
        help: 'Named page lifecycle milestone (tSinceCommitMs when known).',
        hotPath: true,
      },
    ],
  },
  {
    id: 'page-projection-establish',
    title: 'PageProjection Establish',
    blurb: 'Dom map + Cssom install path from commit to first Diff, keyed by pageEpochId.',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.StylesWaitStarted',
        label: 'Establish · styles wait started',
        help: 'Waiting for stylesheets to settle before Cssom install (timeoutMs).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.StylesWaitCompleted',
        label: 'Establish · styles wait completed',
        help: 'Styles wait finished (waitedMs, timedOut).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.DomMapStarted',
        label: 'Establish · dom map started',
        help: 'Serializing the Virtual Dom tree for the epoch.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.DomMapCompleted',
        label: 'Establish · dom map completed',
        help: 'Dom map serialization finished (durationMs, approxNodes).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.CssomInstallStarted',
        label: 'Establish · Cssom install started',
        help: 'Installing owned stylesheets/rules for the epoch (source).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.CssomInstallCompleted',
        label: 'Establish · Cssom install completed',
        help: 'Cssom install finished (durationMs, sheetCount, ruleCount, seededSheetCount).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.FirstDiffEmitted',
        label: 'Establish · first diff emitted',
        help: 'First Dom/Cssom Diff after commit (tSinceCommitMs) — liquid-load anchor.',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.EstablishCompleted',
        label: 'Establish · completed',
        help: 'Dom+Cssom establish finished for the epoch (totalMs, tSinceCommitMs).',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Establish.EstablishFailed',
        label: 'Establish · failed',
        help: 'Establish failed — always carries errorCode + phase.',
      },
    ],
  },
  {
    id: 'page-projection-asset',
    title: 'PageProjection Asset',
    blurb: 'Asset rewrite + fetch + serve facts, some keyed by pageEpochId, some global.',
    events: [
      {
        type: 'Telemetry.Sessions.PageProjection.Asset.RewriteSummary',
        label: 'Asset · rewrite summary',
        help: 'candidates/rewritten/bareSkipped/dataInlined/blobQueued/deferredFetches for the epoch.',
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Asset.FetchFinished',
        label: 'Asset · fetch finished',
        help: 'One deferred/data asset fetch outcome (durationMs, bytes, mode, ok).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Asset.ServeMiss',
        label: 'Asset · serve miss',
        help: 'DomAsset proxy returned a non-2xx status (urlKey, status).',
        hotPath: true,
      },
      {
        type: 'Telemetry.Sessions.PageProjection.Asset.ServeSlow',
        label: 'Asset · serve slow',
        help: 'DomAsset proxy exceeded the slow-serve threshold (urlKey, durationMs).',
        hotPath: true,
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
  (g) => g.id === 'page-projection-input-path',
)!.events.map((e) => e.type)

const PAGE_PROJECTION_DIFF_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'page-projection-diff',
)!.events.map((e) => e.type)

const PAGE_PROJECTION_VIRTUAL_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'page-projection-virtual',
)!.events.map((e) => e.type)

const PAGE_PROJECTION_ESTABLISH_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'page-projection-establish',
)!.events.map((e) => e.type)

const PAGE_PROJECTION_ASSET_TYPES = TELEMETRY_SESSION_EVENT_GROUPS.find(
  (g) => g.id === 'page-projection-asset',
)!.events.map((e) => e.type)

/** Server hops for VideoStreamingInput path tracing (pair with Activity client_sent). */
export const TELEMETRY_VIDEO_STREAMING_INPUT_PATH_TYPES = VIDEO_STREAMING_INPUT_PATH_TYPES

/** Server hops for PageProjectionIntent path tracing. */
export const TELEMETRY_DOM_PROJECTION_INPUT_PATH_TYPES = DOM_PROJECTION_INPUT_PATH_TYPES

/**
 * PageEpoch parity pack (plan C5): full Diff chronology + Intent path +
 * ScrollEchoHit + Browse.LocationChanged + every Virtual/Establish/Asset fact.
 * Pair with the front ParityDebug pack and `build-page-epoch-story.cjs`.
 */
export const TELEMETRY_PARITY_DEBUG_TYPES: TelemetrySessionEventType[] = [
  ...PAGE_PROJECTION_DIFF_TYPES,
  ...DOM_PROJECTION_INPUT_PATH_TYPES,
  'Telemetry.Sessions.PageProjection.Input.ScrollEchoHit',
  'Telemetry.Sessions.Browse.LocationChanged',
  ...PAGE_PROJECTION_VIRTUAL_TYPES,
  ...PAGE_PROJECTION_ESTABLISH_TYPES,
  ...PAGE_PROJECTION_ASSET_TYPES,
]

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
