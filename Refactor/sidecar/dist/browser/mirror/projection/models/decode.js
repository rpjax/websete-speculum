"use strict";
/**
 * Binary frame reader — mirrors virtual/frame/binaryFrameEncoder.ts + binaryWriter.ts exactly.
 * Decodes one frame *part* fully (StrRefs resolved, ops typed) and assembles multi-part
 * frames into one atomic unit. No `JSON.parse` anywhere on this path.
 *
 * Ops decode straight into the shared `FrameOp` union (models/frame.ts) — the wire and
 * logical shapes are the same on this side; only string-ref resolution and multi-part
 * assembly are decode-specific concerns.
 *
 * Lives in `models/` (not `client/`) because it has zero DOM dependency (pure
 * `Uint8Array`/`DataView`/`TextDecoder`) and is consumed on both sides of the process
 * boundary: the browser client bundle (via esbuild, `client/labProjectionClient.ts`) and
 * the lab server (via tsc, `lab/frameInvariantMonitor.ts`) — `client/` and `virtual/` are
 * both esbuild-only and excluded from the tsc project, so a dual-consumed module cannot
 * live under either.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FramePartAssembler = exports.PersistentStringTable = void 0;
exports.decodeFramePart = decodeFramePart;
const opcodes_1 = require("./opcodes");
const frame_1 = require("./frame");
const limits_1 = require("./limits");
const WIRE_VERSION = 1;
const WIRE_MAGIC = 0x5050;
const LOCAL_STR_BIT = 0x80000000;
const RESYNC_FLAG_BIT = 0b10;
const textDecoder = new TextDecoder('utf-8');
class ByteReader {
    view;
    bytes;
    offset = 0;
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    get remaining() {
        return this.bytes.byteLength - this.offset;
    }
    u8() {
        const v = this.view.getUint8(this.offset);
        this.offset += 1;
        return v;
    }
    u16() {
        const v = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return v;
    }
    u32() {
        const v = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }
    u64() {
        const v = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return v;
    }
    bytes_(len) {
        const v = this.bytes.subarray(this.offset, this.offset + len);
        this.offset += len;
        return v;
    }
    utf8(len) {
        // §8 MAX_STR_BYTES — checked before the allocation-proportional-to-`len` decode below, not
        // after: a corrupted length must never trigger a large allocation, regardless of whether the
        // buffer actually contains that many bytes (TypedArray.subarray clamps silently otherwise).
        if (len > limits_1.MAX_STR_BYTES) {
            throw new Error(`string byteLen ${len} exceeds MAX_STR_BYTES (${limits_1.MAX_STR_BYTES})`);
        }
        return textDecoder.decode(this.bytes_(len));
    }
}
/**
 * Session-lived persistent string table (`STR_DEF`, frame-protocol.md §1.7). The v0 producer
 * never emits `STR_DEF` (every string rides frame-local, see binaryFrameEncoder.ts), so this
 * stays empty in practice — kept so decode matches the wire format exactly rather than
 * assuming "local-only" as a shortcut.
 */
class PersistentStringTable {
    byId = new Map();
    define(strId, value) {
        this.byId.set(strId, value);
    }
    resolve(ref) {
        return this.byId.get(ref);
    }
    clear() {
        this.byId.clear();
    }
}
exports.PersistentStringTable = PersistentStringTable;
function decodeFramePart(input, persistent) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    try {
        const r = new ByteReader(bytes);
        if (r.remaining < 24)
            return malformed('frame shorter than the fixed header');
        if (r.u16() !== WIRE_MAGIC)
            return malformed('bad magic');
        const version = r.u8();
        if (version !== WIRE_VERSION) {
            return { ok: false, reason: 'unknown_version', message: `unsupported wire version ${version}` };
        }
        const flags = r.u8();
        const generation = r.u32();
        const sequence = r.u32();
        const partIndex = r.u16();
        const partCount = r.u16();
        const preTableHash = r.u64();
        // §8 MAX_OPS_PER_FRAME bounds decode work; a frame's local string table has no separate
        // named limit but every entry it can hold is itself bounded by MAX_STR_BYTES (above), and
        // its count is bounded by the same MAX_OPS_PER_FRAME ceiling — a legitimate frame never
        // needs more distinct local strings than it has ops to reference them.
        const strCount = r.u32();
        if (strCount > limits_1.MAX_OPS_PER_FRAME)
            return malformed(`strCount ${strCount} exceeds MAX_OPS_PER_FRAME`);
        const localStrings = new Array(strCount);
        for (let i = 0; i < strCount; i++)
            localStrings[i] = r.utf8(r.u32());
        const resolveStr = (ref) => {
            if ((ref & LOCAL_STR_BIT) !== 0)
                return localStrings[ref & 0x7fffffff] ?? '';
            return persistent.resolve(ref) ?? '';
        };
        const opCount = r.u32();
        if (opCount > limits_1.MAX_OPS_PER_FRAME)
            return malformed(`opCount ${opCount} exceeds MAX_OPS_PER_FRAME`);
        const ops = new Array(opCount);
        for (let i = 0; i < opCount; i++) {
            const opCode = r.u8();
            const op = decodeOp(opCode, r, resolveStr, persistent);
            if (!op)
                return malformed(`unknown opcode ${opCode}`);
            ops[i] = op;
        }
        return {
            ok: true,
            part: {
                version,
                resync: (flags & RESYNC_FLAG_BIT) !== 0,
                generation,
                sequence,
                partIndex,
                partCount,
                preTableHash,
                ops,
            },
        };
    }
    catch (err) {
        return malformed(err instanceof Error ? err.message : String(err));
    }
}
function malformed(message) {
    return { ok: false, reason: 'malformed', message };
}
function decodeAttrs(r, resolveStr) {
    const count = r.u16();
    // §8 MAX_ATTRS — checked before `new Array(count)` below (§4.2 NODE_NEW / §4.4 ATTR_SET's own
    // `count ≤ MAX_ATTRS` precondition; ATTR_DEL's name count shares the same bound — one cap for
    // "how many attribute-shaped things can one instruction carry").
    if (count > limits_1.MAX_ATTRS)
        throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${limits_1.MAX_ATTRS})`);
    const attrs = new Array(count);
    for (let i = 0; i < count; i++)
        attrs[i] = { name: resolveStr(r.u32()), value: resolveStr(r.u32()) };
    return attrs;
}
function checkChildCount(count) {
    // §8 MAX_CHILDREN_PER_OP — INSERT/REMOVE's own `count ≤ MAX_CHILDREN_PER_OP` precondition (§4.3).
    if (count > limits_1.MAX_CHILDREN_PER_OP) {
        throw new Error(`child count ${count} exceeds MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP})`);
    }
}
function decodeOp(opCode, r, resolveStr, persistent) {
    switch (opCode) {
        case opcodes_1.OpCode.Check: {
            const scope = r.u8();
            const lo = r.u32();
            const hi = r.u32();
            const hash = r.u64();
            if (scope !== frame_1.CHECK_SCOPE_TABLE && scope !== frame_1.CHECK_SCOPE_RANGE)
                return null; // P7 — strict, not tolerant
            return { op: opcodes_1.OpCode.Check, scope, lo, hi, hash };
        }
        case opcodes_1.OpCode.EpochReset:
            return { op: opcodes_1.OpCode.EpochReset, generation: r.u32() };
        case opcodes_1.OpCode.NodeDrop: {
            const count = r.u16();
            checkChildCount(count); // NODE_DROP has no named limit of its own; shares INSERT/REMOVE's batch cap
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.NodeDrop, ids };
        }
        case opcodes_1.OpCode.StrDef: {
            const strId = r.u32();
            const value = r.utf8(r.u32());
            persistent.define(strId, value);
            return { op: opcodes_1.OpCode.StrDef, strId, value };
        }
        case opcodes_1.OpCode.NodeNew: {
            const id = r.u32();
            const kind = r.u8();
            if (kind === opcodes_1.NodeKind.Element) {
                const name = resolveStr(r.u32());
                const attrs = decodeAttrs(r, resolveStr);
                return { op: opcodes_1.OpCode.NodeNew, id, kind: opcodes_1.NodeKind.Element, name, attrs };
            }
            if (kind === opcodes_1.NodeKind.Doctype) {
                return { op: opcodes_1.OpCode.NodeNew, id, kind: opcodes_1.NodeKind.Doctype, name: resolveStr(r.u32()) };
            }
            if (kind === opcodes_1.NodeKind.Text || kind === opcodes_1.NodeKind.Comment) {
                return { op: opcodes_1.OpCode.NodeNew, id, kind, value: resolveStr(r.u32()) };
            }
            return null;
        }
        case opcodes_1.OpCode.Insert: {
            const parent = r.u32();
            const before = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.Insert, parent, before: before === 0 ? frame_1.INSERT_AT_END : before, ids };
        }
        case opcodes_1.OpCode.Remove: {
            const parent = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.Remove, parent, ids };
        }
        case opcodes_1.OpCode.AttrSet: {
            const node = r.u32();
            const attrs = decodeAttrs(r, resolveStr);
            return { op: opcodes_1.OpCode.AttrSet, node, attrs };
        }
        case opcodes_1.OpCode.AttrDel: {
            const node = r.u32();
            const count = r.u16();
            if (count > limits_1.MAX_ATTRS)
                throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${limits_1.MAX_ATTRS})`);
            const names = new Array(count);
            for (let i = 0; i < count; i++)
                names[i] = resolveStr(r.u32());
            return { op: opcodes_1.OpCode.AttrDel, node, names };
        }
        case opcodes_1.OpCode.TextSet: {
            const node = r.u32();
            return { op: opcodes_1.OpCode.TextSet, node, value: resolveStr(r.u32()) };
        }
        case opcodes_1.OpCode.SheetNew: {
            const id = r.u32();
            const scope = r.u8();
            const hostNode = r.u32();
            const before = r.u32();
            if (scope !== frame_1.CSSOM_SCOPE_MAIN && scope !== frame_1.CSSOM_SCOPE_PIERCE_HOST)
                return null;
            return { op: opcodes_1.OpCode.SheetNew, id, scope, hostNode, before: before === 0 ? frame_1.INSERT_AT_END : before };
        }
        case opcodes_1.OpCode.SheetDrop: {
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.SheetDrop, ids };
        }
        case opcodes_1.OpCode.SheetOrder: {
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.SheetOrder, ids };
        }
        case opcodes_1.OpCode.RuleNew: {
            const sheet = r.u32();
            const id = r.u32();
            const before = r.u32();
            const text = resolveStr(r.u32());
            return { op: opcodes_1.OpCode.RuleNew, sheet, id, before: before === 0 ? frame_1.INSERT_AT_END : before, text };
        }
        case opcodes_1.OpCode.RuleDrop: {
            const sheet = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
                ids[i] = r.u32();
            return { op: opcodes_1.OpCode.RuleDrop, sheet, ids };
        }
        case opcodes_1.OpCode.RuleSet: {
            const id = r.u32();
            return { op: opcodes_1.OpCode.RuleSet, id, text: resolveStr(r.u32()) };
        }
        default:
            return null;
    }
}
/**
 * Buffers frame parts and assembles them into one atomic frame when
 * `partIndex === partCount - 1` arrives. A gap in the part sequence is reported as
 * `'missing_part'` — a desync trigger, never a partial apply.
 */
class FramePartAssembler {
    pending = new Map();
    ingest(part) {
        if (part.partCount <= 1)
            return assemble(part, [part]);
        const key = `${part.generation}:${part.sequence}`;
        let slot = this.pending.get(key);
        if (!slot || slot.parts.length !== part.partCount) {
            slot = { parts: new Array(part.partCount), received: 0 };
            this.pending.set(key, slot);
        }
        if (!slot.parts[part.partIndex])
            slot.received += 1;
        slot.parts[part.partIndex] = part;
        if (part.partIndex !== part.partCount - 1)
            return null;
        this.pending.delete(key);
        if (slot.received !== part.partCount)
            return 'missing_part';
        return assemble(part, slot.parts);
    }
    /** Drops every in-flight partial assembly (desync / generation bump). */
    reset() {
        this.pending.clear();
    }
}
exports.FramePartAssembler = FramePartAssembler;
function assemble(last, parts) {
    const ops = [];
    for (const part of parts)
        ops.push(...part.ops);
    return {
        version: last.version,
        resync: last.resync,
        generation: last.generation,
        sequence: last.sequence,
        preTableHash: last.preTableHash,
        ops,
    };
}
//# sourceMappingURL=decode.js.map