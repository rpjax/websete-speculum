/**
 * Data-plane barrel — shared Chromium ↔ Sidecar mux types.
 */

export { PlaneChannel, planeChannelName } from './channels';
export {
  PLANE_MAGIC,
  PLANE_VERSION,
  PLANE_HEADER_SIZE,
  encodePlaneEnvelope,
  decodePlaneEnvelope,
  isPlaneEnvelope,
  type PlaneEnvelope,
} from './envelope';
export type {
  DataPlane,
  DataPlaneResult,
  DataPlaneMessageHandler,
  LoopbackInvokeHandler,
  LoopbackInvokeResult,
} from './dataPlane';
