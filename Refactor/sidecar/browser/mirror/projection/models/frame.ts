/**
 * Logical frame model (parent §5.4–5.5) — structured ops before binary encode.
 * No DOM types here.
 */

import type { DomNodeKey } from './domNodeKey';
import { OpCode } from './opcodes';

export const FRAME_WIRE_VERSION = 1 as const;

export type FrameFlags = {
  establish: boolean;
  resync: boolean;
};

/** Existing published node vs first-time publish in this frame. */
export type ChildRef =
  | { kind: 'existing'; key: DomNodeKey }
  | { kind: 'fresh'; key: DomNodeKey };

export type ChildListMode = 'full' | 'append';
/** Flush-time node snapshot for `patch` / fresh child payloads — filled by builder. */
export type DomNodeSnapshot =
  | {
      kind: 'element';
      key: DomNodeKey;
      tag: string;
      attrs: ReadonlyArray<{ name: string; value: string }>;
      /** Nested F-visible children — only on fresh childList payloads, never on patch. */
      children?: ReadonlyArray<DomNodeSnapshot>;
    }
  | { kind: 'text'; key: DomNodeKey; value: string }
  | { kind: 'comment'; key: DomNodeKey; value: string };

export type EstablishScrollElement = {
  node: DomNodeKey;
  scrollTop: number;
  scrollLeft: number;
};

export type EstablishBeginOp = {
  op: OpCode.EstablishBegin;
  generation: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  scrollElements: EstablishScrollElement[];
};

export type EstablishChunkOp = {
  op: OpCode.EstablishChunk;
  html: string;
};

export type EstablishEndOp = {
  op: OpCode.EstablishEnd;
  nodeCount: number;
  checksum: number;
};

export type DocumentStateOp = {
  op: OpCode.DocumentState;
  title: string;
  lang: string | null;
  dir: string | null;
  viewportContent: string | null;
};

export type ChildListOp = {
  op: OpCode.ChildList;
  parent: DomNodeKey;
  mode: ChildListMode;
  children: ChildRef[];
  /** Fresh nodes' snapshots (builder fills; encoder reads). */
  freshSnapshots?: ReadonlyMap<DomNodeKey, DomNodeSnapshot>;
};

export type PatchOp = {
  op: OpCode.Patch;
  node: DomNodeKey;
  snapshot: DomNodeSnapshot;
};

export type ScrollViewportOp = {
  op: OpCode.ScrollViewport;
  scrollX: number;
  scrollY: number;
};

export type ScrollElementOp = {
  op: OpCode.ScrollElement;
  node: DomNodeKey;
  scrollTop: number;
  scrollLeft: number;
};

export type FrameOp =
  | EstablishBeginOp
  | EstablishChunkOp
  | EstablishEndOp
  | DocumentStateOp
  | ChildListOp
  | PatchOp
  | ScrollViewportOp
  | ScrollElementOp;

/**
 * One atomic apply unit. Empty `ops` MUST NOT be emitted and MUST NOT consume
 * a sequence (E-02 / §5.3.3) — except establish frames which always carry ops.
 */
export type Frame = {
  version: typeof FRAME_WIRE_VERSION;
  flags: FrameFlags;
  generation: number;
  sequence: number;
  ops: FrameOp[];
};

export function createLiveFrame(args: {
  generation: number;
  sequence: number;
  ops: FrameOp[];
}): Frame {
  return {
    version: FRAME_WIRE_VERSION,
    flags: { establish: false, resync: false },
    generation: args.generation,
    sequence: args.sequence,
    ops: args.ops,
  };
}

export function createEstablishFrame(args: {
  generation: number;
  sequence: number;
  ops: FrameOp[];
  resync?: boolean;
}): Frame {
  return {
    version: FRAME_WIRE_VERSION,
    flags: { establish: true, resync: args.resync ?? false },
    generation: args.generation,
    sequence: args.sequence,
    ops: args.ops,
  };
}
