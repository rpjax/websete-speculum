/**
 * Turnstile widget parity probe — distinguishes readoption gap (a) vs dead nested context (b)
 * when Projected loses the challenge iframe subtree without desync telemetry.
 * Lab artifact: `probes/turnstile-widget-parity.json`.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { LabChassis } from '../host/chassis';
import {
  VIRTUAL_LIVE_DOM_EXPR,
  type LiveDomProbe,
  type ProjectedNestedPeek,
} from './turnstileDiagnostic';

export type WidgetHostSide = 'virtual' | 'projected';

export type WidgetHostRecord = {
  side: WidgetHostSide;
  domId: string | null;
  src: string;
  w: number;
  h: number;
  registryNodeId: number | null;
  nestedContextId: number | null;
  awaitingLoad: boolean;
  pendingFrameCount: number;
  inNestedMap: boolean;
  isConnected: boolean | null;
  nestedLive: {
    bodyLen: number | null;
    iframeCount: number | null;
    generation: number | null;
    armed: boolean | null;
    desynced: boolean | null;
    docIsLive: boolean | null;
  } | null;
};

export type ProjectedWidgetHostPayload = {
  capturedAt: string;
  rootGeneration: number;
  hosts: Omit<WidgetHostRecord, 'side'>[];
  nestedPeek: ProjectedNestedPeek;
};

export type TurnstileWidgetParityVerdict =
  | 'a_readoption'
  | 'b_dead_nested'
  | 'matched'
  | 'inconclusive';

export type TurnstileWidgetParity = {
  capturedAt: string;
  virtualGeneration: number | null;
  projectedGeneration: number | null;
  virtualLiveDom: { ok: true; value: LiveDomProbe } | { ok: false; error: string };
  virtualChildScopeHosts: Array<{
    contextId: number;
    hostNodeId: number;
    domId: string | null;
    src: string;
    w: number;
    h: number;
    isConnected: boolean;
    isCf: boolean;
    nestedLive: WidgetHostRecord['nestedLive'];
  }>;
  virtualRootCfIframes: Array<{
    domId: string | null;
    src: string;
    w: number;
    h: number;
    registryNodeId: number | null;
    nestedContextId: number | null;
  }>;
  projectedHosts: WidgetHostRecord[];
  projectedNestedPeek: ProjectedNestedPeek | null;
  pairs: Array<{
    matchKey: string;
    virtualNodeId: number | null;
    projectedNodeId: number | null;
    virtualContextId: number | null;
    projectedContextId: number | null;
    nodeIdMatch: boolean | null;
  }>;
  verdict: TurnstileWidgetParityVerdict;
  hypothesis: string[];
};

type ListChildScopeHostsResult = {
  ok?: boolean;
  reason?: string;
  generation?: number;
  hosts?: Array<{
    contextId: number;
    hostNodeId: number;
    domId: string | null;
    src: string;
    w: number;
    h: number;
    isConnected: boolean;
  }>;
};

type NestedLiveProbe = NonNullable<WidgetHostRecord['nestedLive']>;

const NESTED_LIVE_EXPR = `(() => JSON.stringify({
  bodyLen: document.body?.innerHTML?.length ?? 0,
  iframeCount: document.querySelectorAll('iframe').length,
}))()`;

function isCfHost(domId: string | null, src: string): boolean {
  const id = domId ?? '';
  return id.startsWith('cf-chl') || /challenges\.cloudflare\.com|turnstile/i.test(src);
}

function hostMatchKey(domId: string | null, src: string): string {
  if (domId) return `id:${domId}`;
  const trimmed = src.slice(0, 120);
  return trimmed ? `src:${trimmed}` : 'unknown';
}

function selectorForDomId(domId: string): string {
  return `[id="${domId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function parseLiveDom(raw: string | undefined): { ok: true; value: LiveDomProbe } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'evaluate returned empty' };
  try {
    return { ok: true, value: JSON.parse(raw) as LiveDomProbe };
  } catch {
    return { ok: false, error: `evaluate parse failed: ${raw.slice(0, 200)}` };
  }
}

async function probeVirtualNestedLive(
  session: BrowserSession,
  contextId: number,
): Promise<NestedLiveProbe> {
  const evaluate = (
    session as {
      evaluateVirtualExpression?: (code: string, contextId?: number) => Promise<unknown>;
    }
  ).evaluateVirtualExpression;
  if (!evaluate) {
    return {
      bodyLen: null,
      iframeCount: null,
      generation: null,
      armed: null,
      desynced: null,
      docIsLive: null,
    };
  }
  let bodyLen: number | null = null;
  let iframeCount: number | null = null;
  try {
    const raw = await evaluate(NESTED_LIVE_EXPR, contextId);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as { bodyLen?: number; iframeCount?: number };
      bodyLen = typeof parsed.bodyLen === 'number' ? parsed.bodyLen : null;
      iframeCount = typeof parsed.iframeCount === 'number' ? parsed.iframeCount : null;
    }
  } catch {
    /* xo or dead context */
  }
  return {
    bodyLen,
    iframeCount,
    generation: null,
    armed: null,
    desynced: null,
    docIsLive: bodyLen != null || iframeCount != null ? true : null,
  };
}

async function keyVirtualSelector(
  session: BrowserSession,
  selector: string,
): Promise<number | null> {
  const invoke = (
    session as {
      loopbackKeyOfSelector?: (selector: string) => Promise<{ ok?: boolean; nodeId?: number }>;
    }
  ).loopbackKeyOfSelector;
  if (!invoke) return null;
  const r = await invoke(selector);
  return r.ok && typeof r.nodeId === 'number' ? r.nodeId : null;
}

function buildHypothesisAndVerdict(input: {
  virtualRootCf: TurnstileWidgetParity['virtualRootCfIframes'];
  virtualChildCf: TurnstileWidgetParity['virtualChildScopeHosts'];
  projectedCf: WidgetHostRecord[];
  projectedNestedPeek: ProjectedNestedPeek | null;
  pairs: TurnstileWidgetParity['pairs'];
}): { verdict: TurnstileWidgetParityVerdict; hypothesis: string[] } {
  const hyp: string[] = [];
  const { virtualRootCf, virtualChildCf, projectedCf, projectedNestedPeek, pairs } = input;

  const vCfCount = virtualRootCf.length + virtualChildCf.filter((h) => h.isCf).length;
  const pCfCount = projectedCf.length;

  if (vCfCount > 0 && pCfCount === 0) {
    hyp.push(
      '(a) Virtual has CF challenge iframe(s) but Projected registry/live DOM has none — readoption or stream gap',
    );
    return { verdict: 'a_readoption', hypothesis: hyp };
  }

  for (const pair of pairs) {
    if (pair.virtualNodeId != null && pair.projectedNodeId != null && pair.nodeIdMatch === false) {
      hyp.push(
        `(a) Same host key ${pair.matchKey} but nodeId differs virtual=${pair.virtualNodeId} projected=${pair.projectedNodeId} — iframe recreated, not readopted`,
      );
      return { verdict: 'a_readoption', hypothesis: hyp };
    }
  }

  for (const p of projectedCf) {
    if (p.awaitingLoad || p.pendingFrameCount > 0) {
      hyp.push(
        `(a) Projected host nodeId=${p.registryNodeId ?? '?'} ctx=${p.nestedContextId ?? '?'} awaitingLoad=${p.awaitingLoad} pendingFrames=${p.pendingFrameCount}`,
      );
      return { verdict: 'a_readoption', hypothesis: hyp };
    }
    if (p.registryNodeId != null && !p.inNestedMap && p.nestedContextId == null) {
      hyp.push(
        `(a) Projected CF iframe nodeId=${p.registryNodeId} not in nested map — host never bound to nested apply`,
      );
      return { verdict: 'a_readoption', hypothesis: hyp };
    }
  }

  for (const p of projectedCf) {
    const ctxId = p.nestedContextId;
    if (ctxId == null) continue;
    const peekSession = projectedNestedPeek?.sessions.find((s) => s.contextId === ctxId);
    const vNested = virtualChildCf.find((h) => h.contextId === ctxId);
    const vBody = vNested?.nestedLive?.bodyLen ?? null;
    const pBody = peekSession?.bodyLen ?? p.nestedLive?.bodyLen ?? null;

    if (peekSession?.docIsLive === false) {
      hyp.push(
        `(b) ctx${ctxId}: applier document !== live contentDocument — nested context stale/orphaned`,
      );
      return { verdict: 'b_dead_nested', hypothesis: hyp };
    }
    if (typeof vBody === 'number' && vBody > 0 && (pBody === 0 || pBody == null)) {
      hyp.push(
        `(b) ctx${ctxId}: Virtual nested bodyLen=${vBody} but Projected bodyLen=${pBody ?? 0} — widget subtree not delivered`,
      );
      return { verdict: 'b_dead_nested', hypothesis: hyp };
    }
    if (peekSession && !peekSession.desynced && !peekSession.applyError && pBody === 0 && vBody != null && vBody > 0) {
      hyp.push(
        `(b) ctx${ctxId}: desynced=false but nested body empty while Virtual has content — silent divergence`,
      );
      return { verdict: 'b_dead_nested', hypothesis: hyp };
    }
  }

  if (vCfCount > 0 && pCfCount > 0) {
    const allNodeMatch = pairs.every((p) => p.nodeIdMatch !== false);
    const nestedOk = projectedCf.every((p) => {
      if (p.nestedContextId == null) return false;
      const s = projectedNestedPeek?.sessions.find((x) => x.contextId === p.nestedContextId);
      return (s?.bodyLen ?? 0) > 0;
    });
    if (allNodeMatch && nestedOk) {
      hyp.push('Virtual and Projected CF hosts align on nodeId with nested content present');
      return { verdict: 'matched', hypothesis: hyp };
    }
  }

  hyp.push(
    `inconclusive — virtualCf=${vCfCount} projectedCf=${pCfCount} pairs=${pairs.length} (inspect probes/turnstile-widget-parity.json)`,
  );
  return { verdict: 'inconclusive', hypothesis: hyp };
}

export async function runTurnstileWidgetParity(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  projectedPayload: ProjectedWidgetHostPayload | null;
  getClientSnapshot?: (
    contextId: number,
    options?: { includeNestedPeek?: boolean },
  ) => Promise<{ generation?: number | null; tree?: unknown } | null>;
}): Promise<TurnstileWidgetParity> {
  const { chassis, session, projectedPayload, getClientSnapshot } = opts;
  const sessionExt = session as BrowserSession & {
    listVirtualChildScopeHosts?: () => Promise<ListChildScopeHostsResult>;
    loopbackKeyOfSelector?: (selector: string) => Promise<{ ok?: boolean; nodeId?: number }>;
  };

  let virtualLiveDom: TurnstileWidgetParity['virtualLiveDom'] = { ok: false, error: 'no evaluate' };
  try {
    const r = await session.evaluate(VIRTUAL_LIVE_DOM_EXPR);
    virtualLiveDom = r.ok ? parseLiveDom(r.value) : { ok: false, error: r.errorMessage ?? 'evaluate failed' };
  } catch (err) {
    virtualLiveDom = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let virtualGeneration: number | null = null;
  let scopeHosts: ListChildScopeHostsResult['hosts'] = [];
  if (sessionExt.listVirtualChildScopeHosts) {
    try {
      const listed = await sessionExt.listVirtualChildScopeHosts();
      if (listed.ok !== false) {
        virtualGeneration = typeof listed.generation === 'number' ? listed.generation : null;
        scopeHosts = listed.hosts ?? [];
      }
    } catch {
      /* probe continues */
    }
  }

  const hostByNodeId = new Map<number, (typeof scopeHosts)[number]>();
  for (const h of scopeHosts) hostByNodeId.set(h.hostNodeId, h);

  const virtualChildScopeHosts: TurnstileWidgetParity['virtualChildScopeHosts'] = [];
  for (const h of scopeHosts) {
    const nestedLive = h.contextId >= 2 ? await probeVirtualNestedLive(session, h.contextId) : null;
    virtualChildScopeHosts.push({
      ...h,
      isCf: isCfHost(h.domId, h.src),
      nestedLive,
    });
  }

  const virtualRootCfIframes: TurnstileWidgetParity['virtualRootCfIframes'] = [];
  if (virtualLiveDom.ok) {
    for (const f of virtualLiveDom.value.cfIframes) {
      let registryNodeId: number | null = null;
      if (f.id) {
        registryNodeId = await keyVirtualSelector(session, selectorForDomId(f.id));
      }
      const bound = registryNodeId != null ? hostByNodeId.get(registryNodeId) : undefined;
      virtualRootCfIframes.push({
        domId: f.id,
        src: f.src,
        w: f.w,
        h: f.h,
        registryNodeId,
        nestedContextId: bound?.contextId ?? null,
      });
    }
  }

  const projectedNestedPeek = projectedPayload?.nestedPeek ?? null;
  const projectedHosts: WidgetHostRecord[] = (projectedPayload?.hosts ?? []).map((h) => ({
    ...h,
    side: 'projected' as const,
  }));
  const projectedCf = projectedHosts.filter((h) => isCfHost(h.domId, h.src));

  let projectedGeneration: number | null = projectedPayload?.rootGeneration ?? null;
  if (projectedGeneration == null && getClientSnapshot) {
    const rootSnap = await getClientSnapshot(1);
    projectedGeneration = rootSnap?.generation ?? null;
  }

  const pairs: TurnstileWidgetParity['pairs'] = [];
  const projectedByKey = new Map(projectedCf.map((h) => [hostMatchKey(h.domId, h.src), h]));
  for (const v of virtualRootCfIframes) {
    const key = hostMatchKey(v.domId, v.src);
    const p = projectedByKey.get(key);
    pairs.push({
      matchKey: key,
      virtualNodeId: v.registryNodeId,
      projectedNodeId: p?.registryNodeId ?? null,
      virtualContextId: v.nestedContextId,
      projectedContextId: p?.nestedContextId ?? null,
      nodeIdMatch:
        v.registryNodeId != null && p?.registryNodeId != null
          ? v.registryNodeId === p.registryNodeId
          : null,
    });
  }
  for (const p of projectedCf) {
    const key = hostMatchKey(p.domId, p.src);
    if (pairs.some((x) => x.matchKey === key)) continue;
    pairs.push({
      matchKey: key,
      virtualNodeId: null,
      projectedNodeId: p.registryNodeId,
      virtualContextId: null,
      projectedContextId: p.nestedContextId,
      nodeIdMatch: null,
    });
  }

  const { verdict, hypothesis } = buildHypothesisAndVerdict({
    virtualRootCf: virtualRootCfIframes,
    virtualChildCf: virtualChildScopeHosts,
    projectedCf,
    projectedNestedPeek,
    pairs,
  });

  return {
    capturedAt: new Date().toISOString(),
    virtualGeneration,
    projectedGeneration,
    virtualLiveDom,
    virtualChildScopeHosts,
    virtualRootCfIframes,
    projectedHosts,
    projectedNestedPeek,
    pairs,
    verdict,
    hypothesis,
  };
}
