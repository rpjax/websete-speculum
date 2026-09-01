/**
 * D-SPEC-7 — Node rewrite hop: decode → rewrite URL strings → rehash CHECK/preTableHash → re-encode.
 *
 * Rewriting attr/CSS URL strings changes `contentHash`. Emitting the producer's original
 * `preTableHash`/`CHECK` would desync every client. After rewrite we apply into a session-scoped
 * sidecar `ReplicatedTable` and stamp hashes that match the rewritten ops.
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  peekFrameHeader,
  type DecodedFramePart,
} from '@speculum/page-projection/core/decode';
import {
  CHECK_SCOPE_RANGE,
  FRAME_WIRE_VERSION,
  type AttrPair,
  type CheckOp,
  type Frame,
  type FrameOp,
} from '@speculum/page-projection/core/frame';
import { NodeKind, OpCode } from '@speculum/page-projection/core/opcodes';
import { ReplicatedTable } from '@speculum/page-projection/core/replicatedTable';
import { applyOpToTable } from '@speculum/page-projection/core/replicatedTableApply';
import { BinaryFrameEncoder } from '@speculum/page-projection/virtual/frame/binaryFrameEncoder';
import type { AssetStore } from './AssetStore';
import {
  rewriteAttrValue,
  rewriteCssText,
  URL_ATTR_NAMES,
  type RewriteUrlResult,
} from './urlForms';

export type RewritePartContext = {
  pageUrl: string;
  assets: AssetStore;
};

function evaluateCheck(table: ReplicatedTable, op: CheckOp): bigint {
  return op.scope === CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
}

type RewriteHopContextState = {
  table: ReplicatedTable;
  persistent: PersistentStringTable;
  assembler: FramePartAssembler;
};

/**
 * Session-scoped rewrite hop. Buffer multi-part frames until complete, then emit rehashed parts.
 * OPEN-6: one replicated table + assembler per `contextId` — nested frames must not poison root
 * `preTableHash`/`CHECK`.
 */
export class FrameRewriteHop {
  private readonly contexts = new Map<number, RewriteHopContextState>();
  private readonly encoder = new BinaryFrameEncoder();

  private contextState(contextId: number): RewriteHopContextState {
    let state = this.contexts.get(contextId);
    if (state === undefined) {
      state = {
        table: new ReplicatedTable(),
        persistent: new PersistentStringTable(),
        assembler: new FramePartAssembler(),
      };
      this.contexts.set(contextId, state);
    }
    return state;
  }

  /** Call on navigate / session stop — producer table identity resets with the page. */
  reset(): void {
    this.contexts.clear();
  }

  /**
   * Ingest one wire part. Returns zero or more rewritten parts to relay (empty while buffering
   * a multi-part frame).
   */
  push(input: Uint8Array, ctx: RewritePartContext): Uint8Array[] {
    const hdr = peekFrameHeader(input);
    if (hdr === null) return [input];
    const scope = this.contextState(hdr.contextId);

    const decoded = decodeFramePart(input, scope.persistent);
    if (!decoded.ok) return [input];

    const pageBase = ctx.pageUrl || 'https://invalid.local/';
    const seen = new Set<string>();
    const onRewrite = (result: RewriteUrlResult) => {
      const dedupeKey =
        result.kind === 'http'
          ? result.key
          : result.kind === 'data' || result.kind === 'blob'
            ? result.id
            : result.value;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      ctx.assets.materializeRewrite(result);
    };

    const part: DecodedFramePart = {
      ...decoded.part,
      ops: decoded.part.ops.map((op) => rewriteOp(op, pageBase, onRewrite)),
    };

    const assembled = scope.assembler.ingest(part);
    if (assembled === null) return [];
    if (assembled === 'missing_part' || assembled === 'malformed') {
      // Fall back to original bytes for this part only — better a single corrupt part than silence.
      return [input];
    }

    const { preTableHash, ops } = rehashFrame(
      scope.table,
      assembled.resync,
      assembled.sequence,
      assembled.ops,
    );

    const frame: Frame = {
      version: FRAME_WIRE_VERSION,
      flags: { resync: assembled.resync },
      contextId: assembled.contextId,
      generation: assembled.generation,
      sequence: assembled.sequence,
      preTableHash,
      ops,
    };
    return this.encoder.encode(frame);
  }
}

function rehashFrame(
  table: ReplicatedTable,
  resync: boolean,
  sequence: number,
  ops: readonly FrameOp[],
): { preTableHash: bigint; ops: FrameOp[] } {
  if (resync) table.reset();
  table.setSequence(sequence);
  const preTableHash = table.tableHash;
  const out: FrameOp[] = new Array(ops.length);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op === OpCode.Check) {
      out[i] = { ...op, hash: evaluateCheck(table, op) };
      continue;
    }
    applyOpToTable(table, op);
    out[i] = op;
  }
  return { preTableHash, ops: out };
}

function rewriteOp(
  op: FrameOp,
  pageBase: string,
  onRewrite: (r: RewriteUrlResult) => void,
): FrameOp {
  switch (op.op) {
    case OpCode.NodeNew:
      if (op.kind === NodeKind.Element && op.attrs.length > 0) {
        return { ...op, attrs: rewriteAttrs(op.attrs, pageBase, onRewrite) };
      }
      return op;
    case OpCode.AttrSet:
      return { ...op, attrs: rewriteAttrs(op.attrs, pageBase, onRewrite) };
    case OpCode.RuleNew:
      return { ...op, text: rewriteCssText(op.text, pageBase, onRewrite) };
    case OpCode.RuleSet:
      return { ...op, text: rewriteCssText(op.text, pageBase, onRewrite) };
    default:
      return op;
  }
}

function rewriteAttrs(
  attrs: readonly AttrPair[],
  pageBase: string,
  onRewrite: (r: RewriteUrlResult) => void,
): AttrPair[] {
  return attrs.map(({ name, value }) => {
    if (!URL_ATTR_NAMES.has(name.toLowerCase())) return { name, value };
    return { name, value: rewriteAttrValue(name, value, pageBase, onRewrite) };
  });
}

/** @deprecated use {@link FrameRewriteHop} — kept for unit imports that only need string rewrite. */
export function rewritePart(input: Uint8Array, ctx: RewritePartContext): Uint8Array {
  const hop = new FrameRewriteHop();
  const out = hop.push(input, ctx);
  return out[0] ?? input;
}

export type { DecodedFramePart };
