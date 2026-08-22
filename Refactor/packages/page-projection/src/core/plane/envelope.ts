/**
 * Data-plane binary envelope — one WebSocket message = one envelope.
 *
 * ```
 * magic   u16 LE  'SP' (0x5053)
 * version u8      1
 * channel u8      PlaneChannel
 * flags   u8      0 (reserved)
 * payload …       channel-specific bytes (Frame ⇒ raw PP part)
 * ```
 *
 * Shared by Virtual (browser) and sidecar (Node). No DOM types.
 */

import { PlaneChannel } from './channels';

export const PLANE_MAGIC = 0x5053 as const; // 'S' | 'P' LE → bytes 53 50
export const PLANE_VERSION = 1 as const;
export const PLANE_HEADER_SIZE = 5; // magic(2)+version(1)+channel(1)+flags(1)

export type PlaneEnvelope = {
  channel: PlaneChannel;
  flags: number;
  payload: Uint8Array;
};

export function encodePlaneEnvelope(
  channel: PlaneChannel,
  payload: Uint8Array,
  flags = 0,
): Uint8Array {
  const out = new Uint8Array(PLANE_HEADER_SIZE + payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint16(0, PLANE_MAGIC, true);
  out[2] = PLANE_VERSION;
  out[3] = channel & 0xff;
  out[4] = flags & 0xff;
  out.set(payload, PLANE_HEADER_SIZE);
  return out;
}

export function decodePlaneEnvelope(message: Uint8Array): PlaneEnvelope | null {
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

/** True when message looks like a data-plane envelope (vs bare PP). */
export function isPlaneEnvelope(message: Uint8Array): boolean {
  if (message.length < PLANE_HEADER_SIZE) return false;
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  return view.getUint16(0, true) === PLANE_MAGIC && message[2] === PLANE_VERSION;
}
