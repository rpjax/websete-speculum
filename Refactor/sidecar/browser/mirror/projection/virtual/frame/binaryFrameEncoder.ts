/**
 * FrameEncoder impl — Frame → wire part bytes (§5.5).
 * Layout matches web `decode.ts` (i32 scrolls, patch = id + snapshot without id).
 */

import { OpCode } from '../../models/opcodes';
import type {
  ChildListOp,
  DocumentStateOp,
  DomNodeSnapshot,
  EstablishBeginOp,
  EstablishChunkOp,
  EstablishEndOp,
  Frame,
  FrameOp,
  PatchOp,
  ScrollElementOp,
  ScrollViewportOp,
} from '../../models/frame';
import type { FrameEncoder } from './frameEncoder';
import { assemblePart, BinaryWriter } from './binaryWriter';

export type { FrameEncoder };

const NODE_KIND_ELEMENT = 1;
const NODE_KIND_TEXT = 2;
const NODE_KIND_COMMENT = 3;

const CHILD_EXISTING = 0;
const CHILD_FRESH = 1;

const MODE_FULL = 0;
const MODE_APPEND = 1;

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

  private encodeOpsPart(
    frame: Frame,
    ops: FrameOp[],
    partIndex: number,
    partCount: number,
  ): Uint8Array {
    const w = this.scratch;
    w.reset();
    w.u32(ops.length);
    for (let i = 0; i < ops.length; i++) {
      this.writeOp(w, ops[i]!);
    }
    const flags =
      (frame.flags.establish ? 1 : 0) | (frame.flags.resync ? 2 : 0);
    return assemblePart({
      version: frame.version,
      flags,
      generation: frame.generation,
      sequence: frame.sequence,
      partIndex,
      partCount,
      stringTable: w.takeStringTableBytes(),
      opsBody: w.bytesSoFar().slice(),
    });
  }

  private writeOp(w: BinaryWriter, op: FrameOp): void {
    switch (op.op) {
      case OpCode.EstablishBegin:
        this.writeEstablishBegin(w, op);
        return;
      case OpCode.EstablishChunk:
        this.writeEstablishChunk(w, op);
        return;
      case OpCode.EstablishEnd:
        this.writeEstablishEnd(w, op);
        return;
      case OpCode.DocumentState:
        this.writeDocumentState(w, op);
        return;
      case OpCode.ChildList:
        this.writeChildList(w, op);
        return;
      case OpCode.Patch:
        this.writePatch(w, op);
        return;
      case OpCode.ScrollViewport:
        this.writeScrollViewport(w, op);
        return;
      case OpCode.ScrollElement:
        this.writeScrollElement(w, op);
        return;
      default:
        throw new Error(`BinaryFrameEncoder: unsupported op ${String((op as FrameOp).op)}`);
    }
  }

  private writeEstablishBegin(w: BinaryWriter, op: EstablishBeginOp): void {
    w.u8(OpCode.EstablishBegin);
    w.u32(op.generation);
    w.u32(op.viewportWidth);
    w.u32(op.viewportHeight);
    w.i32(Math.trunc(op.scrollX));
    w.i32(Math.trunc(op.scrollY));
    w.u32(op.scrollElements.length);
    for (let i = 0; i < op.scrollElements.length; i++) {
      const s = op.scrollElements[i]!;
      w.u32(s.node);
      w.i32(Math.trunc(s.scrollTop));
      w.i32(Math.trunc(s.scrollLeft));
    }
  }

  private writeEstablishChunk(w: BinaryWriter, op: EstablishChunkOp): void {
    w.u8(OpCode.EstablishChunk);
    w.utf8Raw(op.html);
  }

  private writeEstablishEnd(w: BinaryWriter, op: EstablishEndOp): void {
    w.u8(OpCode.EstablishEnd);
    w.u32(op.nodeCount);
    w.u32(op.checksum >>> 0);
  }

  private writeDocumentState(w: BinaryWriter, op: DocumentStateOp): void {
    w.u8(OpCode.DocumentState);
    w.u32(w.str(op.title));
    this.writeNullableString(w, op.lang);
    this.writeNullableString(w, op.dir);
    this.writeNullableString(w, op.viewportContent);
  }

  private writeNullableString(w: BinaryWriter, value: string | null): void {
    if (value === null) {
      w.u8(0);
      return;
    }
    w.u8(1);
    w.u32(w.str(value));
  }

  private writeChildList(w: BinaryWriter, op: ChildListOp): void {
    w.u8(OpCode.ChildList);
    w.u32(op.parent);
    w.u8(op.mode === 'append' ? MODE_APPEND : MODE_FULL);
    w.u32(op.children.length);
    for (let i = 0; i < op.children.length; i++) {
      const ref = op.children[i]!;
      if (ref.kind === 'existing') {
        w.u8(CHILD_EXISTING);
        w.u32(ref.key);
      } else {
        w.u8(CHILD_FRESH);
        const snap = op.freshSnapshots?.get(ref.key);
        if (snap === undefined) {
          throw new Error(`BinaryFrameEncoder: missing fresh snapshot for key ${ref.key}`);
        }
        this.writeNode(w, snap);
      }
    }
  }

  private writePatch(w: BinaryWriter, op: PatchOp): void {
    w.u8(OpCode.Patch);
    w.u32(op.node);
    this.writePatchSnapshot(w, op.snapshot);
  }

  private writePatchSnapshot(w: BinaryWriter, snap: DomNodeSnapshot): void {
    if (snap.kind === 'element') {
      w.u8(NODE_KIND_ELEMENT);
      w.u32(w.str(snap.tag));
      w.u16(snap.attrs.length);
      for (let i = 0; i < snap.attrs.length; i++) {
        const a = snap.attrs[i]!;
        w.u32(w.str(a.name));
        w.u32(w.str(a.value));
      }
      return;
    }
    if (snap.kind === 'text') {
      w.u8(NODE_KIND_TEXT);
      w.u32(w.str(snap.value));
      return;
    }
    w.u8(NODE_KIND_COMMENT);
    w.u32(w.str(snap.value));
  }

  private writeScrollViewport(w: BinaryWriter, op: ScrollViewportOp): void {
    w.u8(OpCode.ScrollViewport);
    w.i32(Math.trunc(op.scrollX));
    w.i32(Math.trunc(op.scrollY));
  }

  private writeScrollElement(w: BinaryWriter, op: ScrollElementOp): void {
    w.u8(OpCode.ScrollElement);
    w.u32(op.node);
    w.i32(Math.trunc(op.scrollTop));
    w.i32(Math.trunc(op.scrollLeft));
  }

  private writeNode(w: BinaryWriter, snap: DomNodeSnapshot): void {
    if (snap.kind === 'element') {
      w.u8(NODE_KIND_ELEMENT);
      w.u32(snap.key);
      w.u32(w.str(snap.tag));
      w.u16(snap.attrs.length);
      for (let i = 0; i < snap.attrs.length; i++) {
        const a = snap.attrs[i]!;
        w.u32(w.str(a.name));
        w.u32(w.str(a.value));
      }
      const children = snap.children ?? [];
      w.u32(children.length);
      for (let i = 0; i < children.length; i++) {
        this.writeNode(w, children[i]!);
      }
      return;
    }
    if (snap.kind === 'text') {
      w.u8(NODE_KIND_TEXT);
      w.u32(snap.key);
      w.u32(w.str(snap.value));
      return;
    }
    w.u8(NODE_KIND_COMMENT);
    w.u32(snap.key);
    w.u32(w.str(snap.value));
  }
}
