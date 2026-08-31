/**
 * Objective Turnstile / Cloudflare challenge diagnostic — state snapshots + live DOM,
 * not protocol-only greens. Lab-only; dossier artifact `probes/turnstile-diagnostic.json`.
 */

import type { TreeNode } from '@speculum/page-projection/core/treeNode';
import type { BrowserSession } from '../../../../BrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { ClientStateSnapshot, IsomorphismResult } from './isomorphism';
import { captureVirtualLabSnap, runIsomorphism } from './isomorphism';
import { countNestedDocuments, countShadowTrees, collectFrameHrefs } from './structuralDiff';

/** Virtual main-frame live DOM — CDP evaluate; cross-origin iframe content is not readable. */
export const VIRTUAL_LIVE_DOM_EXPR = `(() => {
  const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({
    id: f.id || null,
    src: (f.src || f.getAttribute('src') || '').slice(0, 512),
    sandbox: f.getAttribute('sandbox'),
    w: f.offsetWidth,
    h: f.offsetHeight,
    display: getComputedStyle(f).display,
    visibility: getComputedStyle(f).visibility,
  }));
  const cfIframes = iframes.filter(
    (f) =>
      (f.id || '').startsWith('cf-chl') ||
      (f.src || '').includes('challenges.cloudflare.com') ||
      (f.src || '').includes('turnstile'),
  );
  const shadowHosts = [...document.querySelectorAll('*')].filter((el) => el.shadowRoot).length;
  const hiddenInputs = [...document.querySelectorAll('input[type="hidden"]')]
    .filter((el) => (el.id || el.name || '').includes('cf-chl') || (el.name || '').includes('turnstile'))
    .map((el) => ({ id: el.id || null, name: el.name || null, valueLen: (el.value || '').length }));
  const bodyText = norm(document.body?.innerText ?? '').slice(0, 400);
  return JSON.stringify({
    url: location.href,
    title: document.title,
    iframeCount: iframes.length,
    cfIframeCount: cfIframes.length,
    cfIframes,
    iframes,
    shadowHosts,
    hiddenInputs,
    hasChallengeCopy:
      /just a moment|security verification|verify you are human|checking your browser/i.test(
        document.title + ' ' + bodyText,
      ),
    bodyLen: document.body?.innerHTML?.length ?? 0,
    bodyTextSample: bodyText,
  });
})()`;

export type LiveDomProbe = {
  url: string;
  title: string;
  iframeCount: number;
  cfIframeCount: number;
  cfIframes: Array<{
    id: string | null;
    src: string;
    sandbox: string | null;
    w: number;
    h: number;
    display: string;
    visibility: string;
  }>;
  iframes: LiveDomProbe['cfIframes'];
  shadowHosts: number;
  hiddenInputs: Array<{ id: string | null; name: string | null; valueLen: number }>;
  hasChallengeCopy: boolean;
  bodyLen: number;
  bodyTextSample: string;
};

export type IframeTreeHit = {
  path: string;
  tag: string;
  id: string | null;
  src: string | null;
  sandbox: string | null;
  frameHref: string | null;
};

export type ProjectedNestedPeek = {
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
};

export type TurnstileDiagnostic = {
  capturedAt: string;
  contextIds: number[];
  virtualLiveDom: { ok: true; value: LiveDomProbe } | { ok: false; error: string };
  virtualContexts: Record<
    number,
    {
      ok: boolean;
      reason?: string;
      sequence: number | null;
      generation: number | null;
      tableRowCount: number | null;
      iframeHits: IframeTreeHit[];
      cfIframeInTree: boolean;
      nestedDocCount: number;
      shadowHostCount: number;
      frameHrefs: string[];
    }
  >;
  projectedRoot: {
    sequence: number | null;
    generation: number | null;
    armed: boolean | null;
    desynced: boolean | null;
    applyError: string | null;
    resyncInFlight: boolean | null;
    iframeHits: IframeTreeHit[];
    cfIframeInTree: boolean;
    nestedDocCount: number;
    shadowHostCount: number;
  } | null;
  projectedNestedPeek: ProjectedNestedPeek | null;
  iso: {
    sequence: number | null;
    generation: number | null;
    structuralIdentical: boolean | null;
    structuralDivergenceCount: number | null;
    nestedVirtualDocs: number;
    nestedClientDocs: number;
    shadowVirtualHosts: number;
    shadowClientHosts: number;
    allPass: boolean;
  };
  telemetry: {
    consoleCount: number;
    desyncCount: number;
    desyncSamples: unknown[];
  };
};

function attrMap(node: TreeNode): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of node.attrs ?? []) {
    if (Array.isArray(pair) && pair.length >= 2) m.set(String(pair[0]), String(pair[1]));
  }
  return m;
}

export function collectIframeHits(node: TreeNode, path = '#document'): IframeTreeHit[] {
  const out: IframeTreeHit[] = [];
  const tag = node.tag ?? '';
  if (tag.toLowerCase() === 'iframe') {
    const attrs = attrMap(node);
    out.push({
      path,
      tag,
      id: attrs.get('id') ?? null,
      src: attrs.get('src') ?? null,
      sandbox: attrs.get('sandbox') ?? null,
      frameHref: node.frameHref ?? null,
    });
  }
  if (node.shadow) out.push(...collectIframeHits(node.shadow, `${path}::shadow`));
  if (node.nested) out.push(...collectIframeHits(node.nested, `${path}::nested`));
  for (let i = 0; i < (node.children ?? []).length; i++) {
    const child = node.children![i]!;
    const childTag = child.tag ?? `#${i}`;
    out.push(...collectIframeHits(child, `${path}/${childTag}[${i}]`));
  }
  return out;
}

function isCfIframeHit(hit: IframeTreeHit): boolean {
  const id = hit.id ?? '';
  const src = hit.src ?? hit.frameHref ?? '';
  return id.startsWith('cf-chl') || /challenges\.cloudflare\.com|turnstile/i.test(src);
}

function parseLiveDom(raw: string | undefined): { ok: true; value: LiveDomProbe } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'evaluate returned empty' };
  try {
    return { ok: true, value: JSON.parse(raw) as LiveDomProbe };
  } catch {
    return { ok: false, error: `evaluate parse failed: ${raw.slice(0, 200)}` };
  }
}

export async function runTurnstileDiagnostic(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  getClientSnapshot?: (
    contextId: number,
    options?: { includeNestedPeek?: boolean },
  ) => Promise<ClientStateSnapshot | null>;
}): Promise<TurnstileDiagnostic> {
  const { chassis, session, getClientSnapshot } = opts;

  // Single halt instant: context index, live DOM, virtual snapshots, client peek, and iso
  // must read the same frozen moment (nested contexts can drop between separate probes).
  let contextIds: number[] = [];
  let virtualLiveDom: TurnstileDiagnostic['virtualLiveDom'] = { ok: false, error: 'no evaluate' };
  const virtualContexts: TurnstileDiagnostic['virtualContexts'] = {};
  let projectedRoot: TurnstileDiagnostic['projectedRoot'] = null;
  let projectedNestedPeek: ProjectedNestedPeek | null = null;
  let iso: IsomorphismResult = {
    sequence: null,
    generation: null,
    o2: null,
    cssomO2: null,
    table: { virtual: null, client: null, identical: null },
    tableFailReason: null,
    structuralDiff: null,
    skipped: [{ id: 'isomorphism', reason: 'not run' }],
    nodeNewConnected: null,
    cascade: null,
    formProps: { virtual: null, client: null, identical: null, reason: null },
    shadow: null,
    nested: null,
    contexts: {},
    allPass: false,
  };

  try {
    await session.haltClocks?.();
    contextIds = chassis.contextIndex.list();

    try {
      const r = await session.evaluate(VIRTUAL_LIVE_DOM_EXPR);
      virtualLiveDom = r.ok ? parseLiveDom(r.value) : { ok: false, error: r.errorMessage ?? 'evaluate failed' };
    } catch (err) {
      virtualLiveDom = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    for (const contextId of contextIds) {
      const view = await captureVirtualLabSnap(session as never, contextId, {
        table: 'full',
        tree: true,
        cssom: 'none',
        formProps: true,
        frameNewNodes: true,
        liveChildOrder: true,
      });
      if (!view.ok) {
        virtualContexts[contextId] = {
          ok: false,
          reason: view.reason ?? 'snapshot failed',
          sequence: null,
          generation: null,
          tableRowCount: null,
          iframeHits: [],
          cfIframeInTree: false,
          nestedDocCount: 0,
          shadowHostCount: 0,
          frameHrefs: [],
        };
        continue;
      }
      const tree = view.tree as TreeNode | undefined;
      const iframeHits = tree ? collectIframeHits(tree) : [];
      virtualContexts[contextId] = {
        ok: true,
        sequence: view.sequence ?? null,
        generation: view.generation ?? null,
        tableRowCount: view.table?.rowCount ?? null,
        iframeHits,
        cfIframeInTree: iframeHits.some(isCfIframeHit),
        nestedDocCount: tree ? countNestedDocuments(tree) : 0,
        shadowHostCount: tree ? countShadowTrees(tree) : 0,
        frameHrefs: tree ? collectFrameHrefs(tree) : [],
      };
    }

    if (getClientSnapshot) {
      const snap = await getClientSnapshot(1, { includeNestedPeek: true });
      if (snap) {
        projectedNestedPeek = (snap.nestedPeek as ProjectedNestedPeek | undefined) ?? null;
        const tree = snap.tree;
        const iframeHits = tree ? collectIframeHits(tree) : [];
        projectedRoot = {
          sequence: snap.sequence ?? null,
          generation: snap.generation ?? null,
          armed: snap.armed ?? null,
          desynced: snap.desynced ?? null,
          applyError: snap.applyError ?? null,
          resyncInFlight: snap.resyncInFlight ?? null,
          iframeHits,
          cfIframeInTree: iframeHits.some(isCfIframeHit),
          nestedDocCount: tree ? countNestedDocuments(tree) : 0,
          shadowHostCount: tree ? countShadowTrees(tree) : 0,
        };
      }
    }

    iso = await runIsomorphism({
      session,
      contextIds,
      getClientSnapshot: getClientSnapshot
        ? (contextId) => getClientSnapshot(contextId)
        : undefined,
      virtualCapture: {
        table: 'full',
        tree: true,
        cssom: 'scan',
        formProps: true,
        frameNewNodes: true,
        liveChildOrder: true,
      },
    });
    chassis.journal.iso = iso;
  } finally {
    await session.resumeClocks?.();
  }

  return {
    capturedAt: new Date().toISOString(),
    contextIds,
    virtualLiveDom,
    virtualContexts,
    projectedRoot,
    projectedNestedPeek,
    iso: {
      sequence: iso.sequence,
      generation: iso.generation,
      structuralIdentical: iso.structuralDiff?.identical ?? null,
      structuralDivergenceCount: iso.structuralDiff?.divergenceCount ?? null,
      nestedVirtualDocs: iso.nested?.virtualDocs ?? 0,
      nestedClientDocs: iso.nested?.clientDocs ?? 0,
      shadowVirtualHosts: iso.shadow?.virtualHosts ?? 0,
      shadowClientHosts: iso.shadow?.clientHosts ?? 0,
      allPass: iso.allPass ?? false,
    },
    telemetry: {
      consoleCount: chassis.journal.consoleCount,
      desyncCount: chassis.desyncs.length,
      desyncSamples: chassis.desyncs.slice(0, 20),
    },
  };
}

export function foldTurnstileDiagnostic(chassis: LabChassis): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  const diag = (chassis.journal as { turnstileDiagnostic?: TurnstileDiagnostic }).turnstileDiagnostic;

  if (!chassis.hasClientRelay) {
    verdicts.push({
      id: 'turnstile.client.connected',
      status: 'fail',
      reason: 'no DOM client — run via lab UI (Projected apply surface required)',
    });
    return verdicts;
  }
  verdicts.push({ id: 'turnstile.client.connected', status: 'pass', reason: 'Projected relay bound' });

  if (!diag) {
    verdicts.push({
      id: 'turnstile.probe.ran',
      status: 'fail',
      reason: 'probe.turnstile action did not run',
    });
    return verdicts;
  }
  verdicts.push({ id: 'turnstile.probe.ran', status: 'pass', reason: diag.capturedAt });

  if (diag.virtualLiveDom.ok && diag.virtualLiveDom.value.hasChallengeCopy) {
    verdicts.push({
      id: 'turnstile.virtual.challengePage',
      status: 'pass',
      reason: `title=${diag.virtualLiveDom.value.title.slice(0, 80)}`,
    });
  } else if (diag.virtualLiveDom.ok) {
    verdicts.push({
      id: 'turnstile.virtual.challengePage',
      status: 'fail',
      reason: `challenge copy absent url=${diag.virtualLiveDom.value.url}`,
    });
  } else {
    verdicts.push({
      id: 'turnstile.virtual.challengePage',
      status: 'fail',
      reason: diag.virtualLiveDom.error,
    });
  }

  const liveCf =
    diag.virtualLiveDom.ok && diag.virtualLiveDom.value.cfIframeCount > 0
      ? diag.virtualLiveDom.value.cfIframes
      : [];
  verdicts.push({
    id: 'turnstile.virtual.liveDom.cfIframe',
    status: liveCf.length > 0 ? 'pass' : 'fail',
    reason:
      liveCf.length > 0
        ? `${liveCf.length} cf iframe(s) in Virtual live DOM (${liveCf.map((f) => f.id ?? f.src.slice(0, 60)).join('; ')})`
        : `live DOM iframeCount=${diag.virtualLiveDom.ok ? diag.virtualLiveDom.value.iframeCount : '?'} cf=0`,
  });

  const tableCf = Object.values(diag.virtualContexts).some((c) => c.cfIframeInTree);
  const tableIframeCount = Object.values(diag.virtualContexts).reduce((n, c) => n + c.iframeHits.length, 0);
  verdicts.push({
    id: 'turnstile.virtual.table.cfIframe',
    status: tableCf ? 'pass' : 'fail',
    reason: tableCf
      ? 'cf iframe node present in Virtual state snapshot tree'
      : `no cf iframe in Virtual table tree (iframe nodes=${tableIframeCount})`,
  });

  const nestedCtx = diag.contextIds.filter((id) => id >= 2);
  verdicts.push({
    id: 'turnstile.virtual.nestedContext',
    status: nestedCtx.length > 0 ? 'pass' : 'fail',
    reason:
      nestedCtx.length > 0
        ? `contextIds=${nestedCtx.join(',')}`
        : 'no nested context minted (contextId≥2 absent at probe)',
  });

  const peek = diag.projectedNestedPeek;
  const clientNested =
    (peek?.nested.length ?? 0) > 0 ||
    (peek?.awaiting.length ?? 0) > 0 ||
    diag.iso.nestedClientDocs > 0;
  verdicts.push({
    id: 'turnstile.projected.nestedBound',
    status: clientNested ? 'pass' : 'fail',
    reason: peek
      ? `nested=${peek.nested.join(',') || 'none'} awaiting=${peek.awaiting.join(',') || 'none'} iso.clientDocs=${diag.iso.nestedClientDocs}`
      : `iso.clientDocs=${diag.iso.nestedClientDocs} (no nestedPeek)`,
  });

  const projectedCf = diag.projectedRoot?.cfIframeInTree === true;
  verdicts.push({
    id: 'turnstile.projected.table.cfIframe',
    status: projectedCf ? 'pass' : 'fail',
    reason: projectedCf
      ? 'cf iframe in Projected snapshot tree'
      : `Projected iframe nodes=${diag.projectedRoot?.iframeHits.length ?? 0} cf=0`,
  });

  const rootOk =
    diag.projectedRoot?.armed === true &&
    diag.projectedRoot.desynced !== true &&
    !diag.projectedRoot.applyError;
  verdicts.push({
    id: 'turnstile.projected.surface',
    status: rootOk ? 'pass' : 'fail',
    reason: diag.projectedRoot
      ? `armed=${diag.projectedRoot.armed} desynced=${diag.projectedRoot.desynced} applyError=${diag.projectedRoot.applyError ?? 'null'}`
      : 'no projected root snapshot',
  });

  if (diag.iso.structuralIdentical === true) {
    verdicts.push({
      id: 'turnstile.iso.rootTree',
      status: 'pass',
      reason: `identical at sequence ${diag.iso.sequence ?? '?'}`,
    });
  } else if (diag.iso.structuralIdentical === false) {
    verdicts.push({
      id: 'turnstile.iso.rootTree',
      status: 'fail',
      reason: `${diag.iso.structuralDivergenceCount ?? '?'} structural divergences at sequence ${diag.iso.sequence ?? '?'}`,
    });
  } else {
    verdicts.push({
      id: 'turnstile.iso.rootTree',
      status: 'skipped',
      reason: 'no structural diff (client tree missing)',
    });
  }

  const widgetPainted =
    (peek?.sessions.some((s) => s.bodyLen > 0) ?? false) ||
    (diag.projectedRoot?.nestedDocCount ?? 0) > 0;
  verdicts.push({
    id: 'turnstile.projected.widgetPainted',
    status: widgetPainted ? 'pass' : 'fail',
    reason: peek
      ? peek.sessions.map((s) => `ctx${s.contextId}:bodyLen=${s.bodyLen}`).join(' ') || 'no nested sessions'
      : `nestedDocCount=${diag.projectedRoot?.nestedDocCount ?? 0}`,
  });

  if (diag.telemetry.desyncCount > 0) {
    verdicts.push({
      id: 'turnstile.telemetry.desync',
      status: 'fail',
      reason: `${diag.telemetry.desyncCount} desync event(s) — see dossier telemetry`,
    });
  } else {
    verdicts.push({
      id: 'turnstile.telemetry.desync',
      status: 'pass',
      reason: 'no desync events at probe',
    });
  }

  return verdicts;
}
