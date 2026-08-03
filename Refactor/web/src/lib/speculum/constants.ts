import { w7sPath } from '@/lib/w7s'

/** Wire pipe kinds — must match SessionWebTransportEndpoint.SessionPipeKind. */
export const PipeKind = {
  Frame: 1,
  ConsoleOutput: 2,
  Notification: 3,
  UserInput: 4,
  ConsoleInput: 5,
  Status: 6,
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
} as const

/** Public SignalR hub path (control plane under `/w7s`). */
export const DefaultHubPath = w7sPath('/vhub')
/** Public WebTransport data-plane path under `/w7s`. */
export const DefaultTransportPath = w7sPath('/vtransport')
/** Public WebSocket mux data-plane path under `/w7s`. */
export const DefaultStreamPath = w7sPath('/vstream')
export const MaxMessageBytes = 1024 * 1024

/** Sessions.dataStreamTransport / client-config values. */
export type DataStreamTransportKind = 'webTransport' | 'webSocket'
