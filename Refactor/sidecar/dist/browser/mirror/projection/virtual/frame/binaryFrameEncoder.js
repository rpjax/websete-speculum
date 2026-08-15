"use strict";
/**
 * FrameEncoder impl — Frame → wire part bytes (frame-protocol.md §2–§4).
 * Layout matches client `decode.ts`.
 *
 * v0 string policy: every string is encoded as a **frame-local** `StrRef` (bit31 set,
 * low 31 bits = index into this part's string table via `BinaryWriter.str()`). Persistent,
 * session-lived interning (`STR_DEF`, §1.7) is part of the wire format (decodable — see
 * client `decode.ts`) but this producer never emits it yet: interning is a wire-bytes
 * optimization, and the thing this lab increment measures is CPU per operation, not bytes
 * (frame-protocol.md decision log, 2026-08-13, "ISA"). Revisit once a perf pass shows bytes
 * are the binding constraint.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryFrameEncoder = void 0;
const opcodes_1 = require("../../models/opcodes");
const binaryWriter_1 = require("./binaryWriter");
const LOCAL_STR_BIT = 0x80000000;
/**
 * Diagnostic only — see `encodeOpsPart`. Off by default; flip on to break down a frame's bytes
 * between opcodes and the frame-local string table. Closed the 2026-08-13 "48KB first frame for
 * 34 nodes" question — root cause was Patchright's injected `<script>` tags being mirrored as
 * page content (fixed in bootstrap.ts / buildConfigPreScript.ts), not string encoding.
 */
const DEBUG_FIRST_FRAME_BYTES = false;
const DEFAULT_MAX_FRAME_BYTES = 1 << 20;
class BinaryFrameEncoder {
    maxFrameBytes;
    scratch = new binaryWriter_1.BinaryWriter();
    constructor(opts = {}) {
        this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    }
    encode(frame) {
        if (frame.ops.length === 0)
            return [];
        const single = this.encodeOpsPart(frame, frame.ops, 0, 1);
        if (single.length <= this.maxFrameBytes)
            return [single];
        const partsOps = [];
        let current = [];
        for (let i = 0; i < frame.ops.length; i++) {
            const trial = [...current, frame.ops[i]];
            const trialBytes = this.encodeOpsPart(frame, trial, 0, 1);
            if (trialBytes.length > this.maxFrameBytes && current.length > 0) {
                partsOps.push(current);
                current = [frame.ops[i]];
            }
            else {
                current = trial;
            }
        }
        if (current.length > 0)
            partsOps.push(current);
        const partCount = Math.max(1, partsOps.length);
        const out = [];
        for (let i = 0; i < partsOps.length; i++) {
            out.push(this.encodeOpsPart(frame, partsOps[i], i, partCount));
        }
        return out;
    }
    encodeOpsPart(frame, ops, partIndex, partCount) {
        const w = this.scratch;
        w.reset();
        w.u32(ops.length);
        for (let i = 0; i < ops.length; i++)
            this.writeOp(w, ops[i]);
        const flags = frame.flags.resync ? 0b10 : 0;
        const opsBody = w.bytesSoFar().slice();
        const stringTable = w.takeStringTableBytes();
        if (DEBUG_FIRST_FRAME_BYTES && frame.sequence === 1) {
            const strings = w.debugStrings();
            const record = {
                ops: ops.length,
                opsBodyBytes: opsBody.length,
                stringTableBytes: stringTable.length,
                stringCount: strings.length,
                top10ByLen: [...strings]
                    .sort((a, b) => b.length - a.length)
                    .slice(0, 10)
                    .map((s) => ({ len: s.length, preview: s.slice(0, 60) })),
            };
            globalThis.__speculumDiag ??= [];
            globalThis.__speculumDiag.push(record);
        }
        return (0, binaryWriter_1.assemblePart)({
            version: frame.version,
            flags,
            generation: frame.generation,
            sequence: frame.sequence,
            partIndex,
            partCount,
            preTableHash: frame.preTableHash,
            stringTable,
            opsBody,
        });
    }
    writeStrRef(w, value) {
        w.u32((w.str(value) | LOCAL_STR_BIT) >>> 0);
    }
    writeAttrs(w, attrs) {
        w.u16(attrs.length);
        for (let i = 0; i < attrs.length; i++) {
            this.writeStrRef(w, attrs[i].name);
            this.writeStrRef(w, attrs[i].value);
        }
    }
    writeOp(w, op) {
        switch (op.op) {
            case opcodes_1.OpCode.Check:
                return this.writeCheck(w, op);
            case opcodes_1.OpCode.EpochReset:
                return this.writeEpochReset(w, op);
            case opcodes_1.OpCode.StrDef:
                return this.writeStrDef(w, op);
            case opcodes_1.OpCode.NodeNew:
                return this.writeNodeNew(w, op);
            case opcodes_1.OpCode.NodeDrop:
                return this.writeNodeDrop(w, op);
            case opcodes_1.OpCode.Insert:
                return this.writeInsert(w, op);
            case opcodes_1.OpCode.Remove:
                return this.writeRemove(w, op);
            case opcodes_1.OpCode.AttrSet:
                return this.writeAttrSet(w, op);
            case opcodes_1.OpCode.AttrDel:
                return this.writeAttrDel(w, op);
            case opcodes_1.OpCode.TextSet:
                return this.writeTextSet(w, op);
            case opcodes_1.OpCode.SheetNew:
                return this.writeSheetNew(w, op);
            case opcodes_1.OpCode.SheetDrop:
                return this.writeSheetDrop(w, op);
            case opcodes_1.OpCode.SheetOrder:
                return this.writeSheetOrder(w, op);
            case opcodes_1.OpCode.RuleNew:
                return this.writeRuleNew(w, op);
            case opcodes_1.OpCode.RuleDrop:
                return this.writeRuleDrop(w, op);
            case opcodes_1.OpCode.RuleSet:
                return this.writeRuleSet(w, op);
            default:
                throw new Error(`BinaryFrameEncoder: unsupported op ${String(op.op)}`);
        }
    }
    /** §4.1 — `scope u8, lo u32, hi u32, hash u64`. Fixed-width, no varints (P5). */
    writeCheck(w, op) {
        w.u8(opcodes_1.OpCode.Check);
        w.u8(op.scope);
        w.u32(op.lo);
        w.u32(op.hi);
        w.u64(op.hash);
    }
    writeEpochReset(w, op) {
        w.u8(opcodes_1.OpCode.EpochReset);
        w.u32(op.generation);
    }
    /** Persistent `STR_DEF` bytes are raw (this instruction IS the definition), never interned. */
    writeStrDef(w, op) {
        w.u8(opcodes_1.OpCode.StrDef);
        w.u32(op.strId);
        w.utf8Raw(op.value);
    }
    writeNodeNew(w, op) {
        w.u8(opcodes_1.OpCode.NodeNew);
        w.u32(op.id);
        w.u8(op.kind);
        if (op.kind === opcodes_1.NodeKind.Element) {
            this.writeStrRef(w, op.name);
            this.writeAttrs(w, op.attrs);
            return;
        }
        if (op.kind === opcodes_1.NodeKind.Doctype) {
            this.writeStrRef(w, op.name);
            return;
        }
        this.writeStrRef(w, op.value);
    }
    /** §4.2 — `count: u16, ids: u32[]`; roots only, descendants derived independently on both sides. */
    writeNodeDrop(w, op) {
        w.u8(opcodes_1.OpCode.NodeDrop);
        w.u16(op.ids.length);
        for (let i = 0; i < op.ids.length; i++)
            w.u32(op.ids[i]);
    }
    writeInsert(w, op) {
        w.u8(opcodes_1.OpCode.Insert);
        w.u32(op.parent);
        w.u32(op.before);
        w.u16(op.ids.length);
        for (let i = 0; i < op.ids.length; i++)
            w.u32(op.ids[i]);
    }
    writeRemove(w, op) {
        w.u8(opcodes_1.OpCode.Remove);
        w.u32(op.parent);
        w.u16(op.ids.length);
        for (let i = 0; i < op.ids.length; i++)
            w.u32(op.ids[i]);
    }
    writeAttrSet(w, op) {
        w.u8(opcodes_1.OpCode.AttrSet);
        w.u32(op.node);
        this.writeAttrs(w, op.attrs);
    }
    writeAttrDel(w, op) {
        w.u8(opcodes_1.OpCode.AttrDel);
        w.u32(op.node);
        w.u16(op.names.length);
        for (let i = 0; i < op.names.length; i++)
            this.writeStrRef(w, op.names[i]);
    }
    writeTextSet(w, op) {
        w.u8(opcodes_1.OpCode.TextSet);
        w.u32(op.node);
        this.writeStrRef(w, op.value);
    }
    writeIdList(w, ids) {
        w.u16(ids.length);
        for (let i = 0; i < ids.length; i++)
            w.u32(ids[i]);
    }
    /** §4.6 — `id u32, scope u8, hostNode u32, before u32`. */
    writeSheetNew(w, op) {
        w.u8(opcodes_1.OpCode.SheetNew);
        w.u32(op.id);
        w.u8(op.scope);
        w.u32(op.hostNode);
        w.u32(op.before);
    }
    writeSheetDrop(w, op) {
        w.u8(opcodes_1.OpCode.SheetDrop);
        this.writeIdList(w, op.ids);
    }
    writeSheetOrder(w, op) {
        w.u8(opcodes_1.OpCode.SheetOrder);
        this.writeIdList(w, op.ids);
    }
    writeRuleNew(w, op) {
        w.u8(opcodes_1.OpCode.RuleNew);
        w.u32(op.sheet);
        w.u32(op.id);
        w.u32(op.before);
        this.writeStrRef(w, op.text);
    }
    writeRuleDrop(w, op) {
        w.u8(opcodes_1.OpCode.RuleDrop);
        w.u32(op.sheet);
        this.writeIdList(w, op.ids);
    }
    writeRuleSet(w, op) {
        w.u8(opcodes_1.OpCode.RuleSet);
        w.u32(op.id);
        this.writeStrRef(w, op.text);
    }
}
exports.BinaryFrameEncoder = BinaryFrameEncoder;
//# sourceMappingURL=binaryFrameEncoder.js.map