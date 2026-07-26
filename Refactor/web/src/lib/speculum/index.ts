/**
 * Speculum live-session client (refactor wire).
 *
 * Control plane: SignalR MessagePack on `/vhub`
 * Data plane: WebTransport framed MessagePack on `/vtransport`
 */

export {
  PipeKind,
  ConsoleOutputKind,
  NotificationKind,
  DefaultHubPath,
  DefaultTransportPath,
} from './constants'

export { Emitter } from './emitter'
export { writePipeHeader, writeMessage, FramedReader } from './framing'
export { ControlPlane } from './control'
export type { ControlPlaneOptions, ControlPlaneHandlers } from './control'
export { DataPlane } from './transport'
export { LiveSession } from './liveSession'
export { SessionClient, createSessionClient } from './client'
export type { SessionClientOptions } from './client'
export type * from './types'
