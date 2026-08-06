/**
 * Speculum live-session client (refactor wire).
 *
 * Control plane: SignalR MessagePack on `/w7s/vhub`
 * Data streams: pluggable transport (WebTransport or WebSocket mux) framed MessagePack
 */

export {
  PipeKind,
  ConsoleOutputKind,
  NotificationKind,
  DefaultHubPath,
  DefaultTransportPath,
  DefaultStreamPath,
  SessionAuthQueryParam,
  SessionCacheBustQueryParam,
} from './constants'
export type { PipeKindValue, DataStreamTransportKind } from './constants'

export { Emitter } from './emitter'
export { writePipeHeader, writeMessage, FramedReader } from './framing'
export { ControlPlane } from './control'
export type { ControlPlaneOptions, ControlPlaneHandlers } from './control'
export type {
  DataStreamPipe,
  DataStreamTransport,
  DataStreamTransportConnectOptions,
} from './dataStreamTransport'
export { DataStreams, newInputTraceId } from './dataStreams'
export type { DataStreamsOptions } from './dataStreams'
export { WebTransportDataStreamTransport } from './webTransportDataStreamTransport'
export { WebSocketDataStreamTransport } from './webSocketDataStreamTransport'
export {
  createDataStreamTransport,
  defaultPathForDataStreamTransport,
  normalizeDataStreamTransportKind,
} from './createDataStreamTransport'
export { LiveSession } from './liveSession'
export { SessionClient, createSessionClient } from './client'
export type { SessionClientOptions } from './client'
export {
  appendSessionAuth,
  appendCacheBust,
  appendSessionBindingQuery,
  isVirtualAssetUrl,
} from './sessionBindingAuth'
export { normalizeMirrorMode } from './types'
export type * from './types'
