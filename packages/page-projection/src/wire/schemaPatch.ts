/**
 * Peel schema envelope (16 bytes, speculum.wire.toml [envelope]) then decode
 * message payloads with the generated codec. ISA inside Patch.deltas stays in decode.ts.
 */

import {
  OPC_Patch,
  decodePatchBytes,
  encodePatchBytes,
  type Patch,
  SCHEMA_SHA256,
} from './speculum_wire.gen';

export { SCHEMA_SHA256 };

export const ENVELOPE_BYTES = 16;

export type SchemaEnvelope = {
  opcode: number;
  reserved: number;
  target: number;
  length: number;
  correlation: number;
};

export function peekSchemaEnvelope(bytes: Uint8Array): SchemaEnvelope | null {
  if (bytes.byteLength < ENVELOPE_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    opcode: view.getUint16(0, true),
    reserved: view.getUint16(2, true),
    target: view.getUint32(4, true),
    length: view.getUint32(8, true),
    correlation: view.getUint32(12, true),
  };
}

/** True when bytes look like a schema wire message (not ISA frame magic 0x5050). */
export function isSchemaWire(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ENVELOPE_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(0, true);
  if (magic === 0x5050) return false; // ISA frame-protocol prefix
  const env = peekSchemaEnvelope(bytes)!;
  if (env.reserved !== 0) return false;
  if (env.length > bytes.byteLength - ENVELOPE_BYTES) return false;
  // Outbound content / session opcodes (bit15 set) or known inbound control.
  return env.opcode === OPC_Patch || (env.opcode & 0x8000) !== 0;
}

export type DecodedSchemaPatch = {
  envelope: SchemaEnvelope;
  patch: Patch;
  deltas: Uint8Array;
};

/**
 * Decode one complete envelope+Patch from `bytes` (single message, not a stream).
 * Returns null if not a Patch envelope.
 */
export function decodeSchemaPatchMessage(bytes: Uint8Array): DecodedSchemaPatch | null {
  const env = peekSchemaEnvelope(bytes);
  if (!env || env.opcode !== OPC_Patch) return null;
  if (bytes.byteLength < ENVELOPE_BYTES + env.length) return null;
  const payload = bytes.subarray(ENVELOPE_BYTES, ENVELOPE_BYTES + env.length);
  const patch = decodePatchBytes(payload);
  return { envelope: env, patch, deltas: patch.deltas };
}

/** Build envelope+Patch bytes (lab / tests). */
export function encodeSchemaPatchMessage(
  patch: Patch,
  target = 0,
  correlation = 0,
): Uint8Array {
  const payload = encodePatchBytes(patch);
  const out = new Uint8Array(ENVELOPE_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, OPC_Patch, true);
  view.setUint16(2, 0, true);
  view.setUint32(4, target >>> 0, true);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, correlation >>> 0, true);
  out.set(payload, ENVELOPE_BYTES);
  return out;
}
