import type { ChildRef, FrameOp } from './frame';
import type { CssomOp, CssomRuleDescriptor, CssomSheetDescriptor } from './cssom';
import type { FNode } from './fmap';
import type { EstablishBeginPayload } from './establish';
import { OpCode } from './opcodes';

/**
 * §5.5 — the binary wire format. One reusable growable buffer, little-endian,
 * a per-part deduplicated string table, no `JSON.stringify`/`JSON.parse`
 * anywhere on this path (PP-WIRE-3).
 */

/** §5.6 establish ops — wire-encodes the payload/checksum shapes from `establish.ts`. */
export type EstablishBeginOp = { op: 'establishBegin'; payload: EstablishBeginPayload };
export type EstablishChunkOp = { op: 'establishChunk'; bytes: Uint8Array };
export type EstablishEndOp = { op: 'establishEnd'; nodeCount: number; checksum: number };
export type EstablishOp = EstablishBeginOp | EstablishChunkOp | EstablishEndOp;

/** §5.2.6 — carries `<title>`, `documentElement.lang`/`.dir` and `meta[viewport].content`; `null` means absent. */
export type DocumentStateOp = {
  op: 'documentState';
  title: string;
  lang: string | null;
  dir: string | null;
  viewportContent: string | null;
};

export type WireOp = FrameOp | CssomOp | EstablishOp | DocumentStateOp;

export type EncodedFrameMeta = {
  generation: number;
  sequence: number;
  establish?: boolean;
  resync?: boolean;
};

const MAGIC = 0x5050; // 'PP'
const VERSION = 1;
export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
/** magic + version + flags + generation + sequence + partIndex + partCount + strCount + opCount */
const HEADER_BYTES = 2 + 1 + 1 + 4 + 4 + 2 + 2 + 4 + 4;

class GrowableBuffer {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private length = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new ArrayBuffer(Math.max(initialCapacity, 16));
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(this.bytes.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  writeU8(v: number): void { this.ensure(1); this.view.setUint8(this.length, v); this.length += 1; }
  writeU16(v: number): void { this.ensure(2); this.view.setUint16(this.length, v, true); this.length += 2; }
  writeU32(v: number): void { this.ensure(4); this.view.setUint32(this.length, v, true); this.length += 4; }
  writeI32(v: number): void { this.ensure(4); this.view.setInt32(this.length, v, true); this.length += 4; }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength);
    this.bytes.set(bytes, this.length);
    this.length += bytes.byteLength;
  }

  get byteLength(): number { return this.length; }
  toUint8Array(): Uint8Array { return this.bytes.slice(0, this.length); }
}

class StringTable {
  private readonly indexByValue = new Map<string, number>();
  private readonly values: string[] = [];

  intern(value: string): number {
    const existing = this.indexByValue.get(value);
    if (existing !== undefined) return existing;
    const idx = this.values.length;
    this.indexByValue.set(value, idx);
    this.values.push(value);
    return idx;
  }

  estimateBytes(): number {
    let total = 0;
    for (const v of this.values) total += 4 + Buffer.byteLength(v, 'utf8');
    return total;
  }

  writeTo(buf: GrowableBuffer): void {
    buf.writeU32(this.values.length);
    for (const v of this.values) {
      const bytes = Buffer.from(v, 'utf8');
      buf.writeU32(bytes.byteLength);
      buf.writeBytes(bytes);
    }
  }
}

function opCodeOf(op: WireOp): OpCode {
  switch (op.op) {
    case 'childList': return OpCode.ChildList;
    case 'patch': return OpCode.Patch;
    case 'scrollViewport': return OpCode.ScrollViewport;
    case 'scrollElement': return OpCode.ScrollElement;
    case 'cssomInstall': return OpCode.CssomInstall;
    case 'cssomSheetList': return OpCode.CssomSheetList;
    case 'cssomRuleList': return OpCode.CssomRuleList;
    case 'cssomPatch': return OpCode.CssomPatch;
    case 'establishBegin': return OpCode.EstablishBegin;
    case 'establishChunk': return OpCode.EstablishChunk;
    case 'establishEnd': return OpCode.EstablishEnd;
    case 'documentState': return OpCode.DocumentState;
    default: {
      const exhaustive: never = op;
      throw new Error(`encodeFrame: unknown op ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Element head shared by the recursive `Node` wire shape and the shallow `patch` shape (§5.4.1/§5.5). */
function writeElementHead(buf: GrowableBuffer, table: StringTable, tag: string, attrs: Record<string, string>): void {
  buf.writeU32(table.intern(tag));
  const entries = Object.entries(attrs);
  buf.writeU16(entries.length);
  for (const [name, value] of entries) {
    buf.writeU32(table.intern(name));
    buf.writeU32(table.intern(value));
  }
}

/** §5.5 `Node` — preorder, self-delimiting, full recursive children (used by `childList`'s `fresh` entries). */
function writeNode(buf: GrowableBuffer, table: StringTable, node: FNode): void {
  if (node.kind === 'element') {
    buf.writeU8(0);
    buf.writeU32(node.id);
    writeElementHead(buf, table, node.tag, node.attrs);
    buf.writeU32(node.children.length);
    for (const child of node.children) writeNode(buf, table, child);
    return;
  }
  buf.writeU8(node.kind === 'text' ? 1 : 2);
  buf.writeU32(node.id);
  buf.writeU32(table.intern(node.value));
}

function writeChildRef(buf: GrowableBuffer, table: StringTable, ref: ChildRef): void {
  if (ref.kind === 'existing') {
    buf.writeU8(0);
    buf.writeU32(ref.id);
  } else {
    buf.writeU8(1);
    writeNode(buf, table, ref.node);
  }
}

/** §5.4.1 — `patch` carries the flush-time snapshot with no children, ever. */
function writePatchSnapshot(buf: GrowableBuffer, table: StringTable, node: FNode): void {
  if (node.kind === 'element') {
    buf.writeU8(0);
    writeElementHead(buf, table, node.tag, node.attrs);
    return;
  }
  buf.writeU8(node.kind === 'text' ? 1 : 2);
  buf.writeU32(table.intern(node.value));
}

function writeSheet(buf: GrowableBuffer, table: StringTable, sheet: CssomSheetDescriptor): void {
  // Always write hostId (0 for main) so decodeSheet can read a fixed layout.
  buf.writeU32(sheet.id);
  if (sheet.scope.kind === 'main') {
    buf.writeU8(0);
    buf.writeU32(0);
  } else {
    buf.writeU8(1);
    buf.writeU32(sheet.scope.hostId);
  }
  buf.writeU32(sheet.rules.length);
  for (const rule of sheet.rules) writeRule(buf, table, rule);
}

function writeRule(buf: GrowableBuffer, table: StringTable, rule: CssomRuleDescriptor): void {
  buf.writeU32(rule.id);
  buf.writeU32(table.intern(rule.cssText));
}

/** Presence byte + interned index — `null` (absent) never allocates a string-table slot. */
function writeNullableString(buf: GrowableBuffer, table: StringTable, value: string | null): void {
  if (value === null) {
    buf.writeU8(0);
    return;
  }
  buf.writeU8(1);
  buf.writeU32(table.intern(value));
}

function writeOp(buf: GrowableBuffer, table: StringTable, op: WireOp): void {
  buf.writeU8(opCodeOf(op));
  switch (op.op) {
    case 'childList':
      buf.writeU32(op.parent);
      buf.writeU8(op.mode === 'full' ? 0 : 1);
      buf.writeU32(op.children.length);
      for (const child of op.children) writeChildRef(buf, table, child);
      return;
    case 'patch':
      buf.writeU32(op.node);
      writePatchSnapshot(buf, table, op.snapshot);
      return;
    case 'scrollViewport':
      buf.writeI32(op.x);
      buf.writeI32(op.y);
      return;
    case 'scrollElement':
      buf.writeU32(op.node);
      buf.writeI32(op.top);
      buf.writeI32(op.left);
      return;
    case 'cssomInstall':
      buf.writeU32(op.sheets.length);
      for (const sheet of op.sheets) writeSheet(buf, table, sheet);
      return;
    case 'cssomSheetList':
      buf.writeU32(op.removed.length);
      for (const id of op.removed) buf.writeU32(id);
      buf.writeU32(op.added.length);
      for (const a of op.added) { buf.writeU32(a.index); writeSheet(buf, table, a.sheet); }
      return;
    case 'cssomRuleList':
      buf.writeU32(op.sheet);
      buf.writeU32(op.removed.length);
      for (const id of op.removed) buf.writeU32(id);
      buf.writeU32(op.added.length);
      for (const a of op.added) { buf.writeU32(a.index); writeRule(buf, table, a.rule); }
      return;
    case 'cssomPatch':
      buf.writeU32(op.rule);
      buf.writeU32(table.intern(op.cssText));
      return;
    case 'establishBegin':
      buf.writeU32(op.payload.generation);
      buf.writeU32(op.payload.viewport.width);
      buf.writeU32(op.payload.viewport.height);
      buf.writeI32(op.payload.scrollViewport.x);
      buf.writeI32(op.payload.scrollViewport.y);
      buf.writeU32(op.payload.scrollElements.length);
      for (const el of op.payload.scrollElements) {
        buf.writeU32(el.node);
        buf.writeI32(el.top);
        buf.writeI32(el.left);
      }
      return;
    case 'establishChunk':
      buf.writeU32(op.bytes.byteLength);
      buf.writeBytes(op.bytes);
      return;
    case 'establishEnd':
      buf.writeU32(op.nodeCount);
      buf.writeU32(op.checksum);
      return;
    case 'documentState':
      buf.writeU32(table.intern(op.title));
      writeNullableString(buf, table, op.lang);
      writeNullableString(buf, table, op.dir);
      writeNullableString(buf, table, op.viewportContent);
      return;
    default: {
      const exhaustive: never = op;
      throw new Error(`encodeFrame: unknown op ${JSON.stringify(exhaustive)}`);
    }
  }
}

function estimateOpBytes(op: WireOp): number {
  const scratch = new GrowableBuffer(256);
  const table = new StringTable();
  writeOp(scratch, table, op);
  return scratch.byteLength + table.estimateBytes();
}

/** §5.3.5.5 — a frame exceeding `maxFrameBytes` is split into parts, never dropped (PP-FR-8). */
function groupOpsByBudget(ops: readonly WireOp[], maxFrameBytes: number): WireOp[][] {
  const groups: WireOp[][] = [];
  let current: WireOp[] = [];
  let currentBytes = HEADER_BYTES;
  for (const op of ops) {
    const opBytes = estimateOpBytes(op);
    if (current.length > 0 && currentBytes + opBytes > maxFrameBytes) {
      groups.push(current);
      current = [];
      currentBytes = HEADER_BYTES;
    }
    current.push(op);
    currentBytes += opBytes;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups;
}

function flagsOf(meta: EncodedFrameMeta): number {
  return (meta.establish ? 0b01 : 0) | (meta.resync ? 0b10 : 0);
}

function encodePart(ops: readonly WireOp[], meta: EncodedFrameMeta, partIndex: number, partCount: number): Uint8Array {
  const table = new StringTable();
  const opBuf = new GrowableBuffer(4096);
  for (const op of ops) writeOp(opBuf, table, op);

  const out = new GrowableBuffer(HEADER_BYTES + opBuf.byteLength + 1024);
  out.writeU16(MAGIC);
  out.writeU8(VERSION);
  out.writeU8(flagsOf(meta));
  out.writeU32(meta.generation);
  out.writeU32(meta.sequence);
  out.writeU16(partIndex);
  out.writeU16(partCount);
  table.writeTo(out);
  out.writeU32(ops.length);
  out.writeBytes(opBuf.toUint8Array());
  return out.toUint8Array();
}

/**
 * Encodes `ops` as one frame, split into as many parts as `maxFrameBytes`
 * requires. All parts share `generation`/`sequence`; atomicity is preserved
 * by the client applying the assembled frame only once every part has
 * arrived (§5.5.3).
 */
export function encodeFrame(
  ops: readonly WireOp[],
  meta: EncodedFrameMeta,
  maxFrameBytes: number = DEFAULT_MAX_FRAME_BYTES,
): Uint8Array[] {
  const groups = groupOpsByBudget(ops, maxFrameBytes);
  const partCount = groups.length;
  return groups.map((group, partIndex) => encodePart(group, meta, partIndex, partCount));
}
