/**
 * Patch / table digest — mirrors gecko-engine `domain/producer/PatchBuilder.hpp`
 * `digestBytes` / `digestTable` (FNV-1a-64 via h64Bytes / h64U32).
 */

import { h64Bytes, h64U32, MASK64 } from './rowHash';

const FNV_PRIME = 1099511628211n;

/** Order-dependent 64-bit digest of patch ISA bytes (stable C++/TS). */
export function digestBytes(bytes: Uint8Array): bigint {
  return h64Bytes(bytes);
}

/** Digest binding tableHash to sequence (resync / snapshot header). */
export function digestTable(tableHash: bigint, sequence: number): bigint {
  let h = h64U32(sequence >>> 0);
  h ^= tableHash;
  h = (h * FNV_PRIME) & MASK64;
  return h;
}
