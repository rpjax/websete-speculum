import {
  decodeLoopbackToPlane,
  encodeLoopbackFromPlane,
  isLoopbackWireMessage,
} from '../loopback/envelope';
import { PlaneChannel } from './channels';

export const PLANE_MAGIC = 0x5053 as const; // legacy — loopback mux replaces on wire (LB-07)
export const PLANE_VERSION = 1 as const;
export const PLANE_HEADER_SIZE = 5;

export type PlaneEnvelope = {
  channel: PlaneChannel;
  flags: number;
  payload: Uint8Array;
};

/** Encode plane message onto loopback mux wire (§10.1c). */
export function encodePlaneEnvelope(
  channel: PlaneChannel,
  payload: Uint8Array,
  _flags = 0,
): Uint8Array {
  void _flags;
  return encodeLoopbackFromPlane(channel, payload);
}

export function decodePlaneEnvelope(message: Uint8Array): PlaneEnvelope | null {
  if (isLoopbackWireMessage(message)) {
    const mapped = decodeLoopbackToPlane(message);
    if (mapped === null) return null;
    return { channel: mapped.channel, flags: 0, payload: mapped.payload };
  }
  // Legacy plane header (pre-cutover) — drop if seen after migration
  if (message.length < PLANE_HEADER_SIZE) return null;
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  if (view.getUint16(0, true) !== PLANE_MAGIC) return null;
  if (message[2] !== PLANE_VERSION) return null;
  const channel = message[3] as PlaneChannel;
  const flags = message[4]!;
  return {
    channel,
    flags,
    payload: message.subarray(PLANE_HEADER_SIZE),
  };
}

export function isPlaneEnvelope(message: Uint8Array): boolean {
  return isLoopbackWireMessage(message) || decodePlaneEnvelope(message) !== null;
}
