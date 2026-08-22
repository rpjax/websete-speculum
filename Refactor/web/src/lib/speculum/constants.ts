import { w7sPath } from '@/lib/w7s'

/** Wire pipe kinds — must match SessionDataStreamsHost.SessionPipeKind. */
export const PipeKind = {
  Frame: 1,
  ConsoleOutput: 2,
  Notification: 3,
  VideoStreamingInput: 4,
  ConsoleInput: 5,
  Status: 6,
  /** PageProjection outbound frames. */
  PageProjectionFrame: 7,
  /** Dom Projection element input. */
  PageProjectionIntent: 8,
} as const

export type PipeKindValue = (typeof PipeKind)[keyof typeof PipeKind]

export const ConsoleOutputKind = {
  Console: 1,
  EvalResult: 2,
} as const

export const NotificationKind = {
  LocationChanged: 1,
  MainFrameNavigationBlocked: 2,
  EditableFocusChanged: 3,
  Crashed: 4,
  InputRejected: 5,
  VideoStreamingInputApplied: 6,
  VideoStreamingInputPathTrace: 7,
  AllocationLifecycle: 8,
  PageProjectionIntentRejected: 9,
  PageProjectionIntentApplied: 10,
  PageProjectionIntentPathTrace: 11,
  PageProjectionFrame: 12,
  /** PageProjection lifecycle (generation_bumped | soft_nav_observed | …). */
  PageProjectionLifecycle: 13,
  PageProjectionFrameQueueDropped: 14,
} as const

/** Public SignalR hub path (control plane under `/w7s`). */
export const DefaultHubPath = w7sPath('/vhub')
/** Public WebTransport data-plane path under `/w7s`. */
export const DefaultTransportPath = w7sPath('/vtransport')
/** Public WebSocket mux data-plane path under `/w7s`. */
export const DefaultStreamPath = w7sPath('/vstream')
/** Length-prefixed data-plane message ceiling (WS/WT). Sized for PageProjection establish frames. */
export const MaxMessageBytes = 10 * 1024 * 1024

/** Sessions.dataStreamTransport / client-config values. */
export type DataStreamTransportKind = 'webTransport' | 'webSocket'

/**
 * Reserved query parameter carrying the live-session binding token on
 * `/w7s/virtual-*`, Dom uploads, and data-plane dial (WT/WS).
 *
 * Deliberately hyphenated and namespaced: a mirrored site's own `token=` query
 * must never be mistaken for Speculum auth (and vice versa). Must match
 * `SessionBindingAuth.QueryParameterName`.
 */
export const SessionAuthQueryParam = 'speculum-session-token'

/**
 * Reserved cache-buster the client appends when forcing a stylesheet reload.
 * Server-side it is stripped before the virtual-asset key lookup, so it cannot
 * poison the key. Must match `SessionBindingAuth.CacheBustQueryParameterName`.
 */
export const SessionCacheBustQueryParam = 'speculum-cache-bust'
