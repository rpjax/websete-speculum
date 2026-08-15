/**
 * Algorithm use case: state snapshot (lab/debug). Inclusion is tunable.
 * Resync is not this file — {@link ./resync.ts} always pays the full system.
 */

import type { ReplicatedTable } from '../models/replicatedTable';
import { digestReplicatedTable } from '../models/tableDigest';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../models/cssomTableLiveOracle';
import type { DomNodeTable } from './dom/domNodeTable';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import type { CssomPlane } from './cssom/cssomPlane';
import type { CssomIds } from './cssom/cssomIds';
import { compareTableToLiveCssomDom } from './cssom/cssomTableLiveOracle';
import { stampCssomPoll, type CssomPollStats } from '../models/telemetry';

/** What CSSOM truth this snapshot needs. */
export type SnapshotCssom = 'none' | 'committed' | 'scan';

export type SnapshotOptions = {
  cssom?: SnapshotCssom;
};

export type SnapshotResult = {
  generation: number;
  sequence: number;
  o2: TableLiveOracleResult;
  table: { rowCount: number; tableHash: string };
  cssom: CssomPollStats | null;
  cssomO2: CssomTableLiveOracleResult | null;
};

export type SnapshotPlanes = {
  domNodes: DomNodeTable;
  table: ReplicatedTable;
  cssom: CssomPlane;
  cssomIds: CssomIds | null;
  currentSequence: () => number;
  /** Drain MO + emit the current DOM tick (pipe). */
  flushDom: () => void;
  /** Investigation only (I10). */
  recordCssomPoll?: (stats: CssomPollStats) => void;
};

/**
 * One JS turn: optional CSSOM scan stashed as pending, then flush, then O2 DOM + optional O2 CSSOM.
 * `none` — halt idle (I8). `committed` — flush includes a finished idle pass if any.
 * `scan` — blocking CSSOM then emit those ops on S, then compare live × table.
 */
export function takeSnapshot(planes: SnapshotPlanes, opts: SnapshotOptions = {}): SnapshotResult {
  const mode = opts.cssom ?? 'none';
  let cssom: CssomPollStats | null = null;
  if (mode === 'none') {
    planes.cssom.halt();
    planes.flushDom();
  } else if (mode === 'committed') {
    planes.flushDom();
  } else {
    const scan = planes.cssom.blockingScan(true);
    cssom = stampCssomPoll(scan.stats, { source: 'snapshotScan' });
    planes.flushDom();
    cssom = stampCssomPoll(cssom, { sequence: planes.currentSequence() });
  }
  const o2 = compareTableToLiveDom(planes.table, planes.domNodes, document);
  const cssomO2 =
    mode === 'none' ? null : compareTableToLiveCssomDom(planes.table, planes.cssomIds, document);
  return {
    generation: planes.domNodes.generation,
    sequence: planes.currentSequence(),
    o2,
    table: digestReplicatedTable(planes.table),
    cssom,
    cssomO2,
  };
}
