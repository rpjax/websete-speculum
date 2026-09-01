/**
 * Lab-only ring buffer of decoded frame summaries per contextId — correlates desync telemetry
 * with the exact INSERT/NODE_NEW that failed on Projected apply.
 */

import { OpCode, NodeKind, opCodeName } from '@speculum/page-projection/core/opcodes';
import { INSERT_AT_END, type FrameOp } from '@speculum/page-projection/core/frame';
import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '@speculum/page-projection/core/decode';

export type CapturedOpSummary =
  | { op: 'check'; scope: number; id: number }
  | { op: 'nodeNew'; id: number; kind: number; name?: string; host?: number; mode?: number; nestedHost?: boolean }
  | { op: 'nodeDrop'; ids: number[] }
  | { op: 'insert'; parent: number; before: number; ids: number[] }
  | { op: 'remove'; parent: number; ids: number[] }
  | { op: 'attrSet'; node: number; names: string[] }
  | { op: 'attrDel'; node: number; names: string[] }
  | { op: 'textSet'; node: number; len: number }
  | { op: 'propSet'; node: number; propId: number }
  | { op: 'other'; code: number; label: string };

export type CapturedFrameSummary = {
  contextId: number;
  sequence: number;
  generation: number;
  resync: boolean;
  opCount: number;
  ops: CapturedOpSummary[];
};

const MAX_FRAMES_PER_CONTEXT = 40;

function summarizeOp(op: FrameOp): CapturedOpSummary {
  switch (op.op) {
    case OpCode.Check:
      return { op: 'check', scope: op.scope, id: op.lo };
    case OpCode.NodeNew:
      return {
        op: 'nodeNew',
        id: op.id,
        kind: op.kind,
        name: 'name' in op ? op.name : undefined,
        host: op.kind === NodeKind.ShadowRoot ? op.host : undefined,
        mode: op.kind === NodeKind.ShadowRoot ? op.mode : undefined,
        nestedHost: op.kind === NodeKind.Element ? op.nestedHost === true : undefined,
      };
    case OpCode.NodeDrop:
      return { op: 'nodeDrop', ids: [...op.ids] };
    case OpCode.Insert:
      return {
        op: 'insert',
        parent: op.parent,
        before: op.before === INSERT_AT_END ? INSERT_AT_END : op.before,
        ids: [...op.ids],
      };
    case OpCode.Remove:
      return { op: 'remove', parent: op.parent, ids: [...op.ids] };
    case OpCode.AttrSet:
      return { op: 'attrSet', node: op.node, names: op.attrs.map((a) => a.name) };
    case OpCode.AttrDel:
      return { op: 'attrDel', node: op.node, names: [...op.names] };
    case OpCode.TextSet:
      return { op: 'textSet', node: op.node, len: op.value.length };
    case OpCode.PropSet:
      return { op: 'propSet', node: op.node, propId: op.propId };
    default:
      return { op: 'other', code: op.op as number, label: opCodeName(op.op as OpCode) };
  }
}

function summarizeFrame(contextId: number, frame: AssembledFrame): CapturedFrameSummary {
  return {
    contextId,
    sequence: frame.sequence,
    generation: frame.generation,
    resync: frame.resync,
    opCount: frame.ops.length,
    ops: frame.ops.map(summarizeOp),
  };
}

export class FrameCaptureRing {
  private readonly persistent = new PersistentStringTable();
  private readonly assembler = new FramePartAssembler();
  private readonly frames = new Map<number, CapturedFrameSummary[]>();

  observeFrameBytes(contextId: number, buf: Uint8Array): void {
    const decoded = decodeFramePart(buf, this.persistent);
    if (!decoded.ok) return;
    if (decoded.part.contextId !== contextId) return;
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part' || assembled === 'malformed' || assembled === null) return;
    this.push(contextId, summarizeFrame(contextId, assembled));
  }

  getFrame(contextId: number, sequence: number): CapturedFrameSummary | undefined {
    return this.frames.get(contextId)?.find((f) => f.sequence === sequence);
  }

  listFrames(contextId: number): CapturedFrameSummary[] {
    return [...(this.frames.get(contextId) ?? [])];
  }

  toJSON(): Record<string, CapturedFrameSummary[]> {
    const out: Record<string, CapturedFrameSummary[]> = {};
    for (const [id, list] of this.frames) out[String(id)] = list;
    return out;
  }

  reset(): void {
    this.frames.clear();
    this.assembler.reset();
  }

  private push(contextId: number, frame: CapturedFrameSummary): void {
    let list = this.frames.get(contextId);
    if (!list) {
      list = [];
      this.frames.set(contextId, list);
    }
    list.push(frame);
    if (list.length > MAX_FRAMES_PER_CONTEXT) list.shift();
  }
}

export const NODE_KIND_LABEL: Record<number, string> = {
  [NodeKind.Element]: 'Element',
  [NodeKind.Text]: 'Text',
  [NodeKind.Comment]: 'Comment',
  [NodeKind.Sheet]: 'Sheet',
  [NodeKind.Rule]: 'Rule',
  [NodeKind.Doctype]: 'Doctype',
  [NodeKind.ShadowRoot]: 'ShadowRoot',
};

export type IdMeta = { kind: number; label: string; name?: string; nestedHost?: boolean };

/** Replay captured frames up to `sequence` and collect NODE_NEW metadata. */
export function buildIdMetaThroughSequence(
  frames: CapturedFrameSummary[],
  sequence: number,
): Map<number, IdMeta> {
  const meta = new Map<number, IdMeta>();
  for (const frame of frames) {
    if (frame.sequence > sequence) break;
    if (frame.resync) meta.clear();
    for (const op of frame.ops) {
      if (op.op !== 'nodeNew') continue;
      meta.set(op.id, {
        kind: op.kind,
        label: NODE_KIND_LABEL[op.kind] ?? `kind(${op.kind})`,
        name: op.name,
        nestedHost: op.nestedHost,
      });
    }
  }
  return meta;
}

export type ParsedInsertFailure = {
  contextId: number;
  sequence: number;
  opIndex: number;
  insert: Extract<CapturedOpSummary, { op: 'insert' }>;
  parentMeta: IdMeta | null;
  childMeta: Array<{ id: number; meta: IdMeta | null }>;
  frameFound: boolean;
};

const INSERT_THROW_RE = /throw @op\[(\d+)\]=64|@op\[(\d+)\]=64|insert.*@op\[(\d+)\]/i;

export function parseInsertFailureMessage(message: string | undefined | null): number | null {
  if (!message) return null;
  const m = message.match(/@op\[(\d+)\]=64/) ?? message.match(/@op\[(\d+)\]=/);
  if (!m) return null;
  return Number(m[1]);
}

export function analyzeInsertFailure(opts: {
  contextId: number;
  sequence: number;
  message: string | null | undefined;
  frames: CapturedFrameSummary[];
}): ParsedInsertFailure | null {
  const opIndex = parseInsertFailureMessage(opts.message);
  if (opIndex === null) return null;
  const frame = opts.frames.find((f) => f.sequence === opts.sequence);
  if (!frame) {
    return {
      contextId: opts.contextId,
      sequence: opts.sequence,
      opIndex,
      insert: { op: 'insert', parent: 0, before: INSERT_AT_END, ids: [] },
      parentMeta: null,
      childMeta: [],
      frameFound: false,
    };
  }
  const raw = frame.ops[opIndex];
  if (!raw || raw.op !== 'insert') return null;
  const meta = buildIdMetaThroughSequence(opts.frames, opts.sequence);
  return {
    contextId: opts.contextId,
    sequence: opts.sequence,
    opIndex,
    insert: raw,
    parentMeta: meta.get(raw.parent) ?? (raw.parent === 1 ? { kind: 0, label: 'Document' } : null),
    childMeta: raw.ids.map((id) => ({ id, meta: meta.get(id) ?? null })),
    frameFound: true,
  };
}
