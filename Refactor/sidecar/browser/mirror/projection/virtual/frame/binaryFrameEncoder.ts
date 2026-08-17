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

import { ElementNs } from '../../models/elementNs';
import { NodeKind, OpCode } from '../../models/opcodes';
import type {
  AttrPair,
  CheckOp,
  EpochResetOp,
  Frame,
  FrameOp,
  InsertOp,
  NodeDropOp,
  NodeNewOp,
  RemoveOp,
  StrDefOp,
  AttrSetOp,
  AttrDelOp,
  TextSetOp,
  SheetNewOp,
  SheetDropOp,
  SheetOrderOp,
  RuleNewOp,
  RuleDropOp,
  RuleSetOp,
} from '../../models/frame';
import type { FrameEncoder } from './frameEncoder';
import { assemblePart, BinaryWriter } from './binaryWriter';

export type { FrameEncoder };

const LOCAL_STR_BIT = 0x80000000;
/**
 * Diagnostic only — see `encodeOpsPart`. Off by default; flip on to break down a frame's bytes
 * between opcodes and the frame-local string table. Closed the 2026-08-13 "48KB first frame for
 * 34 nodes" question — root cause was Patchright's injected `<script>` tags being mirrored as
 * page content (fixed in bootstrap.ts / buildConfigPreScript.ts), not string encoding.
 */
const DEBUG_FIRST_FRAME_BYTES = false;

export type BinaryFrameEncoderOptions = {
  maxFrameBytes?: number;
};

const DEFAULT_MAX_FRAME_BYTES = 1 << 20;

export class BinaryFrameEncoder implements FrameEncoder {
  readonly maxFrameBytes: number;
  private readonly scratch = new BinaryWriter();

  constructor(opts: BinaryFrameEncoderOptions = {}) {
    this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  encode(frame: Frame): Uint8Array[] {
    if (frame.ops.length === 0) return [];

    const single = this.encodeOpsPart(frame, frame.ops, 0, 1);
    if (single.length <= this.maxFrameBytes) return [single];

    const partsOps: FrameOp[][] = [];
    let current: FrameOp[] = [];
    for (let i = 0; i < frame.ops.length; i++) {
      const trial = [...current, frame.ops[i]!];
      const trialBytes = this.encodeOpsPart(frame, trial, 0, 1);
      if (trialBytes.length > this.maxFrameBytes && current.length > 0) {
        partsOps.push(current);
        current = [frame.ops[i]!];
      } else {
        current = trial;
      }
    }
    if (current.length > 0) partsOps.push(current);

    const partCount = Math.max(1, partsOps.length);
    const out: Uint8Array[] = [];
    for (let i = 0; i < partsOps.length; i++) {
      out.push(this.encodeOpsPart(frame, partsOps[i]!, i, partCount));
    }
    return out;
  }

  private encodeOpsPart(frame: Frame, ops: FrameOp[], partIndex: number, partCount: number): Uint8Array {
    const w = this.scratch;
    w.reset();
    w.u32(ops.length);
    for (let i = 0; i < ops.length; i++) this.writeOp(w, ops[i]!);
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
      (globalThis as unknown as { __speculumDiag?: unknown[] }).__speculumDiag ??= [];
      (globalThis as unknown as { __speculumDiag: unknown[] }).__speculumDiag.push(record);
    }
    return assemblePart({
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

  private writeStrRef(w: BinaryWriter, value: string): void {
    w.u32((w.str(value) | LOCAL_STR_BIT) >>> 0);
  }

  private writeAttrs(w: BinaryWriter, attrs: AttrPair[]): void {
    w.u16(attrs.length);
    for (let i = 0; i < attrs.length; i++) {
      this.writeStrRef(w, attrs[i]!.name);
      this.writeStrRef(w, attrs[i]!.value);
    }
  }

  private writeOp(w: BinaryWriter, op: FrameOp): void {
    switch (op.op) {
      case OpCode.Check:
        return this.writeCheck(w, op);
      case OpCode.EpochReset:
        return this.writeEpochReset(w, op);
      case OpCode.StrDef:
        return this.writeStrDef(w, op);
      case OpCode.NodeNew:
        return this.writeNodeNew(w, op);
      case OpCode.NodeDrop:
        return this.writeNodeDrop(w, op);
      case OpCode.Insert:
        return this.writeInsert(w, op);
      case OpCode.Remove:
        return this.writeRemove(w, op);
      case OpCode.AttrSet:
        return this.writeAttrSet(w, op);
      case OpCode.AttrDel:
        return this.writeAttrDel(w, op);
      case OpCode.TextSet:
        return this.writeTextSet(w, op);
      case OpCode.SheetNew:
        return this.writeSheetNew(w, op);
      case OpCode.SheetDrop:
        return this.writeSheetDrop(w, op);
      case OpCode.SheetOrder:
        return this.writeSheetOrder(w, op);
      case OpCode.RuleNew:
        return this.writeRuleNew(w, op);
      case OpCode.RuleDrop:
        return this.writeRuleDrop(w, op);
      case OpCode.RuleSet:
        return this.writeRuleSet(w, op);
      default:
        throw new Error(`BinaryFrameEncoder: unsupported op ${String((op as FrameOp).op)}`);
    }
  }

  /** §4.1 — `scope u8, lo u32, hi u32, hash u64`. Fixed-width, no varints (P5). */
  private writeCheck(w: BinaryWriter, op: CheckOp): void {
    w.u8(OpCode.Check);
    w.u8(op.scope);
    w.u32(op.lo);
    w.u32(op.hi);
    w.u64(op.hash);
  }

  private writeEpochReset(w: BinaryWriter, op: EpochResetOp): void {
    w.u8(OpCode.EpochReset);
    w.u32(op.generation);
  }

  /** Persistent `STR_DEF` bytes are raw (this instruction IS the definition), never interned. */
  private writeStrDef(w: BinaryWriter, op: StrDefOp): void {
    w.u8(OpCode.StrDef);
    w.u32(op.strId);
    w.utf8Raw(op.value);
  }

  private writeNodeNew(w: BinaryWriter, op: NodeNewOp): void {
    w.u8(OpCode.NodeNew);
    w.u32(op.id);
    w.u8(op.kind);
    if (op.kind === NodeKind.Element) {
      w.u8(op.ns);
      if (op.ns === ElementNs.Custom) {
        const uri = op.uri ?? '';
        if (uri.length === 0) {
          throw new Error('NODE_NEW custom ns requires a non-empty uri (frame-protocol.md §4.2)');
        }
        this.writeStrRef(w, uri);
      }
      this.writeStrRef(w, op.name);
      this.writeAttrs(w, op.attrs);
      return;
    }
    if (op.kind === NodeKind.Doctype) {
      this.writeStrRef(w, op.name);
      return;
    }
    this.writeStrRef(w, op.value);
  }

  /** §4.2 — `count: u16, ids: u32[]`; roots only, descendants derived independently on both sides. */
  private writeNodeDrop(w: BinaryWriter, op: NodeDropOp): void {
    w.u8(OpCode.NodeDrop);
    w.u16(op.ids.length);
    for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]!);
  }

  private writeInsert(w: BinaryWriter, op: InsertOp): void {
    w.u8(OpCode.Insert);
    w.u32(op.parent);
    w.u32(op.before);
    w.u16(op.ids.length);
    for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]!);
  }

  private writeRemove(w: BinaryWriter, op: RemoveOp): void {
    w.u8(OpCode.Remove);
    w.u32(op.parent);
    w.u16(op.ids.length);
    for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]!);
  }

  private writeAttrSet(w: BinaryWriter, op: AttrSetOp): void {
    w.u8(OpCode.AttrSet);
    w.u32(op.node);
    this.writeAttrs(w, op.attrs);
  }

  private writeAttrDel(w: BinaryWriter, op: AttrDelOp): void {
    w.u8(OpCode.AttrDel);
    w.u32(op.node);
    w.u16(op.names.length);
    for (let i = 0; i < op.names.length; i++) this.writeStrRef(w, op.names[i]!);
  }

  private writeTextSet(w: BinaryWriter, op: TextSetOp): void {
    w.u8(OpCode.TextSet);
    w.u32(op.node);
    this.writeStrRef(w, op.value);
  }

  private writeIdList(w: BinaryWriter, ids: readonly number[]): void {
    w.u16(ids.length);
    for (let i = 0; i < ids.length; i++) w.u32(ids[i]!);
  }

  /** §4.6 — `id u32, scope u8, hostNode u32, before u32`. */
  private writeSheetNew(w: BinaryWriter, op: SheetNewOp): void {
    w.u8(OpCode.SheetNew);
    w.u32(op.id);
    w.u8(op.scope);
    w.u32(op.hostNode);
    w.u32(op.before);
  }

  private writeSheetDrop(w: BinaryWriter, op: SheetDropOp): void {
    w.u8(OpCode.SheetDrop);
    this.writeIdList(w, op.ids);
  }

  private writeSheetOrder(w: BinaryWriter, op: SheetOrderOp): void {
    w.u8(OpCode.SheetOrder);
    this.writeIdList(w, op.ids);
  }

  private writeRuleNew(w: BinaryWriter, op: RuleNewOp): void {
    w.u8(OpCode.RuleNew);
    w.u32(op.sheet);
    w.u32(op.id);
    w.u32(op.before);
    this.writeStrRef(w, op.text);
  }

  private writeRuleDrop(w: BinaryWriter, op: RuleDropOp): void {
    w.u8(OpCode.RuleDrop);
    w.u32(op.sheet);
    this.writeIdList(w, op.ids);
  }

  private writeRuleSet(w: BinaryWriter, op: RuleSetOp): void {
    w.u8(OpCode.RuleSet);
    w.u32(op.id);
    this.writeStrRef(w, op.text);
  }
}
