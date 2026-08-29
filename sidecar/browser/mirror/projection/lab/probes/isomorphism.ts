/**
 * Lab isomorphism — compose BrowserSession diagnostics. Not a session primitive.
 *
 * Virtual side is a **state snapshot** per `contextId` ({@link BrowserSession.getStateSnapshot}):
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
import type { StateSnapshotOpts, StateSnapshotResult } from '../../../../contracts';

/** Caller-side view of a sealed {@link StateSnapshotResult} for lab folds / iso. */
export type StateSnapshotOracleView = {
  ok: boolean;
  reason?: string;
  generation?: number;
  sequence?: number;
  o2: TableLiveOracleResult | null;
  cssomO2: CssomTableLiveOracleResult | null;
  table: ReplicatedTableDigest | null;
  tree?: unknown;
  formProps?: FormControlSnap[];
  nodeNewConnected?: {
    ok: boolean;
    checked: number;
    disconnectedIds: number[];
  };
  cascade?: ClientStateSnapshot['cascade'];
};

export function mapStateSnapshotToOracleView(snap: StateSnapshotResult): StateSnapshotOracleView {
  if (!snap.ok) {
    return {
      ok: false,
      reason: snap.reason ?? 'getStateSnapshot failed',
      o2: null,
      cssomO2: null,
      table: null,
    };
  }
  const digest =
    snap.table && typeof snap.table === 'object' && 'digest' in snap.table
      ? (snap.table as { digest: ReplicatedTableDigest }).digest
      : (snap.table as ReplicatedTableDigest | null);
  const rows =
    snap.table && typeof snap.table === 'object' && 'rows' in snap.table
      ? ((snap.table as { rows: TableLiveOracleResult | null }).rows ?? null)
      : null;
  const cssomO2 =
    snap.cssom && typeof snap.cssom === 'object'
      ? (((snap.cssom as { live?: { sheets?: CssomTableLiveOracleResult | null } }).live?.sheets ??
          null) as CssomTableLiveOracleResult | null)
      : null;
  const frameNew = snap.frameNewNodes;
  const nodeNewConnected = frameNew
    ? {
        ok: frameNew.every((n) => n.connected),
        checked: frameNew.length,
        disconnectedIds: frameNew.filter((n) => !n.connected).map((n) => n.nodeId),
      }
    : undefined;
  return {
    ok: true,
    generation: snap.generation,
    sequence: snap.sequence,
    o2: rows,
    cssomO2,
    table: digest,
    tree: snap.tree ?? undefined,
    formProps: snap.formProps ?? undefined,
    nodeNewConnected,
    cascade: null,
  };
}

type SnapshotContextFn = (
  contextId: number,
  opts?: { includeTree?: boolean; cssom?: 'none' | 'committed' | 'scan' },
) => Promise<
  | {
      ok: true;
      value: {
        generation: number;
        sequence: number;
        o2: TableLiveOracleResult;
        table: ReplicatedTableDigest;
        cssomO2: CssomTableLiveOracleResult | null;
        nodeNewConnected?: StateSnapshotOracleView['nodeNewConnected'];
        cascade?: StateSnapshotOracleView['cascade'];
        formProps?: FormControlSnap[];
        tree?: unknown;
      };
    }
  | { ok: false; reason: string }
>;

/**
 * Lab capture: prefer concrete `snapshotContext` so PP-CSSOM-A-2 `cascade` stays caller-side
 * (not on sealed {@link StateSnapshotResult}).
 */
export async function captureVirtualLabSnap(
  session: BrowserSession & {
    getStateSnapshot?: (contextId: number, opts?: StateSnapshotOpts) => Promise<StateSnapshotResult>;
    snapshotContext?: SnapshotContextFn;
    resumeClocks?: () => Promise<unknown>;
    haltClocks?: () => Promise<unknown>;
  },
  contextId: number,
  opts: {
    table?: 'digest' | 'full';
    liveChildOrder?: boolean;
    tree?: boolean;
    cssom?: 'none' | 'committed' | 'scan';
    formProps?: boolean;
    frameNewNodes?: boolean;
  },
): Promise<StateSnapshotOracleView> {
  const cssom = opts.cssom ?? 'none';
  const snapCtx = session.snapshotContext;
  if (typeof snapCtx === 'function') {
    const r = await snapCtx.call(session, contextId, {
      includeTree: opts.tree === true,
      cssom,
    });
    if (!r.ok) {
      return { ok: false, reason: r.reason, o2: null, cssomO2: null, table: null };
    }
    const v = r.value;
    return {
      ok: true,
      generation: v.generation,
      sequence: v.sequence,
      o2: v.o2 ?? null,
      cssomO2: cssom === 'none' ? null : (v.cssomO2 ?? null),
      table: v.table ?? null,
      tree: opts.tree === true ? v.tree : undefined,
      formProps: opts.formProps === true ? (v.formProps ?? []) : undefined,
      nodeNewConnected: opts.frameNewNodes === true ? v.nodeNewConnected : undefined,
      cascade: v.cascade ?? null,
    };
  }
  const getSnap = session.getStateSnapshot;
  if (!getSnap) {
    return {
      ok: false,
      reason: 'session does not expose getStateSnapshot/snapshotContext',
      o2: null,
      cssomO2: null,
      table: null,
    };
  }
  const sealed = await getSnap.call(session, contextId, {
    table: opts.table ?? 'full',
    liveChildOrder: opts.liveChildOrder === true,
    tree: opts.tree === true,
    cssom,
    formProps: opts.formProps === true,
    frameNewNodes: opts.frameNewNodes === true,
  });
  return mapStateSnapshotToOracleView(sealed);
}

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
  /** Lab-only nested host bookkeeping (`LabProjectedHarness.peekNestedHosts`). */
  nestedPeek?: {
    nested: number[];
    awaiting: number[];
    pendingFrames: Record<string, number>;
    sessions: Array<{
      contextId: number;
      armed: boolean;
      desynced: boolean;
      applyError: string | null;
      generation: number;
      compat: string | null;
      bodyLen: number;
      docIsLive: boolean | null;
    }>;
  } | null;
  /** Lab-only registry materialization probe (`LabProjectedHarness.probeNestedRegistry`). */
  registryProbe?: {
    contextId: number;
    ok: boolean;
    reason?: string;
    registrySize: number;
    applierSequence: number;
    applierGeneration: number;
    applierTableHash: string;
    applierTableRows: number;
    applierDesynced: boolean;
    bodyLightChildCount: number;
    nodes: Array<{
      id: number;
      present: boolean;
      nodeType: string | null;
      tagName: string | null;
      childCount: number | null;
      isShadowRoot: boolean;
      shadowHostId: number | null;
      hostMatchesId: number | null;
      rect: { x: number; y: number; width: number; height: number } | null;
    }>;
  } | null;
  /** Lab-only rect ladder (`LabProjectedHarness.probeRectLadder`). */
  rectLadder?: {
    contextId: number;
    ok: boolean;
    reason?: string;
    levels: Array<{
      level: number;
      name: string;
      ok: boolean;
      reason?: string;
      tagName?: string | null;
      rect: { x: number; y: number; width: number; height: number } | null;
      offsetWidth?: number | null;
      offsetHeight?: number | null;
      display?: string | null;
      visibility?: string | null;
      hasSrcAttr?: boolean | null;
      src?: string | null;
    }>;
  } | null;
  /** Lab-only widget computedStyle via registry pierce (nested ctx). */
  paintProbe?: {
    widgetPaint: import('./turnstilePierce').TurnstilePaintSample | null;
    widgetPaintOk: boolean;
    widgetPaintReason?: string;
  };
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
  /** Defaults = full lab iso (tree + cssom scan). Browse debug uses a lighter set. */
  virtualCapture?: {
    table?: 'digest' | 'full';
    liveChildOrder?: boolean;
    tree?: boolean;
    cssom?: 'none' | 'committed' | 'scan';
    formProps?: boolean;
    frameNewNodes?: boolean;
  };
}): Promise<IsomorphismResult> {
  const getClient = opts.getClientSnapshot;
  const resume = opts.session.resumeClocks;
  const halt = opts.session.haltClocks;
  const contextIds = opts.contextIds?.length ? [...opts.contextIds] : [1];
  const session = opts.session as BrowserSession & {
    getStateSnapshot?: (contextId: number, opts?: StateSnapshotOpts) => Promise<StateSnapshotResult>;
    snapshotContext?: SnapshotContextFn;
    resumeClocks?: () => Promise<unknown>;
    haltClocks?: () => Promise<unknown>;
  };
  const capture = {
    table: opts.virtualCapture?.table ?? 'full',
    liveChildOrder: opts.virtualCapture?.liveChildOrder ?? true,
    tree: opts.virtualCapture?.tree ?? true,
    cssom: opts.virtualCapture?.cssom ?? 'scan',
    formProps: opts.virtualCapture?.formProps ?? true,
    frameNewNodes: opts.virtualCapture?.frameNewNodes ?? true,
  } as const;

  if (!session.getStateSnapshot && !session.snapshotContext) {
    return emptyIsoResult([
      { id: 'isomorphism', reason: 'session does not expose getStateSnapshot/snapshotContext' },
    ]);
  }

  try {
    await halt?.call(opts.session);
    const contexts: Record<number, ContextIsoResult> = {};
    for (const contextId of contextIds) {
      const view = await captureVirtualLabSnap(session, contextId, { ...capture });
      const mapped = view.ok
        ? {
            ok: true as const,
            generation: view.generation,
            sequence: view.sequence,
            o2: view.o2 as never,
            table: view.table as never,
            cssomO2: view.cssomO2 as never,
            nodeNewConnected: view.nodeNewConnected,
            cascade: view.cascade ?? null,
            formProps: view.formProps,
            tree: view.tree,
          }
        : { ok: false as const, reason: view.reason ?? 'virtual snapshot failed' };
      contexts[contextId] = await compareContextPair({
        contextId,
        virtual: mapped as never,
        getClientSnapshot: getClient,
      });
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

