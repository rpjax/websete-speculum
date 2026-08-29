/**
 * Algorithm use case: resync — always the whole system (DOM + CSSOM), one frame, one CHECK.
 * Strengths (maps trusted vs rebuild identity) are not plane toggles.
 *
 * §5.8 names: `emitResyncFrame` (trusted maps) · `resyncVirtual` = {@link rebuildAndResync}.
 */

import { OpCode } from '../core/opcodes';
import {
  CHECK_SCOPE_TABLE,
  createFrame,
  spliceCssomBeforeCheck,
  type Frame,
} from '../core/frame';
import type { ReplicatedTable } from '../core/replicatedTable';
import { applyOpsToTable } from '../core/replicatedTableApply';
import type { DomNodeTable } from './dom/domNodeTable';
import { describeDomResync, rebuildDomIdentity } from './dom/domResync';
import type { FormPropIndex } from './dom/formPropIndex';
import type { CssomPlane } from './cssom/cssomPlane';
import { stampCssomPoll, type CssomPollStats } from '../core/telemetry';
import type { ChildScopeIndex } from './dom/childScopes';
import { CONTEXT_ID_ROOT } from '../core/frame';

export type ResyncPlanes = {
  domNodes: DomNodeTable;
  table: ReplicatedTable;
  cssom: CssomPlane;
  formIndex: FormPropIndex;
  childScopes?: ChildScopeIndex;
  contextId?: number;
  /** Defer nested hosts whose mint is still in flight (same as incremental `pendingHosts`). */
  notePendingNestedHost?: (el: Element) => void;
};

export type ResyncFrameResult = {
  frame: Frame;
  cssom: CssomPollStats;
  /**
   * A nested host is still waiting for its `contextId` (§0 #4). The frame is complete for
   * everything else, but the caller must **not** emit it — re-build once the mint RPC settles
   * (`MintPort.whenSettled`) so the host ships with a real id instead of being omitted.
   */
  mintPending: boolean;
};

/** Maps trusted: describe live identity, blocking CSSOM scan, wholesale replace. */
export function emitResyncFrame(planes: ResyncPlanes, sequence: number): ResyncFrameResult {
  const { domNodes, table, cssom, formIndex, childScopes, contextId } = planes;
  const generation = domNodes.generation;
  const { ops: domOps, mintPending } = describeDomResync(domNodes, formIndex, {
    childScopes,
    notePendingNestedHost: planes.notePendingNestedHost,
  });
  const cssomScan = cssom.blockingScan();

  table.reset();
  table.setSequence(sequence);
  applyOpsToTable(table, domOps);
  const propOps = formIndex.sample(domNodes, table);
  if (propOps.length > 0) applyOpsToTable(table, propOps);
  if (cssomScan.ops.length > 0) applyOpsToTable(table, cssomScan.ops);
  const ops = spliceCssomBeforeCheck(
    [
      ...domOps,
      ...propOps,
      { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash },
    ],
    cssomScan.ops,
  );

  return {
    frame: createFrame({
      generation,
      sequence,
      ops,
      resync: true,
      preTableHash: 0n,
      contextId: contextId ?? CONTEXT_ID_ROOT,
    }),
    cssom: stampCssomPoll(cssomScan.stats, { source: 'resync', sequence }),
    mintPending,
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
