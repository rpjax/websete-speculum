/**
 * Speculum live-session browser client (ES modules).
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
} from './constants.js'

export { Emitter } from './emitter.js'
export {
  writePipeHeader,
  writeMessage,
  readMessages,
  readPipeKind,
} from './framing.js'
export { ControlPlane } from './control.js'
export { DataPlane } from './transport.js'
export { LiveSession } from './liveSession.js'
export { SessionClient, createSessionClient } from './client.js'
