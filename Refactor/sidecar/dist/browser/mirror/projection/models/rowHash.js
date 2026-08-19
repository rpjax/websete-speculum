"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TableHashTracker = exports.MASK64 = void 0;
exports.h64Bytes = h64Bytes;
exports.h64Str = h64Str;
exports.h64U32 = h64U32;
exports.addMod64 = addMod64;
exports.subMod64 = subMod64;
exports.hashName = hashName;
exports.hashValue = hashValue;
exports.hashAttr = hashAttr;
exports.hashProp = hashProp;
exports.hashNs = hashNs;
exports.hashShadowInit = hashShadowInit;
exports.computeRowHash = computeRowHash;
const elementNs_1 = require("./elementNs");
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
exports.MASK64 = 0xffffffffffffffffn;
const sharedEncoder = new TextEncoder();
/** FNV-1a-64 over raw bytes. `seed` lets a caller continue an existing hash state. */
function h64Bytes(bytes, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    for (let i = 0; i < bytes.length; i++) {
        h ^= BigInt(bytes[i]);
        h = (h * FNV_PRIME) & exports.MASK64;
    }
    return h;
}
function h64Str(value, seed = FNV_OFFSET_BASIS) {
    return h64Bytes(sharedEncoder.encode(value), seed);
}
/** Hashes a u32 as 4 little-endian bytes, continuing from `seed`. */
function h64U32(value, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    h ^= BigInt(value & 0xff);
    h = (h * FNV_PRIME) & exports.MASK64;
    h ^= BigInt((value >>> 8) & 0xff);
    h = (h * FNV_PRIME) & exports.MASK64;
    h ^= BigInt((value >>> 16) & 0xff);
    h = (h * FNV_PRIME) & exports.MASK64;
    h ^= BigInt((value >>> 24) & 0xff);
    h = (h * FNV_PRIME) & exports.MASK64;
    return h;
}
function addMod64(a, b) {
    return (a + b) & exports.MASK64;
}
function subMod64(a, b) {
    // Two's-complement infinite-width BigInt bitwise AND correctly wraps a negative
    // subtraction result to its unsigned mod-2^64 value — no extra normalization needed.
    return (a - b) & exports.MASK64;
}
/**
 * Per-field content hashes — each field's own fresh H64 run, prefixed with a tag byte so
 * "name:foo" and "value:name:foo" cannot collide structurally. These are summed (not XORed,
 * §1.5) into a row's `contentHash`, which is what makes `ATTR_SET` order-independent and lets
 * `ReplicatedTable` add/remove one attribute's contribution in O(1) without rehashing the rest.
 */
function hashName(name) {
    return h64Str(`\u0000N${name}`);
}
function hashValue(value) {
    return h64Str(`\u0000V${value}`);
}
function hashAttr(name, value) {
    return h64Str(`\u0000A${name}\u0001${value}`);
}
/** ELEMENT `props[propId]` contribution to `contentHash` (§1.5). Commutative with attrs. */
function hashProp(propId, value) {
    if (typeof value === 'boolean')
        return h64Str(`\u0000P${propId}\u0001B${value ? '1' : '0'}`);
    if (typeof value === 'number')
        return h64Str(`\u0000P${propId}\u0001F${value}`);
    return h64Str(`\u0000P${propId}\u0001S${value}`);
}
/**
 * ELEMENT namespace contribution to `contentHash` (§1.5). Known `ns` hashes the `u8`;
 * `custom` hashes the URI so HTML `<a>` and SVG `<a>` cannot collide, and two custom
 * URIs cannot either.
 */
function hashNs(ns, uri) {
    if (ns === elementNs_1.ElementNs.Custom)
        return h64Str(`\u0000U${uri ?? ''}`);
    return h64Bytes(Uint8Array.of(0x00, 0x53, ns & 0xff));
}
/** `SHADOW_ROOT` `mode` + `initFlags` contribution to `contentHash`. */
function hashShadowInit(mode, initFlags) {
    return h64Bytes(Uint8Array.of(0x00, 0x48, mode & 0xff, initFlags & 0xff));
}
/** `rowHash = H64(id, kind, parent, prevSibling, contentHash)` — §1.5. Order-sensitive fold. */
function computeRowHash(id, kind, parent, prevSibling, contentHash) {
    let h = h64U32(id);
    h = h64U32(kind, h);
    h = h64U32(parent, h);
    h = h64U32(prevSibling, h);
    h ^= contentHash;
    h = (h * FNV_PRIME) & exports.MASK64;
    return h;
}
/**
 * `tableHash = Σ rowHash (mod 2^64)`, maintained by subtract-old/add-new — §1.5's mandatory O(1)
 * update. A table hash recomputed in O(n) per frame is a contract violation, not an optimization
 * choice (§1.5).
 */
class TableHashTracker {
    total = 0n;
    rowHashes = new Map();
    get value() {
        return this.total;
    }
    get size() {
        return this.rowHashes.size;
    }
    has(id) {
        return this.rowHashes.has(id);
    }
    upsert(id, newRowHash) {
        const old = this.rowHashes.get(id);
        if (old !== undefined)
            this.total = subMod64(this.total, old);
        this.rowHashes.set(id, newRowHash);
        this.total = addMod64(this.total, newRowHash);
    }
    remove(id) {
        const old = this.rowHashes.get(id);
        if (old === undefined)
            return;
        this.total = subMod64(this.total, old);
        this.rowHashes.delete(id);
    }
    clear() {
        this.total = 0n;
        this.rowHashes.clear();
    }
}
exports.TableHashTracker = TableHashTracker;
//# sourceMappingURL=rowHash.js.map