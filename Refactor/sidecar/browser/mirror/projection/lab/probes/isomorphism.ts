/**
 * Lab isomorphism — compose BrowserSession diagnostics. Not a session primitive.
 *
 * Virtual side is a **state snapshot** per `contextId` ({@link BrowserSession.flushProjectionSnapshot}):
 * takeRecords, drain MO buffer, emit frame S, table×DOM (`o2`) + CSSOM + digest + tree.
 * Caller table apply then snapshots Projected at S. Multi-context = one call per id.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { TableLiveOracleResult } from '@speculum/page-projection/core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '@speculum/page-projection/core/cssomTableLiveOracle';
import type { ReplicatedTableDigest } from '@speculum/page-projection/core/tableDigest';
import { tableDigestsEqual } from '@speculum/page-projection/core/tableDigest';
import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import type { FormControlSnap } from '@speculum/page-projection/core/formControlSnap';
import { formControlSnapsEqual } from '@speculum/page-projection/core/formControlSnap';
import { diffTrees, countShadowTrees, countNestedDocuments, collectFrameHrefs, type StructuralDiffResult } from './structuralDiff';

export type ClientStateSnapshot = {
  contextId?: number;
  tree: TreeNode | null;
  table: ReplicatedTableDigest | null;
  /** Last successfully applied frame sequence (Node table apply). Omit for DOM lab client. */
  sequence?: number | null;
  generation?: number | null;
  applyError?: string | null;
  /** Sticky: a desync was reported since the last surface reset (inject proofs). */
  desynced?: boolean;
  /** Lab inject: wait until the live target is armed and not a standby resync build. */
  armed?: boolean;
  resyncInFlight?: boolean;
  /** PP-CSSOM-A-2 paint boundary (fixture probes). */
  cascade?: {
    authorColor: string;
    adoptedColor: string;
    adoptedCount: number;
    styleSheetCount: number;
    styleElCount: number;
    doublePaint: boolean;
  } | null;
  formProps?: FormControlSnap[] | null;
};

export type IsomorphismResult = {
  sequence: number | null;
  generation: number | null;
  o2: TableLiveOracleResult | null;
  cssomO2: CssomTableLiveOracleResult | null;
  table: {
    virtual: ReplicatedTableDigest | null;
    client: ReplicatedTableDigest | null;
    identical: boolean | null;
  };
  tableFailReason: string | null;
  structuralDiff: StructuralDiffResult | null;
  skipped: { id: string; reason: string }[];
  nodeNewConnected: {
    ok: boolean;
    checked: number;
    disconnectedIds: number[];
  } | null;
  cascade: {
    virtual: ClientStateSnapshot['cascade'];
    client: ClientStateSnapshot['cascade'];
  } | null;
  formProps: {
    virtual: FormControlSnap[] | null;
    client: FormControlSnap[] | null;
    identical: boolean | null;
    reason: string | null;
  };
  shadow: {
    virtualHosts: number;
    clientHosts: number;
  } | null;
  nested: {
    virtualDocs: number;
    clientDocs: number;
    clientFrameHrefs: string[];
  } | null;
  /** Per-context iso (OPEN-6). Root `1` is mirrored in legacy top-level fields. */
  contexts?: Record<number, ContextIsoResult>;
  allPass?: boolean;
};

export type ContextIsoResult = {
  contextId: number;
  sequence: number | null;
  generation: number | null;
  o2: TableLiveOracleResult | null;
  cssomO2: CssomTableLiveOracleResult | null;
  table: {
    virtual: ReplicatedTableDigest | null;
    client: ReplicatedTableDigest | null;
    identical: boolean | null;
  };
  tableFailReason: string | null;
  structuralDiff: StructuralDiffResult | null;
  skipped: { id: string; reason: string }[];
  nodeNewConnected: IsomorphismResult['nodeNewConnected'];
  cascade: IsomorphismResult['cascade'];
  formProps: IsomorphismResult['formProps'];
  virtualTree?: TreeNode | null;
  clientTree?: TreeNode | null;
};

const CLIENT_CATCH_UP_MS = 2_000;
const CLIENT_POLL_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitClientAtSequence(
  getClientSnapshot: () => Promise<ClientStateSnapshot | null>,
  targetSequence: number,
): Promise<ClientStateSnapshot | null> {
  const deadline = Date.now() + CLIENT_CATCH_UP_MS;
  let snap = await getClientSnapshot();
  if (snap == null) {
    while (Date.now() < deadline) {
      await sleep(CLIENT_POLL_MS);
      snap = await getClientSnapshot();
      if (snap != null) break;
    }
    return snap;
  }
  if (snap.sequence == null) return snap;
  while (Date.now() < deadline) {
    if (snap.applyError || snap.desynced) return snap;
    if ((snap.sequence ?? 0) >= targetSequence && snap.table != null) return snap;
    await sleep(CLIENT_POLL_MS);
    const next = await getClientSnapshot();
    if (next == null) continue;
    snap = next;
    if (snap.sequence == null) return snap;
  }
  return snap;
}

function emptyIsoResult(skipped: { id: string; reason: string }[]): IsomorphismResult {
  const emptyTable = { virtual: null, client: null, identical: null as boolean | null };
  return {
    sequence: null,
    generation: null,
    o2: null,
    cssomO2: null,
    table: emptyTable,
    tableFailReason: null,
    structuralDiff: null,
    skipped,
    nodeNewConnected: null,
    cascade: null,
    formProps: { virtual: null, client: null, identical: null, reason: null },
    shadow: null,
    nested: null,
    contexts: {},
    allPass: false,
  };
}

async function compareContextPair(opts: {
  contextId: number;
  virtual: {
    ok: boolean;
    generation?: number;
    sequence?: number;
    o2?: TableLiveOracleResult;
    table?: ReplicatedTableDigest;
    cssomO2?: CssomTableLiveOracleResult | null;
    nodeNewConnected?: IsomorphismResult['nodeNewConnected'];
    cascade?: ClientStateSnapshot['cascade'];
    formProps?: FormControlSnap[];
    tree?: unknown;
    reason?: string;
  };
  getClientSnapshot?: (contextId: number) => Promise<ClientStateSnapshot | null> | ClientStateSnapshot | null;
}): Promise<ContextIsoResult> {
  const skipped: { id: string; reason: string }[] = [];
  const emptyTable = { virtual: null, client: null, identical: null as boolean | null };
  if (!opts.virtual.ok) {
    return {
      contextId: opts.contextId,
      sequence: null,
      generation: null,
      o2: null,
      cssomO2: null,
      table: emptyTable,
      tableFailReason: null,
      structuralDiff: null,
      skipped: [{ id: 'isomorphism', reason: opts.virtual.reason ?? 'virtual snapshot failed' }],
      nodeNewConnected: null,
      cascade: null,
      formProps: { virtual: null, client: null, identical: null, reason: null },
    };
  }

  const virtualTable = opts.virtual.table ?? null;
  const targetSeq = opts.virtual.sequence ?? 0;

  let clientSnap: ClientStateSnapshot | null = null;
  if (opts.getClientSnapshot) {
    clientSnap = await waitClientAtSequence(async () => {
      const v = opts.getClientSnapshot!(opts.contextId);
      return v instanceof Promise ? await v : v;
    }, targetSeq);
  }

  let structuralDiff: StructuralDiffResult | null = null;
  if (!opts.getClientSnapshot) {
    skipped.push({ id: 'structuralDiff', reason: 'no lab client apply surface' });
    skipped.push({ id: 'table', reason: 'no lab client apply surface' });
    skipped.push({ id: 'formProps', reason: 'no lab client apply surface' });
  } else if (clientSnap == null) {
    skipped.push({ id: 'structuralDiff', reason: 'client did not reply to requestSnapshot after flush' });
    skipped.push({ id: 'table', reason: 'client did not reply to requestSnapshot after flush' });
    skipped.push({ id: 'formProps', reason: 'client did not reply to requestSnapshot after flush' });
  } else if (clientSnap.tree == null) {
    skipped.push({ id: 'structuralDiff', reason: 'no DOM apply surface for context' });
  } else if (opts.virtual.tree == null) {
    skipped.push({ id: 'structuralDiff', reason: 'virtual tree missing for context' });
  } else {
    structuralDiff = diffTrees(opts.virtual.tree as TreeNode, clientSnap.tree);
  }

  const virtualFormProps = opts.virtual.formProps ?? null;
  const clientFormProps = clientSnap?.formProps ?? null;
  let formIdentical: boolean | null = null;
  let formReason: string | null = null;
  if (opts.getClientSnapshot && clientSnap != null) {
    const cmp = formControlSnapsEqual(virtualFormProps, clientFormProps);
    formIdentical = cmp.identical;
    formReason = cmp.reason;
  } else {
    formReason = skipped.find((s) => s.id === 'formProps')?.reason ?? 'no DOM client';
  }

  const clientTable = clientSnap?.table ?? null;
  let tableIdentical: boolean | null = null;
  let tableFailReason: string | null = null;
  if (opts.getClientSnapshot && clientSnap != null) {
    if (clientSnap.applyError || clientSnap.desynced) {
      tableIdentical = false;
      tableFailReason = clientSnap.applyError ?? 'client desynced';
    } else if (clientSnap.sequence != null && clientSnap.sequence < targetSeq) {
      skipped.push({
        id: 'table',
        reason: `client at sequence ${clientSnap.sequence}, Virtual at ${targetSeq}`,
      });
    } else if (virtualTable && clientTable) {
      tableIdentical = tableDigestsEqual(virtualTable, clientTable);
      if (!tableIdentical) {
        tableFailReason = `virtual rows=${virtualTable.rowCount} client rows=${clientTable.rowCount} hash mismatch`;
      }
    } else if (virtualTable == null || clientTable == null) {
      skipped.push({
        id: 'table',
        reason: virtualTable == null ? 'virtual table digest missing' : 'client table digest missing',
      });
    }
  }

  return {
    contextId: opts.contextId,
    sequence: opts.virtual.sequence ?? null,
    generation: opts.virtual.generation ?? null,
    o2: opts.virtual.o2 ?? null,
    cssomO2: opts.virtual.cssomO2 ?? null,
    table: { virtual: virtualTable, client: clientTable, identical: tableIdentical },
    tableFailReason,
    structuralDiff,
    nodeNewConnected:
      opts.virtual.nodeNewConnected && typeof opts.virtual.nodeNewConnected.ok === 'boolean'
        ? opts.virtual.nodeNewConnected
        : null,
    cascade: { virtual: opts.virtual.cascade ?? null, client: clientSnap?.cascade ?? null },
    formProps: { virtual: virtualFormProps, client: clientFormProps, identical: formIdentical, reason: formReason },
    skipped: [
      ...skipped,
      ...(opts.virtual.o2 ? [] : [{ id: 'o2', reason: 'O2 missing from virtual snapshot' }]),
      ...(opts.virtual.cssomO2 ? [] : [{ id: 'isomorphism.cssom', reason: 'cssomO2 missing from virtual snapshot' }]),
    ],
    virtualTree: (opts.virtual.tree as TreeNode | null | undefined) ?? null,
    clientTree: clientSnap?.tree ?? null,
  };
}

function contextPasses(ctx: ContextIsoResult): boolean {
  if (ctx.o2 && !ctx.o2.identical) return false;
  if (ctx.cssomO2 && !ctx.cssomO2.identical) return false;
  if (ctx.table.identical === false) return false;
  if (ctx.structuralDiff && !ctx.structuralDiff.identical) return false;
  if (ctx.formProps.identical === false) return false;
  if (ctx.nodeNewConnected && !ctx.nodeNewConnected.ok) return false;
  return true;
}

export async function runIsomorphism(opts: {
  session: BrowserSession;
  contextIds?: number[];
  getClientSnapshot?: (
    contextId: number,
  ) => Promise<ClientStateSnapshot | null> | ClientStateSnapshot | null;
}): Promise<IsomorphismResult> {
  const getClient = opts.getClientSnapshot;
  const stateSnapshot = opts.session.flushProjectionSnapshot;
  const resume = opts.session.resumeProjectionWorld;
  const contextIds = opts.contextIds?.length ? [...opts.contextIds] : [1];

  if (!stateSnapshot) {
    return emptyIsoResult([{ id: 'isomorphism', reason: 'session does not expose state snapshot RPC' }]);
  }

  try {
    const contexts: Record<number, ContextIsoResult> = {};
    for (const contextId of contextIds) {
      const virtual = await stateSnapshot.call(opts.session, {
        contextId,
        includeTree: true,
        cssom: 'scan',
      });
      const mapped =
        virtual.ok
          ? {
              ok: true as const,
              generation: virtual.generation,
              sequence: virtual.sequence,
              o2: virtual.o2,
              table: virtual.table,
              cssomO2: virtual.cssomO2,
              nodeNewConnected: virtual.nodeNewConnected,
              cascade: virtual.cascade,
              formProps: virtual.formProps,
              tree: virtual.tree,
            }
          : { ok: false as const, reason: virtual.reason ?? 'getStateSnapshot failed' };
      contexts[contextId] = await compareContextPair({ contextId, virtual: mapped, getClientSnapshot: getClient });
    }

    const root = contexts[1] ?? Object.values(contexts)[0];
    if (!root) return emptyIsoResult([{ id: 'isomorphism', reason: 'no context results' }]);

    const allPass = Object.values(contexts).every(contextPasses);

    return {
      sequence: root.sequence,
      generation: root.generation,
      o2: root.o2,
      cssomO2: root.cssomO2,
      table: root.table,
      tableFailReason: root.tableFailReason,
      structuralDiff: root.structuralDiff,
      nodeNewConnected: root.nodeNewConnected,
      cascade: root.cascade,
      formProps: root.formProps,
      shadow:
        root.virtualTree != null
          ? {
              virtualHosts: countShadowTrees(root.virtualTree),
              clientHosts: root.clientTree != null ? countShadowTrees(root.clientTree) : 0,
            }
          : null,
      nested:
        root.virtualTree != null
          ? {
              virtualDocs: countNestedDocuments(root.virtualTree),
              clientDocs: root.clientTree != null ? countNestedDocuments(root.clientTree) : 0,
              clientFrameHrefs: root.clientTree != null ? collectFrameHrefs(root.clientTree) : [],
            }
          : null,
      skipped: root.skipped,
      contexts,
      allPass,
    };
  } finally {
    await resume?.call(opts.session);
  }
}
