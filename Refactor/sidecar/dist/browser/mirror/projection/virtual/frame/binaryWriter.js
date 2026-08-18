"use strict";
/**
 * Growable little-endian binary writer with per-part string table (§5.5).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryWriter = void 0;
exports.assemblePart = assemblePart;
class BinaryWriter {
    buf;
    view;
    offset = 0;
    strings = [];
    stringIndex = new Map();
    textEncoder = new TextEncoder();
    constructor(initialCapacity = 4096) {
        this.buf = new Uint8Array(initialCapacity);
        this.view = new DataView(this.buf.buffer);
    }
    get length() {
        return this.offset;
    }
    reset() {
        this.offset = 0;
        this.strings.length = 0;
        this.stringIndex.clear();
    }
    ensure(extra) {
        const need = this.offset + extra;
        if (need <= this.buf.length)
            return;
        let cap = this.buf.length || 4096;
        while (cap < need)
            cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(0, this.offset));
        this.buf = next;
        this.view = new DataView(this.buf.buffer);
    }
    u8(v) {
        this.ensure(1);
        this.buf[this.offset++] = v & 0xff;
    }
    u16(v) {
        this.ensure(2);
        this.view.setUint16(this.offset, v >>> 0, true);
        this.offset += 2;
    }
    u32(v) {
        this.ensure(4);
        this.view.setUint32(this.offset, v >>> 0, true);
        this.offset += 4;
    }
    i32(v) {
        this.ensure(4);
        this.view.setInt32(this.offset, v | 0, true);
        this.offset += 4;
    }
    /** Raw UTF-8 bytes (establishChunk) — not string-table interned. */
    utf8Raw(value) {
        const b = this.textEncoder.encode(value);
        this.u32(b.length);
        this.ensure(b.length);
        this.buf.set(b, this.offset);
        this.offset += b.length;
    }
    f32(v) {
        this.ensure(4);
        this.view.setFloat32(this.offset, v, true);
        this.offset += 4;
    }
    f64(v) {
        this.ensure(8);
        this.view.setFloat64(this.offset, v, true);
        this.offset += 8;
    }
    u64(v) {
        this.ensure(8);
        this.view.setBigUint64(this.offset, v, true);
        this.offset += 8;
    }
    /** Intern string; returns index. */
    str(value) {
        const existing = this.stringIndex.get(value);
        if (existing !== undefined)
            return existing;
        const idx = this.strings.length;
        this.strings.push(value);
        this.stringIndex.set(value, idx);
        return idx;
    }
    bytesSoFar() {
        return this.buf.subarray(0, this.offset);
    }
    /** Diagnostic only — frame-protocol.md decision-log entry, 2026-08-13 "48KB first-frame". */
    debugStrings() {
        return this.strings;
    }
    takeStringTableBytes() {
        const enc = this.textEncoder;
        let size = 4;
        const encoded = [];
        for (let i = 0; i < this.strings.length; i++) {
            const b = enc.encode(this.strings[i]);
            encoded.push(b);
            size += 4 + b.length;
        }
        const out = new Uint8Array(size);
        const view = new DataView(out.buffer);
        let o = 0;
        view.setUint32(o, this.strings.length, true);
        o += 4;
        for (let i = 0; i < encoded.length; i++) {
            const b = encoded[i];
            view.setUint32(o, b.length, true);
            o += 4;
            out.set(b, o);
            o += b.length;
        }
        return out;
    }
}
exports.BinaryWriter = BinaryWriter;
/**
 * One wire part — frame-protocol.md §2 header + per-part string table + ops body
 * (ops body starts with opCount). `preTableHash` is unchecked in v0 (always `0n` on the
 * wire) — see `virtual/dom/tableFrameBuilder.ts` header comment.
 */
function assemblePart(args) {
    const headerSize = 2 + 1 + 1 + 4 + 4 + 2 + 2 + 8;
    const out = new Uint8Array(headerSize + args.stringTable.length + args.opsBody.length);
    const view = new DataView(out.buffer);
    let o = 0;
    view.setUint16(o, 0x5050, true); // 'PP'
    o += 2;
    out[o++] = args.version & 0xff;
    out[o++] = args.flags & 0xff;
    view.setUint32(o, args.generation >>> 0, true);
    o += 4;
    view.setUint32(o, args.sequence >>> 0, true);
    o += 4;
    view.setUint16(o, args.partIndex, true);
    o += 2;
    view.setUint16(o, args.partCount, true);
    o += 2;
    view.setBigUint64(o, args.preTableHash, true);
    o += 8;
    out.set(args.stringTable, o);
    o += args.stringTable.length;
    out.set(args.opsBody, o);
    return out;
}
//# sourceMappingURL=binaryWriter.js.map