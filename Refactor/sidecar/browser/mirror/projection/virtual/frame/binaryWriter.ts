/**
 * Growable little-endian binary writer with per-part string table (§5.5).
 */

export class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;
  private readonly strings: string[] = [];
  private readonly stringIndex = new Map<string, number>();
  private readonly textEncoder = new TextEncoder();

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.offset;
  }

  reset(): void {
    this.offset = 0;
    this.strings.length = 0;
    this.stringIndex.clear();
  }

  private ensure(extra: number): void {
    const need = this.offset + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length || 4096;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.offset));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.offset++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, v >>> 0, true);
    this.offset += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, v | 0, true);
    this.offset += 4;
  }

  /** Raw UTF-8 bytes (establishChunk) — not string-table interned. */
  utf8Raw(value: string): void {
    const b = this.textEncoder.encode(value);
    this.u32(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.offset);
    this.offset += b.length;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
  }

  u64(v: bigint): void {
    this.ensure(8);
    this.view.setBigUint64(this.offset, v, true);
    this.offset += 8;
  }

  /** Intern string; returns index. */
  str(value: string): number {
    const existing = this.stringIndex.get(value);
    if (existing !== undefined) return existing;
    const idx = this.strings.length;
    this.strings.push(value);
    this.stringIndex.set(value, idx);
    return idx;
  }

  bytesSoFar(): Uint8Array {
    return this.buf.subarray(0, this.offset);
  }

  /** Diagnostic only — frame-protocol.md decision-log entry, 2026-08-13 "48KB first-frame". */
  debugStrings(): readonly string[] {
    return this.strings;
  }

  takeStringTableBytes(): Uint8Array {
    const enc = this.textEncoder;
    let size = 4;
    const encoded: Uint8Array[] = [];
    for (let i = 0; i < this.strings.length; i++) {
      const b = enc.encode(this.strings[i]!);
      encoded.push(b);
      size += 4 + b.length;
    }
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let o = 0;
    view.setUint32(o, this.strings.length, true);
    o += 4;
    for (let i = 0; i < encoded.length; i++) {
      const b = encoded[i]!;
      view.setUint32(o, b.length, true);
      o += 4;
      out.set(b, o);
      o += b.length;
    }
    return out;
  }
}

/**
 * One wire part — frame-protocol.md §2 header + per-part string table + ops body
 * (ops body starts with opCount). `preTableHash` is unchecked in v0 (always `0n` on the
 * wire) — see tableFrameBuilder.ts header comment.
 */
export function assemblePart(args: {
  version: number;
  flags: number;
  generation: number;
  sequence: number;
  partIndex: number;
  partCount: number;
  preTableHash: bigint;
  stringTable: Uint8Array;
  opsBody: Uint8Array;
}): Uint8Array {
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
