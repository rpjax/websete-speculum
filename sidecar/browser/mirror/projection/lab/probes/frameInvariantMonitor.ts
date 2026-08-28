/**
 * Frame-stream invariant monitor — wire bytes only.
 * Telemetry is for time-series / diagnosis, never a pass/fail source here.
 * Table×table and table×DOM asserts belong on the coherent snapshot probe.
 */

import { OpCode } from '@speculum/page-projection/core/opcodes';
import { DOCUMENT_ID, INSERT_AT_END, type FrameOp } from '@speculum/page-projection/core/frame';
import type { DomNodeKey } from '@speculum/page-projection/core/domNodeKey';
import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '@speculum/page-projection/core/decode';
import type { ProjectionTelemetryMessage } from '@speculum/page-projection/core/telemetry';

export type InvariantStatus = 'pass' | 'fail';
export type InvariantFailure = { sequence: number; details: string };
export type InvariantCheckSummary = {
  id: string;
  description: string;
  passCount: number;
  failCount: number;
  /** Capped at MAX_FAILURES_PER_CHECK — pass/fail counts above are the uncapped truth. */
  failures: InvariantFailure[];
};

const MAX_FAILURES_PER_CHECK = 20;

const CHECK_DEFINITIONS: { id: string; description: string }[] = [
  { id: 'frame_decodable', description: 'Every frame/part received from Virtual decodes and assembles cleanly (no malformed bytes, no missing parts)' },
  { id: 'sequence_monotonic', description: 'Frame sequence is previous+1 for every frame' },
  { id: 'generation_stable', description: 'Frame generation only changes when that frame carries an EPOCH_RESET op' },
  { id: 'no_dangling_reference', description: 'Every op referencing an id targets an id already allocated via NODE_NEW / SHEET_NEW / RULE_NEW (or root id 1)' },
  { id: 'no_duplicate_id', description: 'NODE_NEW / SHEET_NEW / RULE_NEW never reallocates a currently-live id' },
  { id: 'topology_consistency', description: 'INSERT never makes an id its own parent or creates a topology cycle' },
];

type CheckEntry = { description: string; passCount: number; failCount: number; failures: InvariantFailure[] };

export class FrameInvariantMonitor {
  private readonly checks = new Map<string, CheckEntry>();
  private readonly persistent = new PersistentStringTable();
  private readonly assembler = new FramePartAssembler();

  private readonly liveIds = new Set<DomNodeKey>([DOCUMENT_ID]);
  private readonly parentOf = new Map<DomNodeKey, DomNodeKey>();

  private prevSequence = 0;
  private prevGeneration: number | null = null;

  constructor() {
    for (const def of CHECK_DEFINITIONS) {
      this.checks.set(def.id, { description: def.description, passCount: 0, failCount: 0, failures: [] });
    }
  }

  /** Feed one raw frame-part buffer as it arrives from Virtual (same bytes `LabSession.onVirtualFrame` gets). */
  observeFrameBytes(buf: Uint8Array): void {
    const decoded = decodeFramePart(buf, this.persistent);
    if (!decoded.ok) {
      this.record('frame_decodable', 'fail', this.prevSequence, `${decoded.reason}: ${decoded.message}`);
      return;
    }
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part' || assembled === 'malformed') {
      this.record('frame_decodable', 'fail', decoded.part.sequence, assembled === 'malformed' ? 'part contextId mismatch' : 'missing_part — part sequence gap');
      return;
    }
    this.record('frame_decodable', 'pass', decoded.part.sequence);
    if (assembled === null) return; // partial multi-part frame, nothing to check yet
    this.processFrame(assembled);
  }

  /** Telemetry is recorded for plots; it never drives a pass/fail here. */
  observeTelemetry(_msg: ProjectionTelemetryMessage): void {
    return;
  }

  getSummary(): InvariantCheckSummary[] {
    return CHECK_DEFINITIONS.map((def) => {
      const entry = this.checks.get(def.id)!;
      return {
        id: def.id,
        description: entry.description,
        passCount: entry.passCount,
        failCount: entry.failCount,
        failures: entry.failures,
      };
    });
  }

  private processFrame(frame: AssembledFrame): void {
    if (frame.sequence !== this.prevSequence + 1) {
      this.record('sequence_monotonic', 'fail', frame.sequence, `expected ${this.prevSequence + 1}, got ${frame.sequence}`);
    } else {
      this.record('sequence_monotonic', 'pass', frame.sequence);
    }
    this.prevSequence = frame.sequence;

    const sawEpochReset = frame.ops.some((op) => op.op === OpCode.EpochReset);
    if (this.prevGeneration !== null && frame.generation !== this.prevGeneration && !sawEpochReset) {
      this.record(
        'generation_stable',
        'fail',
        frame.sequence,
        `generation changed ${this.prevGeneration}->${frame.generation} without an EPOCH_RESET op`,
      );
    } else {
      this.record('generation_stable', 'pass', frame.sequence);
    }
    this.prevGeneration = frame.generation;

    if (frame.resync) {
      // §5.8 resetIdentity: wholesale id replacement, same generation — the shadow must be
      // replaced, not patched, or every op below would spuriously look like a dangling
      // reference against ids that are legitimately gone.
      this.liveIds.clear();
      this.liveIds.add(DOCUMENT_ID);
      this.parentOf.clear();
    }

    for (const op of frame.ops) this.processOp(op, frame.sequence);
  }

  private processOp(op: FrameOp, sequence: number): void {
    switch (op.op) {
      case OpCode.EpochReset:
        return; // no id semantics
      case OpCode.NodeNew: {
        if (this.liveIds.has(op.id)) {
          this.record('no_duplicate_id', 'fail', sequence, `NODE_NEW reallocated live id ${op.id}`);
        } else {
          this.record('no_duplicate_id', 'pass', sequence);
        }
        this.liveIds.add(op.id);
        return;
      }
      case OpCode.NodeDrop: {
        // Stage 3: keep the wire shadow's liveIds in agreement with NODE_DROP so
        // dangling-id checks stay honest after GC sweeps.
        for (const id of op.ids) this.dropShadowSubtree(id);
        return;
      }
      case OpCode.Insert: {
        this.checkLive(sequence, op.parent, 'insert.parent');
        if (op.before !== INSERT_AT_END) this.checkLive(sequence, op.before, 'insert.before');
        for (const id of op.ids) {
          this.checkLive(sequence, id, 'insert.id');
          if (id === op.parent) {
            this.record('topology_consistency', 'fail', sequence, `id ${id} inserted as its own parent`);
          } else if (this.wouldCycle(op.parent, id)) {
            this.record('topology_consistency', 'fail', sequence, `insert of ${id} under ${op.parent} would create a cycle`);
          } else {
            this.record('topology_consistency', 'pass', sequence);
          }
          this.parentOf.set(id, op.parent);
        }
        return;
      }
      case OpCode.Remove: {
        this.checkLive(sequence, op.parent, 'remove.parent');
        for (const id of op.ids) {
          this.checkLive(sequence, id, 'remove.id');
          this.parentOf.delete(id);
        }
        return;
      }
      case OpCode.AttrSet:
        this.checkLive(sequence, op.node, 'attrSet.node');
        return;
      case OpCode.AttrDel:
        this.checkLive(sequence, op.node, 'attrDel.node');
        return;
      case OpCode.TextSet:
        this.checkLive(sequence, op.node, 'textSet.node');
        return;
      case OpCode.SheetNew: {
        if (this.liveIds.has(op.id)) {
          this.record('no_duplicate_id', 'fail', sequence, `SHEET_NEW reallocated live id ${op.id}`);
        } else {
          this.record('no_duplicate_id', 'pass', sequence);
        }
        if (op.hostNode !== 0) this.checkLive(sequence, op.hostNode, 'sheetNew.hostNode');
        if (op.before !== INSERT_AT_END) this.checkLive(sequence, op.before, 'sheetNew.before');
        this.liveIds.add(op.id);
        this.parentOf.set(op.id, op.hostNode === 0 ? DOCUMENT_ID : op.hostNode);
        return;
      }
      case OpCode.SheetDrop: {
        for (const id of op.ids) this.dropShadowSubtree(id);
        return;
      }
      case OpCode.SheetOrder: {
        for (const id of op.ids) this.checkLive(sequence, id, 'sheetOrder.id');
        return;
      }
      case OpCode.RuleNew: {
        this.checkLive(sequence, op.sheet, 'ruleNew.sheet');
        if (op.before !== INSERT_AT_END) this.checkLive(sequence, op.before, 'ruleNew.before');
        if (this.liveIds.has(op.id)) {
          this.record('no_duplicate_id', 'fail', sequence, `RULE_NEW reallocated live id ${op.id}`);
        } else {
          this.record('no_duplicate_id', 'pass', sequence);
        }
        this.liveIds.add(op.id);
        this.parentOf.set(op.id, op.sheet);
        return;
      }
      case OpCode.RuleDrop: {
        this.checkLive(sequence, op.sheet, 'ruleDrop.sheet');
        for (const id of op.ids) this.dropShadowSubtree(id);
        return;
      }
      case OpCode.RuleSet:
        this.checkLive(sequence, op.id, 'ruleSet.id');
        return;
      default:
        return;
    }
  }

  private checkLive(sequence: number, id: DomNodeKey, label: string): void {
    if (this.liveIds.has(id)) {
      this.record('no_dangling_reference', 'pass', sequence);
    } else {
      this.record('no_dangling_reference', 'fail', sequence, `${label} references unallocated id ${id}`);
    }
  }

  /**
   * `NODE_DROP`'s own `Table` effect (§4.2: "drops each row and all its descendants") mirrored
   * in the shadow — `parentOf` has no reverse index, so children are found by scanning it; a
   * diagnostic tool's cost, not the wire protocol's (both real sides use `ReplicatedTable`'s
   * O(1)-derived `lastChildOf`/`prevSibling` links instead, `models/replicatedTable.ts`).
   */
  private dropShadowSubtree(id: DomNodeKey): void {
    if (!this.liveIds.delete(id)) return;
    this.parentOf.delete(id);
    const children: DomNodeKey[] = [];
    for (const [childId, parentId] of this.parentOf) {
      if (parentId === id) children.push(childId);
    }
    for (const childId of children) this.dropShadowSubtree(childId);
  }

  /** Cheap cycle guard (bounded hop count) — not a formal proof, but real and free given `parentOf` is already tracked. */
  private wouldCycle(parent: DomNodeKey, id: DomNodeKey): boolean {
    let cur: DomNodeKey | undefined = parent;
    for (let hops = 0; hops < 64 && cur !== undefined; hops++) {
      if (cur === id) return true;
      cur = this.parentOf.get(cur);
    }
    return false;
  }

  private record(checkId: string, status: InvariantStatus, sequence: number, details?: string): void {
    const entry = this.checks.get(checkId);
    if (!entry) return;
    if (status === 'pass') {
      entry.passCount += 1;
      return;
    }
    entry.failCount += 1;
    if (entry.failures.length < MAX_FAILURES_PER_CHECK) entry.failures.push({ sequence, details: details ?? '' });
  }
}
