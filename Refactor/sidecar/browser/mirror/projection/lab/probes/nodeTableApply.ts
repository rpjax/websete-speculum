/**
 * Lab caller table apply — Phase 1 only (`applyFrameToTableChecked`).
 * Not a BrowserSession primitive; not a second Chromium page.
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
} from '../models/decode';
import { ReplicatedTable } from '../models/replicatedTable';
import { applyFrameToTableChecked, type CheckedApplyResult } from '../models/replicatedTableApply';
import { digestReplicatedTable, type ReplicatedTableDigest } from '../models/tableDigest';
import type { ClientStateSnapshot } from './isomorphism';

function formatApplyError(result: Extract<CheckedApplyResult, { ok: false }>): string {
  if (result.opName === 'check') {
    return `check mismatch expected=${result.expected} actual=${result.actual}`;
  }
  return result.message;
}

export class NodeTableApplier {
  private readonly persistent = new PersistentStringTable();
  private readonly assembler = new FramePartAssembler();
  private readonly table = new ReplicatedTable();
  private lastSequence = 0;
  private lastError: string | null = null;

  get sequence(): number {
    return this.lastSequence;
  }

  get lastApplyError(): string | null {
    return this.lastError;
  }

  digest(): ReplicatedTableDigest {
    return digestReplicatedTable(this.table);
  }

  snapshot(): ClientStateSnapshot {
    return {
      tree: null,
      table: this.digest(),
      sequence: this.lastSequence,
      applyError: this.lastError,
    };
  }

  observeFrameBytes(buf: Uint8Array): void {
    const decoded = decodeFramePart(buf, this.persistent);
    if (!decoded.ok) {
      this.lastError = `${decoded.reason}: ${decoded.message}`;
      return;
    }
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part') {
      this.lastError = 'missing_part';
      return;
    }
    if (assembled === null) return;

    const result = applyFrameToTableChecked(
      this.table,
      assembled.resync,
      assembled.ops,
      assembled.sequence,
    );
    if (!result.ok) {
      this.lastError = formatApplyError(result);
      return;
    }
    this.lastError = null;
    this.lastSequence = assembled.sequence;
  }
}
