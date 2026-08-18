/**
 * Algorithm use case: resync — always the whole system (DOM + CSSOM), one frame, one CHECK.
 * Strengths (maps trusted vs rebuild identity) are not plane toggles.
 *
 * §5.8 names: `emitResyncFrame` (trusted maps) · `resyncVirtual` = {@link rebuildAndResync}.
 */

import { OpCode } from '../models/opcodes';
import {
  CHECK_SCOPE_TABLE,
  createFrame,
  type Frame,
} from '../models/frame';
import type { ReplicatedTable } from '../models/replicatedTable';
import { applyOpsToTable } from '../models/replicatedTableApply';
import type { DomNodeTable } from './dom/domNodeTable';
import { describeDomResync, rebuildDomIdentity } from './dom/domResync';
import type { FormPropIndex } from './dom/formPropIndex';
import type { CssomPlane } from './cssom/cssomPlane';
import { stampCssomPoll, type CssomPollStats } from '../models/telemetry';

export type ResyncPlanes = {
  domNodes: DomNodeTable;
  table: ReplicatedTable;
  cssom: CssomPlane;
  formIndex: FormPropIndex;
};

export type ResyncFrameResult = {
  frame: Frame;
  cssom: CssomPollStats;
};

/** Maps trusted: describe live identity, blocking CSSOM scan, wholesale replace. */
export function emitResyncFrame(planes: ResyncPlanes, sequence: number): ResyncFrameResult {
  const { domNodes, table, cssom, formIndex } = planes;
  const generation = domNodes.generation;
  const domOps = describeDomResync(domNodes, formIndex);
  const cssomScan = cssom.blockingScan();

  table.reset();
  table.setSequence(sequence);
  applyOpsToTable(table, domOps);
  const propOps = formIndex.sample(domNodes, table);
  if (propOps.length > 0) applyOpsToTable(table, propOps);
  const ops = [...domOps, ...propOps, ...cssomScan.ops];

  ops.push({ op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash });

  return {
    frame: createFrame({ generation, sequence, ops, resync: true, preTableHash: 0n }),
    cssom: stampCssomPoll(cssomScan.stats, { source: 'resync', sequence }),
  };
}

/**
 * Maps not trusted: rebuild DOM identity from a live walk, then {@link emitResyncFrame}.
 * Protocol §5.8 called this `resyncVirtual`.
 */
export function rebuildAndResync(planes: ResyncPlanes, sequence: number): ResyncFrameResult {
  rebuildDomIdentity(planes.domNodes);
  return emitResyncFrame(planes, sequence);
}
