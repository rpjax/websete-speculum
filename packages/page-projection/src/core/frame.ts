/**
 * Logical instruction model — docs/page-projection/spec/frame-protocol.md §1–§4.
 * No DOM types here. This is the replicated-table wire model (NOT the old
 * dirty-set / net-effect / establish model — that layer is dead, see HANDOFF.md §13).
 *
 * String fields here are plain `string` — the persistent/frame-local `StrRef` split
 * (§1.7, bit31 discriminator) is a wire/encode concern, not a logical one. See
 * `binaryFrameEncoder.ts` (producer) / `client/decode.ts` (client) for the bit-level
 * split. v0 (this lab increment) only ever emits frame-local refs — see
 * `tableFrameBuilder.ts` for why persistent interning is deliberately deferred.
 */

import type { DomNodeKey } from './domNodeKey';
import type { ElementNs } from './elementNs';
import { NodeKind, OpCode } from './opcodes';

export { NodeKind };

/** Wire version byte. Layout can change in lab without bumping this. */
export const FRAME_WIRE_VERSION = 2 as const;

/**
 * Fixed PP prefix before the per-part string table: magic u16, version u8, flags u8,
 * contextId u32, generation u32, sequence u32, partIndex u16, partCount u16, preTableHash u64.
 */
export const FRAME_PREFIX_BYTES = 2 + 1 + 1 + 4 + 4 + 4 + 2 + 2 + 8;

/** id `1` is reserved for the Document row (frame-protocol.md §1.2). */
export const DOCUMENT_ID: DomNodeKey = 1;
/** Session-root `contextId` (OPEN-6). Nested never this value. `0` is invalid. */
export const CONTEXT_ID_ROOT = 1;
/** `before = 0` in `INSERT` means "insert at end" (§4.3). */
export const INSERT_AT_END: DomNodeKey = 0;

/** `NODE_NEW SHADOW_ROOT.mode` — open only this version (`1` closed is NIT malformed). */
export const SHADOW_MODE_OPEN = 0;
/** `initFlags` bit0 — `delegatesFocus`. */
export const SHADOW_INIT_DELEGATES_FOCUS = 0x01;
/** `initFlags` bit1 — `clonable`. */
export const SHADOW_INIT_CLONABLE = 0x02;
/** `initFlags` bit2 — `serializable`. */
export const SHADOW_INIT_SERIALIZABLE = 0x04;
/** Any `initFlags` bit outside this mask is malformed. */
export const SHADOW_INIT_FLAGS_MASK = 0x07;

export type AttrPair = { name: string; value: string };

/** §4.1 `CHECK.scope` — `Table` = whole table (`lo`/`hi` ignored), `Range` = id range `[lo, hi]`. */
export const CHECK_SCOPE_TABLE = 0;
export const CHECK_SCOPE_RANGE = 1;

/**
 * §4.1 `CHECK` — phase-1-only verification, no table/DOM effect of its own. `hash` is the
 * expected `rowHash`-sum over the scope; a mismatch is a `precondition` failure (§8) that aborts
 * the whole frame before phase 2 (§6). v0 producer only ever emits `scope: CHECK_SCOPE_TABLE`
 * (§5.8 resync's closing instruction) — `CHECK_SCOPE_RANGE` is decodable per P7 (strict, not
 * silently ignored) but OPEN-3's O(1) per-bucket partial-sum optimization for it is not yet built.
 */
export type CheckOp = {
  op: OpCode.Check;
  scope: typeof CHECK_SCOPE_TABLE | typeof CHECK_SCOPE_RANGE;
  lo: number;
  hi: number;
  hash: bigint;
};

export type EpochResetOp = { op: OpCode.EpochReset; generation: number };

/**
 * `descriptor` shape by `kind` — §4.2. Element `uri` is present only when `ns === custom`;
 * omitted on the wire otherwise. Nested-context host: `nestedHost` + `childScopeId`; omitted on
 * the wire otherwise (decode fills `false` / `null`). `SHADOW_ROOT` carries `host`/`mode`/`initFlags`.
 */
export type NodeNewOp =
  | {
      op: OpCode.NodeNew;
      id: DomNodeKey;
      kind: NodeKind.Element;
      ns: ElementNs;
      name: string;
      attrs: AttrPair[];
      uri?: string;
      /** Decode always sets this. Producer may omit (`false`). */
      nestedHost?: boolean;
      /** Decode always sets this. Producer may omit (`null`). `0`/`1` illegal when nested host. */
      childScopeId?: number | null;
    }
  | { op: OpCode.NodeNew; id: DomNodeKey; kind: NodeKind.Text | NodeKind.Comment; value: string }
  | { op: OpCode.NodeNew; id: DomNodeKey; kind: NodeKind.Doctype; name: string }
  | {
      op: OpCode.NodeNew;
      id: DomNodeKey;
      kind: NodeKind.ShadowRoot;
      host: DomNodeKey;
      mode: number;
      initFlags: number;
    };

export type InsertOp = {
  op: OpCode.Insert;
  parent: DomNodeKey;
  before: DomNodeKey;
  ids: DomNodeKey[];
};

export type RemoveOp = {
  op: OpCode.Remove;
  parent: DomNodeKey;
  ids: DomNodeKey[];
};

/**
 * §4.2 `NODE_DROP` (OPEN-1/OPEN-2, Stage 3 of frame-protocol-production-completeness) — `ids`
 * are subtree **roots** only (`parent = 0`, per its own precondition); each side independently
 * derives and drops the descendants from its own table (P0) — the wire never lists them.
 */
export type NodeDropOp = {
  op: OpCode.NodeDrop;
  ids: DomNodeKey[];
};

export type AttrSetOp = { op: OpCode.AttrSet; node: DomNodeKey; attrs: AttrPair[] };
export type AttrDelOp = { op: OpCode.AttrDel; node: DomNodeKey; names: string[] };
export type TextSetOp = { op: OpCode.TextSet; node: DomNodeKey; value: string };
/** §4.4 — `value` is string (VALUE/CUSTOM_VALIDITY), boolean (u8 flags), or number (f32). */
export type PropSetOp = {
  op: OpCode.PropSet;
  node: DomNodeKey;
  propId: number;
  value: string | boolean | number;
};

/** §4.6 `scope`: MAIN=0, PIERCE_HOST=1. Lab emits MAIN only (OPEN-6). */
export const CSSOM_SCOPE_MAIN = 0;
export const CSSOM_SCOPE_PIERCE_HOST = 1;

export type SheetNewOp = {
  op: OpCode.SheetNew;
  id: DomNodeKey;
  scope: typeof CSSOM_SCOPE_MAIN | typeof CSSOM_SCOPE_PIERCE_HOST;
  hostNode: DomNodeKey;
  before: DomNodeKey;
};

export type SheetDropOp = { op: OpCode.SheetDrop; ids: DomNodeKey[] };
export type SheetOrderOp = { op: OpCode.SheetOrder; ids: DomNodeKey[] };

export type RuleNewOp = {
  op: OpCode.RuleNew;
  sheet: DomNodeKey;
  id: DomNodeKey;
  before: DomNodeKey;
  text: string;
};

export type RuleDropOp = { op: OpCode.RuleDrop; sheet: DomNodeKey; ids: DomNodeKey[] };
export type RuleSetOp = { op: OpCode.RuleSet; id: DomNodeKey; text: string };

export type FrameOp =
  | CheckOp
  | EpochResetOp
  | NodeNewOp
  | NodeDropOp
  | InsertOp
  | RemoveOp
  | AttrSetOp
  | AttrDelOp
  | TextSetOp
  | PropSetOp
  | SheetNewOp
  | SheetDropOp
  | SheetOrderOp
  | RuleNewOp
  | RuleDropOp
  | RuleSetOp;

export type FrameFlags = {
  /** Reserved bit0 (§2) — unused until a real use appears. */
  resync: boolean;
};

/**
 * One atomic apply unit. Empty `ops` MUST NOT be emitted and MUST NOT consume a sequence.
 * `preTableHash` rides the wire header (§2) — the producer's `ReplicatedTable.tableHash` before
 * this frame's ops (`tableFrameBuilder.ts`), verified by the client before phase 1 mutates its own
 * table (`client/applyDom.ts`, frame-protocol-production-completeness Stage 2). Unchecked for
 * `resync` frames (§2 — "no prior state to check against a wholesale replace"), which instead
 * close with a trailing `CHECK` (§5.8 step 4).
 */
export type Frame = {
  version: typeof FRAME_WIRE_VERSION;
  flags: FrameFlags;
  contextId: number;
  generation: number;
  sequence: number;
  preTableHash: bigint;
  ops: FrameOp[];
};

export function createFrame(args: {
  generation: number;
  sequence: number;
  ops: FrameOp[];
  preTableHash?: bigint;
  resync?: boolean;
  contextId?: number;
}): Frame {
  const contextId = args.contextId ?? CONTEXT_ID_ROOT;
  if (contextId === 0) throw new Error('contextId 0 is invalid (frame-protocol.md §2)');
  return {
    version: FRAME_WIRE_VERSION,
    flags: { resync: args.resync ?? false },
    contextId,
    generation: args.generation,
    sequence: args.sequence,
    preTableHash: args.preTableHash ?? 0n,
    ops: args.ops,
  };
}

/** Live/resync CSSOM ops sit before a trailing `CHECK` when one is present. */
export function spliceCssomBeforeCheck(ops: FrameOp[], cssom: readonly FrameOp[]): FrameOp[] {
  if (cssom.length === 0) return ops;
  const last = ops[ops.length - 1];
  if (last !== undefined && last.op === OpCode.Check) {
    return [...ops.slice(0, -1), ...cssom, last];
  }
  return [...ops, ...cssom];
}
