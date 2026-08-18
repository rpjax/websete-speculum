/**
 * H64 primitives for the replicated table's rowHash/tableHash — frame-protocol.md §1.5.
 * `rowHash = H64(id, kind, parent, prevSibling, contentHash)`;
 * `tableHash = Σ rowHash (mod 2^64)`, updated by subtract-old/add-new in O(1) (`TableHashTracker`).
 *
 * Deliberately the SAME implementation on both producer (Node, virtual/) and client (browser,
 * client/) — imported from models/ (DOM-free, dual-consumed like models/decode.ts) so the two
 * sides can never independently diverge, which would defeat the whole point of `preTableHash`/
 * `CHECK`.
 *
 * BigInt is used for correctness/clarity first. If the lab Benchmark tool's CPU profile shows
 * this regresses `buildMs` at sustained tick rate (frame-protocol.md Stage 1 gate — measure, don't
 * assume, same discipline as the 2026-08-13 decision-log entries), revisit with a two-uint32-word
 * implementation. Not assumed a problem preemptively.
 */

import { ElementNs } from './elementNs';

const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
export const MASK64 = 0xffffffffffffffffn;

const sharedEncoder = new TextEncoder();

/** FNV-1a-64 over raw bytes. `seed` lets a caller continue an existing hash state. */
export function h64Bytes(bytes: Uint8Array, seed: bigint = FNV_OFFSET_BASIS): bigint {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]!);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

export function h64Str(value: string, seed: bigint = FNV_OFFSET_BASIS): bigint {
  return h64Bytes(sharedEncoder.encode(value), seed);
}

/** Hashes a u32 as 4 little-endian bytes, continuing from `seed`. */
export function h64U32(value: number, seed: bigint = FNV_OFFSET_BASIS): bigint {
  let h = seed;
  h ^= BigInt(value & 0xff);
  h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 8) & 0xff);
  h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 16) & 0xff);
  h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 24) & 0xff);
  h = (h * FNV_PRIME) & MASK64;
  return h;
}

export function addMod64(a: bigint, b: bigint): bigint {
  return (a + b) & MASK64;
}

export function subMod64(a: bigint, b: bigint): bigint {
  // Two's-complement infinite-width BigInt bitwise AND correctly wraps a negative
  // subtraction result to its unsigned mod-2^64 value — no extra normalization needed.
  return (a - b) & MASK64;
}

/**
 * Per-field content hashes — each field's own fresh H64 run, prefixed with a tag byte so
 * "name:foo" and "value:name:foo" cannot collide structurally. These are summed (not XORed,
 * §1.5) into a row's `contentHash`, which is what makes `ATTR_SET` order-independent and lets
 * `ReplicatedTable` add/remove one attribute's contribution in O(1) without rehashing the rest.
 */
export function hashName(name: string): bigint {
  return h64Str(`\u0000N${name}`);
}

export function hashValue(value: string): bigint {
  return h64Str(`\u0000V${value}`);
}

export function hashAttr(name: string, value: string): bigint {
  return h64Str(`\u0000A${name}\u0001${value}`);
}

/** ELEMENT `props[propId]` contribution to `contentHash` (§1.5). Commutative with attrs. */
export function hashProp(propId: number, value: string | boolean | number): bigint {
  if (typeof value === 'boolean') return h64Str(`\u0000P${propId}\u0001B${value ? '1' : '0'}`);
  if (typeof value === 'number') return h64Str(`\u0000P${propId}\u0001F${value}`);
  return h64Str(`\u0000P${propId}\u0001S${value}`);
}

/**
 * ELEMENT namespace contribution to `contentHash` (§1.5). Known `ns` hashes the `u8`;
 * `custom` hashes the URI so HTML `<a>` and SVG `<a>` cannot collide, and two custom
 * URIs cannot either.
 */
export function hashNs(ns: number, uri?: string): bigint {
  if (ns === ElementNs.Custom) return h64Str(`\u0000U${uri ?? ''}`);
  return h64Bytes(Uint8Array.of(0x00, 0x53, ns & 0xff));
}

/** `rowHash = H64(id, kind, parent, prevSibling, contentHash)` — §1.5. Order-sensitive fold. */
export function computeRowHash(
  id: number,
  kind: number,
  parent: number,
  prevSibling: number,
  contentHash: bigint,
): bigint {
  let h = h64U32(id);
  h = h64U32(kind, h);
  h = h64U32(parent, h);
  h = h64U32(prevSibling, h);
  h ^= contentHash;
  h = (h * FNV_PRIME) & MASK64;
  return h;
}

/**
 * `tableHash = Σ rowHash (mod 2^64)`, maintained by subtract-old/add-new — §1.5's mandatory O(1)
 * update. A table hash recomputed in O(n) per frame is a contract violation, not an optimization
 * choice (§1.5).
 */
export class TableHashTracker {
  private total = 0n;
  private readonly rowHashes = new Map<number, bigint>();

  get value(): bigint {
    return this.total;
  }

  get size(): number {
    return this.rowHashes.size;
  }

  has(id: number): boolean {
    return this.rowHashes.has(id);
  }

  upsert(id: number, newRowHash: bigint): void {
    const old = this.rowHashes.get(id);
    if (old !== undefined) this.total = subMod64(this.total, old);
    this.rowHashes.set(id, newRowHash);
    this.total = addMod64(this.total, newRowHash);
  }

  remove(id: number): void {
    const old = this.rowHashes.get(id);
    if (old === undefined) return;
    this.total = subMod64(this.total, old);
    this.rowHashes.delete(id);
  }

  clear(): void {
    this.total = 0n;
    this.rowHashes.clear();
  }
}
