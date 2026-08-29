/**
 * Precise nested apply failure diagnostic — correlates desync telemetry, captured wire frames,
 * Virtual snapshots, and **registry-grounded** Projected materialization (not body.childNodes).
 * Lab-only artifact: `probes/nested-apply-failure.json`.
 */

import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import type { BrowserSession } from '../../../../BrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { ClientStateSnapshot } from './isomorphism';
import { captureVirtualLabSnap } from './isomorphism';
import {
  analyzeInsertFailure,
  buildIdMetaThroughSequence,
  type FrameCaptureRing,
} from './frameCaptureRing';
import { collectIframeHits } from './turnstileDiagnostic';

/** Cloudflare Turnstile nested doc — body hosts closed shadow at id 18; widget inside shadow. */
export const TURNSTILE_NESTED_REGISTRY_PROBE_IDS = [17, 18, 19, 21, 138];

type DesyncEvent = {
  contextId?: number;
  sequence?: number;
  generation?: number;
  errorCode?: string;
  phase?: string;
  op?: string;
  message?: string;
  expected?: string;
  actual?: string;
};

export type NestedApplyFailureDiagnostic = {
  capturedAt: string;
  contextIds: number[];
  desyncEvents: DesyncEvent[];
  insertFailures: Array<
    ReturnType<typeof analyzeInsertFailure> & { paths?: Record<number, string> }
  >;
  perContext: Record<
    number,
    {
      virtual: {
        ok: boolean;
        reason?: string;
        sequence: number | null;
        generation: number | null;
        tableRowCount: number | null;
        tableHash: string | null;
        shadowHostCount: number;
        iframeHits: ReturnType<typeof collectIframeHits>;
        idMetaThroughLastFrame: Array<{ id: number; kind: string; name?: string; nestedHost?: boolean }>;
      };
      wire: {
        frameCount: number;
        lastSequences: number[];
      };
      projected: {
        armed: boolean | null;
        desynced: boolean | null;
        applyError: string | null;
        generation: number | null;
        sequence: number | null;
        tableRowCount: number | null;
        tableHash: string | null;
        compat: string | null;
        bodyLen: number | null;
        docIsLive: boolean | null;
        bodyLightChildCount: number | null;
        registryHasDocument: boolean | null;
      };
      registryProbe: ClientStateSnapshot['registryProbe'];
      tableReconciliation: {
        virtualHash: string | null;
        clientHash: string | null;
        virtualSequence: number | null;
        clientSequence: number | null;
        rowCountMatch: boolean | null;
        hashMatch: boolean | null;
        applierDesynced: boolean | null;
        note: string;
      };
    }
  >;
  hypothesis: string[];
};

function countShadowHosts(node: TreeNode | undefined): number {
  if (!node) return 0;
  let n = 0;
  const walk = (cur: TreeNode): void => {
    if (cur.shadow) {
      n += 1;
      walk(cur.shadow);
    }
    if (cur.nested) walk(cur.nested);
    for (const c of cur.children ?? []) walk(c);
  };
  walk(node);
  return n;
}

function buildHypothesis(
  insertFailures: NestedApplyFailureDiagnostic['insertFailures'],
  perContext: NestedApplyFailureDiagnostic['perContext'],
): string[] {
  const out: string[] = [];
  for (const f of insertFailures) {
    if (!f.frameFound) {
      out.push(`ctx${f.contextId}: desync on INSERT but frame not in capture ring (sequence ${f.sequence})`);
      continue;
    }
    const parent = f.parentMeta?.label ?? `id=${f.insert.parent}`;
    const childLabels = f.childMeta
      .map((c) => (c.meta ? `${c.meta.label}${c.meta.name ? `<${c.meta.name}>` : ''}` : `id=${c.id}`))
      .join(', ');
    out.push(
      `ctx${f.contextId} seq${f.sequence} op[${f.opIndex}]: INSERT parent=${f.insert.parent}(${parent}) before=${f.insert.before} ids=[${f.insert.ids.join(',')}] children=[${childLabels}]`,
    );
    if (f.parentMeta?.label === 'ShadowRoot') {
      out.push(`ctx${f.contextId}: INSERT under ShadowRoot — expected for Turnstile (body hosts closed shadow)`);
    }
  }

  for (const [ctxKey, block] of Object.entries(perContext)) {
    const ctxId = Number(ctxKey);
    const probe = block.registryProbe;
    const recon = block.tableReconciliation;
    const bodyHostId = 17;
    const shadowId = 18;

    if (recon.hashMatch === false && recon.applierDesynced === false) {
      out.push(
        `ctx${ctxId}: RECONCILE — iso hash mismatch at snapshot (virtual=${recon.virtualHash} client=${recon.clientHash}) while applier desynced=false; frame preTableHash checks passed incrementally — compare at same sequence ${recon.virtualSequence}/${recon.clientSequence}`,
      );
    }

    if (!probe?.ok) {
      if (probe?.reason) out.push(`ctx${ctxId}: registry probe unavailable (${probe.reason})`);
      continue;
    }

    const bodyNode = probe.nodes.find((n) => n.id === bodyHostId);
    const shadowNode = probe.nodes.find((n) => n.id === shadowId);
    const shadowChildCount = shadowNode?.childCount ?? 0;

    out.push(
      `ctx${ctxId}: body light children=${probe.bodyLightChildCount} (expected 0 when body hosts shadow)`,
    );

    if (!shadowNode?.present) {
      out.push(`ctx${ctxId}: APPLY FAIL — registry missing ShadowRoot id=${shadowId}`);
    } else if (shadowChildCount === 0) {
      out.push(`ctx${ctxId}: APPLY FAIL — ShadowRoot id=${shadowId} present but childNodes.length=0`);
    } else {
      out.push(
        `ctx${ctxId}: APPLY OK — ShadowRoot id=${shadowId} childNodes=${shadowChildCount} hostId=${shadowNode.shadowHostId} (expect host=${bodyHostId})`,
      );
      if (shadowNode.shadowHostId !== bodyHostId) {
        out.push(`ctx${ctxId}: shadow host id mismatch — attached to wrong element`);
      }
      const widgetSample = probe.nodes.find((n) => n.id === 138 || n.id === 19 || n.id === 21);
      if (widgetSample?.present && widgetSample.rect) {
        const r = widgetSample.rect;
        if (r.width <= 0 || r.height <= 0) {
          out.push(
            `ctx${ctxId}: RENDER — node id=${widgetSample.id} materialized but rect=${r.width}x${r.height} (geometry/visibility)`,
          );
        } else {
          out.push(
            `ctx${ctxId}: RENDER OK — node id=${widgetSample.id} rect=${r.width}x${r.height} at (${r.x},${r.y})`,
          );
        }
      }
    }

    if (bodyNode?.present && (bodyNode.childCount ?? 0) > 0) {
      out.push(`ctx${ctxId}: body has ${bodyNode.childCount} light child(ren) — unexpected if shadow-only host`);
    }
  }

  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function snapshotWithRetry(
  fn: () => Promise<ClientStateSnapshot | null>,
  attempts = 8,
  delayMs = 150,
): Promise<ClientStateSnapshot | null> {
  for (let i = 0; i < attempts; i++) {
    const snap = await fn();
    if (snap) return snap;
    await sleep(delayMs);
  }
  return null;
}

export async function runNestedApplyFailureDiagnostic(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  frameCapture: FrameCaptureRing;
  getClientSnapshot?: (
    contextId: number,
    options?: { includeNestedPeek?: boolean; registryProbeNodeIds?: number[] },
  ) => Promise<ClientStateSnapshot | null>;
  registryProbeNodeIds?: number[];
}): Promise<NestedApplyFailureDiagnostic> {
  const { chassis, session, frameCapture, getClientSnapshot } = opts;
  const probeIds = opts.registryProbeNodeIds ?? TURNSTILE_NESTED_REGISTRY_PROBE_IDS;
  const contextIds = chassis.contextIndex.list();
  const desyncEvents = (chassis.desyncs as DesyncEvent[]).map((d) => ({ ...d }));

  const insertFailures: NestedApplyFailureDiagnostic['insertFailures'] = desyncEvents
    .filter((d) => d.contextId != null && d.contextId >= 2 && d.message?.includes('@op['))
    .map((d) =>
      analyzeInsertFailure({
        contextId: d.contextId!,
        sequence: d.sequence ?? 0,
        message: d.message ?? null,
        frames: frameCapture.listFrames(d.contextId!),
      }),
    )
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const nestedPeek =
    getClientSnapshot != null
      ? ((await getClientSnapshot(1, { includeNestedPeek: true }))?.nestedPeek as
          | {
              sessions: Array<{
                contextId: number;
                armed: boolean;
                desynced: boolean;
                applyError: string | null;
                generation: number;
                compat: string | null;
                bodyLen: number;
                docIsLive: boolean | null;
                bodyChildCount?: number | null;
                registryHasDocument?: boolean | null;
              }>;
            }
          | undefined)
      : undefined;
  const peekByCtx = new Map((nestedPeek?.sessions ?? []).map((s) => [s.contextId, s]));

  const perContext: NestedApplyFailureDiagnostic['perContext'] = {};

  try {
    await session.haltClocks?.();
    for (const contextId of contextIds.filter((id) => id >= 2)) {
      const wireFrames = frameCapture.listFrames(contextId);
      const lastSeq = desyncEvents
        .filter((d) => d.contextId === contextId && typeof d.sequence === 'number')
        .map((d) => d.sequence as number)
        .sort((a, b) => b - a)[0];
      const meta = buildIdMetaThroughSequence(wireFrames, lastSeq ?? wireFrames.at(-1)?.sequence ?? 0);

      const view = await captureVirtualLabSnap(session as never, contextId, {
        table: 'full',
        tree: true,
        cssom: 'none',
        formProps: false,
        frameNewNodes: false,
        liveChildOrder: false,
      });

      let clientCtx: ClientStateSnapshot | null = null;
      if (getClientSnapshot) {
        clientCtx = await snapshotWithRetry(() =>
          getClientSnapshot(contextId, { registryProbeNodeIds: probeIds }),
        );
      }

      const registryProbe = clientCtx?.registryProbe ?? null;
      const peek = peekByCtx.get(contextId);
      const virtualHash = view.ok ? (view.table?.tableHash ?? null) : null;
      const clientHash =
        registryProbe?.applierTableHash ??
        clientCtx?.table?.tableHash ??
        null;
      const virtualSeq = view.ok ? (view.sequence ?? null) : null;
      const clientSeq =
        registryProbe?.applierSequence ?? clientCtx?.sequence ?? null;
      const virtualRows = view.ok ? (view.table?.rowCount ?? null) : null;
      const clientRows =
        registryProbe?.applierTableRows ??
        clientCtx?.table?.rowCount ??
        null;

      perContext[contextId] = {
        virtual: view.ok
          ? {
              ok: true,
              sequence: virtualSeq,
              generation: view.generation ?? null,
              tableRowCount: virtualRows,
              tableHash: virtualHash,
              shadowHostCount: countShadowHosts(view.tree as TreeNode | undefined),
              iframeHits: view.tree ? collectIframeHits(view.tree as TreeNode) : [],
              idMetaThroughLastFrame: [...meta.entries()].map(([id, m]) => ({
                id,
                kind: m.label,
                name: m.name,
                nestedHost: m.nestedHost,
              })),
            }
          : {
              ok: false,
              reason: view.reason ?? 'snapshot failed',
              sequence: null,
              generation: null,
              tableRowCount: null,
              tableHash: null,
              shadowHostCount: 0,
              iframeHits: [],
              idMetaThroughLastFrame: [],
            },
        wire: {
          frameCount: wireFrames.length,
          lastSequences: wireFrames.slice(-5).map((f) => f.sequence),
        },
        projected: {
          armed: clientCtx?.armed ?? peek?.armed ?? null,
          desynced: registryProbe?.applierDesynced ?? clientCtx?.desynced ?? peek?.desynced ?? null,
          applyError: clientCtx?.applyError ?? peek?.applyError ?? null,
          generation: registryProbe?.applierGeneration ?? clientCtx?.generation ?? peek?.generation ?? null,
          sequence: clientSeq,
          tableRowCount: clientRows,
          tableHash: clientHash,
          compat: peek?.compat ?? null,
          bodyLen: peek?.bodyLen ?? null,
          docIsLive: peek?.docIsLive ?? null,
          bodyLightChildCount:
            registryProbe?.bodyLightChildCount ?? peek?.bodyChildCount ?? null,
          registryHasDocument: peek?.registryHasDocument ?? null,
        },
        registryProbe,
        tableReconciliation: {
          virtualHash,
          clientHash,
          virtualSequence: virtualSeq,
          clientSequence: clientSeq,
          rowCountMatch:
            virtualRows != null && clientRows != null ? virtualRows === clientRows : null,
          hashMatch: virtualHash != null && clientHash != null ? virtualHash === clientHash : null,
          applierDesynced: registryProbe?.applierDesynced ?? clientCtx?.desynced ?? null,
          note:
            'desynced=false means each frame preTableHash passed on ingest; hashMatch compares halted Virtual vs client registry snapshot at probe — both can diverge if iso timing differs',
        },
      };
    }
  } finally {
    await session.resumeClocks?.();
  }

  return {
    capturedAt: new Date().toISOString(),
    contextIds,
    desyncEvents,
    insertFailures,
    perContext,
    hypothesis: buildHypothesis(insertFailures, perContext),
  };
}

export function foldNestedApplyFailure(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { nestedApplyFailure?: NestedApplyFailureDiagnostic }).nestedApplyFailure;
  if (!diag) {
    return [{ id: 'nestedApply.probe', status: 'fail', reason: 'probe did not run' }];
  }
  const verdicts: LabVerdict[] = [
    { id: 'nestedApply.probe', status: 'pass', reason: diag.capturedAt },
  ];
  const nestedDesyncs = diag.desyncEvents.filter((d) => (d.contextId ?? 0) >= 2);
  verdicts.push({
    id: 'nestedApply.desyncCount',
    status: nestedDesyncs.length === 0 ? 'pass' : 'fail',
    reason: `${nestedDesyncs.length} nested desync(s)`,
  });

  const registryVerdict = diag.hypothesis.find(
    (h) => h.includes('APPLY FAIL') || h.includes('APPLY OK') || h.includes('RENDER'),
  );
  if (registryVerdict) {
    verdicts.push({
      id: 'nestedApply.registryMaterialization',
      status: registryVerdict.includes('APPLY FAIL') ? 'fail' : 'pass',
      reason: registryVerdict,
    });
  } else {
    verdicts.push({
      id: 'nestedApply.registryMaterialization',
      status: 'skipped',
      reason: 'no registry probe',
    });
  }

  if (diag.insertFailures.length > 0) {
    verdicts.push({
      id: 'nestedApply.insertFailure',
      status: 'fail',
      reason: diag.hypothesis.find((h) => h.includes('INSERT parent')) ?? diag.insertFailures[0]!.insert.parent.toString(),
    });
  } else if (nestedDesyncs.length > 0) {
    verdicts.push({
      id: 'nestedApply.insertFailure',
      status: 'fail',
      reason: nestedDesyncs[0]?.message ?? 'nested desync',
    });
  } else {
    verdicts.push({ id: 'nestedApply.insertFailure', status: 'pass', reason: 'none' });
  }
  return verdicts;
}
