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

/** Re-export — canonical definitions live in page-projection package via sessionBindingAuth. */
export { SessionAuthQueryParam, SessionCacheBustQueryParam } from './sessionBindingAuth'
