/**
 * Execute blueprint actions against LabChassis.
 */

import type { LabChassis } from '../host/chassis';
import type { LabAction, LabBlueprint } from './types';
import { runBlueprintSchedule } from './schedule';
import type { LabVerdict } from '../dossier/types';
import { writeJson, writeBinaryArtifact } from '../dossier/write';
import { runIsomorphism, captureVirtualLabSnap } from '../probes/isomorphism';
import { summarizeProfile, type CpuProfile } from '../probes/cpuProfile';
import { foldSoak } from '../blueprints/fold/soak';
import { foldCssomFoundation } from '../blueprints/fold/cssomFoundation';
import { foldCssomHeavy } from '../blueprints/fold/cssomHeavy';
import { foldCssomDouble } from '../blueprints/fold/cssomDouble';
import { foldApplyAttrs } from '../blueprints/fold/applyAttrs';
import { foldSvgNs } from '../blueprints/fold/svgNs';
import { foldFormsState } from '../blueprints/fold/formsState';
import { foldShadowOpen, foldShadowClosed, foldShadowManual } from '../blueprints/fold/shadowOpen';
import { foldIframeOpen } from '../blueprints/fold/iframeOpen';
import { foldApplyHonestyDesync } from '../blueprints/fold/applyHonestyDesync';
import { foldCspNavLocale } from '../blueprints/fold/cspNavLocale';
import { foldTurnstile } from '../blueprints/fold/turnstile';
import { foldCssomMatrixNested } from '../blueprints/fold/cssomMatrixNested';
import { foldDocumentChurn } from '../blueprints/fold/documentChurn';
import { runTurnstileDiagnostic } from '../probes/turnstileDiagnostic';
import { runNestedApplyFailureDiagnostic } from '../probes/nestedApplyFailureDiagnostic';
import { runCssomMatrixDiagnostic } from '../probes/cssomMatrixDiagnostic';
import { runPaintDiffProbe } from '../probes/paintDiffProbe';
import { runLaunchTelemetryProbe } from '../probes/launchTelemetryProbe';
import {
  CSSOM_SHEET_DUMP_EXPR,
  parseCssomSheetDump,
  compareSheetDumps,
} from '../probes/cssomSheetDump';
import { evaluateVirtualProbe } from '../probes/evaluateVirtualProbe';
import type { HostileKind } from './hostileFrames';
import {
  encodeAttrDesyncFrame,
  encodeRulesetDesyncFrame,
  encodeEofSetupFrame,
  encodeEofCheckFrame,
} from './hostileFrames';
import type { ClientStateSnapshot } from '../probes/isomorphism';

export type InjectAck = {
  sequence: number | null;
  generation: number | null;
  desynced: boolean;
  applyError: string | null;
  tableHash: string | null;
};

export type ExecuteHooks = {
  chassis: LabChassis;
  resolveUrl: (url: string) => string;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
  requestClientSnapshot?: (
    contextId: number,
    options?: {
      includeNestedPeek?: boolean;
      registryProbeNodeIds?: number[];
      rectLadderProbe?: { nestedContextId: number; widgetNodeId?: number };
      paintProbe?: {
        nestedContextId: number;
        widgetNodeId?: number;
      };
      cssomSheetDump?: { nestedContextId?: number };
    },
  ) => Promise<import('../probes/isomorphism').ClientStateSnapshot | null>;
  requestTamper?: () => Promise<{ ok: boolean; reason?: string } | null>;
  injectClientFrame?: (bytes: Uint8Array) => Promise<InjectAck | null>;
  captureProjectedViewportClip?: (clip: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<{ ok: boolean; base64?: string; reason?: string; byteLength?: number }>;
  onProgress?: (p: {
    actionId: string;
    queue: string;
    status: 'started' | 'succeeded' | 'failed' | 'skipped';
    detail?: string;
  }) => void;
  overrides?: {
    url?: string;
    durationMs?: number;
    frameRateHz?: number;
    telemetry?: Record<string, unknown>;
    cpu?: boolean;
    iso?: boolean;
    invariants?: boolean;
    headed?: boolean;
    outDir?: string;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const INJECT_POLL_MS = 10;
const INJECT_READY_MS = 2_000;
const INJECT_APPLY_MS = 2_000;

function tableHashFromSnap(snap: ClientStateSnapshot | null): bigint | null {
  const raw = snap?.table?.tableHash;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function pollClientSnapshot(
  get: () => Promise<ClientStateSnapshot | null>,
  pred: (snap: ClientStateSnapshot) => boolean,
  timeoutMs: number,
): Promise<ClientStateSnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  let last: ClientStateSnapshot | null = null;
  while (Date.now() < deadline) {
    const snap = await get();
    if (snap !== null) {
      last = snap;
      if (pred(snap)) return snap;
    }
    await sleep(INJECT_POLL_MS);
  }
  return last;
}

function injectDetail(args: {
  beforeSeq: number;
  after: { sequence?: number | null; desynced?: boolean; applyError?: string | null } | null;
  stillSynced: string;
}): { desynced: boolean; afterSeq: number; applyError: string | null; detail: string } {
  const afterSeq = args.after?.sequence ?? args.beforeSeq;
  const desynced = args.after?.desynced === true;
  if (desynced) {
    return {
      desynced: true,
      afterSeq,
      applyError: args.after?.applyError ?? null,
      detail: `desynced ${args.after?.applyError ?? ''}`,
    };
  }
  if (afterSeq <= args.beforeSeq) {
    return {
      desynced: false,
      afterSeq,
      applyError: 'inject not ingested',
      detail: 'inject not ingested',
    };
  }
  return {
    desynced: false,
    afterSeq,
    applyError: args.after?.applyError ?? null,
    detail: args.stillSynced,
  };
}

function ackToSnap(ack: InjectAck | null): ClientStateSnapshot | null {
  if (ack === null) return null;
  return {
    tree: null,
    table: ack.tableHash ? { rowCount: 0, tableHash: ack.tableHash } : null,
    sequence: ack.sequence,
    generation: ack.generation,
    desynced: ack.desynced,
    applyError: ack.applyError,
  };
}

async function deliverHostileFrame(
  chassis: LabChassis,
  hooks: ExecuteHooks,
  bytes: Uint8Array,
): Promise<InjectAck | null> {
  if (hooks.injectClientFrame) {
    chassis.noteClientOnlyFrame(bytes);
    return hooks.injectClientFrame(bytes);
  }
  chassis.relayClientOnlyFrame(bytes);
  return null;
}

/** lastSequence advances before apply — seq bump alone is not a desync observation. */
async function waitDesyncOrTimeout(
  getClientSnapshot: () => Promise<ClientStateSnapshot | null>,
  timeoutMs: number,
): Promise<ClientStateSnapshot | null> {
  return pollClientSnapshot(getClientSnapshot, (s) => s.desynced === true, timeoutMs);
}

function parseHostileKind(raw: unknown, fallback: string): HostileKind | null {
  const v = String(raw ?? fallback);
  if (v === 'attr' || v === 'ruleset' || v === 'eof') return v;
  if (v.endsWith('-attr')) return 'attr';
  if (v.endsWith('-ruleset')) return 'ruleset';
  if (v.endsWith('-eof')) return 'eof';
  return null;
}

function applyConditionalActions(bp: LabBlueprint, overrides: ExecuteHooks['overrides']): LabBlueprint {
  const o = overrides ?? {};
  const keep = (a: LabAction): boolean => {
    if (a.type === 'cpu.start' || a.type === 'cpu.stop') {
      if (o.cpu === false) return false;
      if (o.cpu !== true && a.params?.optional === true) return false;
    }
    if (a.type === 'iso') {
      if (o.iso === false) return false;
      if (o.iso !== true && a.params?.optional === true) return false;
    }
    return true;
  };
  const keptIds = new Set<string>();
  for (const q of bp.queues) for (const a of q.actions) if (keep(a)) keptIds.add(a.id);

  const rewrite = (ids: string[] | undefined): string[] | undefined => {
    if (!ids) return ids;
    const next = ids.filter((id) => keptIds.has(id));
    return next;
  };

  const queues = bp.queues
    .map((q) => ({
      ...q,
      actions: q.actions.filter(keep).map((a) => ({
        ...a,
        dependsOn: rewrite(a.dependsOn),
        awaits: rewrite(a.awaits),
      })),
    }))
    .filter((q) => q.actions.length > 0);
  return { ...bp, queues };
}

export async function executeBlueprint(
  bp: LabBlueprint,
  hooks: ExecuteHooks,
): Promise<{ verdicts: LabVerdict[]; dossierDir: string | null; ok: boolean }> {
  const overrides = hooks.overrides ?? {};
  const resolved = applyConditionalActions(bp, overrides);
  const startedAt = Date.now();
  let verdicts: LabVerdict[] = [];

  const runAction = async (action: LabAction, queue: string): Promise<{ ok: boolean; detail?: string }> => {
    const chassis = hooks.chassis;
    const params = action.params ?? {};
    const t0 = new Date().toISOString();

    const finish = (ok: boolean, detail?: string) => {
      chassis.journal.timeline.push({
        actionId: action.id,
        queue,
        startedAt: t0,
        endedAt: new Date().toISOString(),
        status: ok ? 'succeeded' : 'failed',
        detail,
      });
      return { ok, detail };
    };

    const actionType =
      action.type === ('pushDomInput' as string) ? 'pushInput' : action.type;

    switch (actionType) {
      case 'boot': {
        const urlRaw =
          (typeof overrides.url === 'string' && overrides.url) ||
          (typeof params.url === 'string' ? params.url : null);
        if (!urlRaw) return finish(false, 'boot.url required');
        const url = hooks.resolveUrl(urlRaw);
        await chassis.boot({
          mode: 'run',
          url,
          frameRateHz: overrides.frameRateHz ?? (typeof params.frameRateHz === 'number' ? params.frameRateHz : 60),
          telemetry: overrides.telemetry ?? bp.defaultTelemetry,
          cpuProfiling: overrides.cpu === true || params.cpuProfiling === true,
          blueprintId: bp.id,
          slug: bp.id,
        });
        return finish(true);
      }
      case 'navigate': {
        const urlRaw = typeof params.url === 'string' ? params.url : overrides.url;
        if (!urlRaw) return finish(false, 'navigate.url required');
        await chassis.navigate(hooks.resolveUrl(urlRaw));
        return finish(true);
      }
      case 'sleep': {
        let ms = typeof params.ms === 'number' ? params.ms : 0;
        if (overrides.durationMs !== undefined && params.useOverrideDuration === true) {
          ms = overrides.durationMs;
        }
        await sleep(ms);
        return finish(true, `slept ${ms}ms`);
      }
      case 'act': {
        const name = String(params.name ?? '');
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const r = await session.evaluate(`window.__cssomLab.act(${JSON.stringify(name)})`);
        chassis.journal.acts.push({
          name,
          ok: r.ok,
          error: r.ok ? undefined : (r.errorMessage ?? 'evaluate failed'),
        });
        return finish(r.ok, r.ok ? name : r.errorMessage);
      }
      case 'evaluate': {
        const expression = String(params.expression ?? '');
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const useVirtual = params.virtual === true;
        if (useVirtual) {
          const raw = await evaluateVirtualProbe(
            session as {
              evaluate?: (code: string) => Promise<{ ok: boolean; value?: unknown }>;
              evaluateVirtualExpression?: (code: string, contextId?: number) => Promise<unknown>;
            },
            expression,
            typeof params.contextId === 'number' ? params.contextId : 1,
          );
          const ok = raw !== null;
          chassis.journal.acts.push({
            name: action.id,
            ok,
            error: ok ? undefined : 'virtual evaluate failed',
          });
          return finish(ok, ok ? (raw === undefined ? 'ok' : String(raw)) : 'virtual evaluate failed');
        }
        const r = await session.evaluate(expression);
        chassis.journal.acts.push({
          name: action.id,
          ok: r.ok,
          error: r.ok ? undefined : (r.errorMessage ?? 'evaluate failed'),
        });
        return finish(r.ok, r.errorMessage);
      }
      case 'pushInput': {
        const session = chassis.browser;
        const pushFn = (session as unknown as { pushInput?: (i: unknown) => Promise<{ status: string; reason?: string }> }).pushInput?.bind(session);
        if (!session || !pushFn) return finish(false, 'pushInput missing');
        const push = pushFn as (i: unknown) => Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }>;
        const sequence = params.sequence;
        if (Array.isArray(sequence)) {
          for (const step of sequence) {
            if (!step || typeof step !== 'object') return finish(false, 'invalid pushDomInput step');
            const st = step as Record<string, unknown>;
            if (st.type === 'resolveAndClick') {
              const selector = String(st.selector ?? '');
              const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
              const v4 = session as {
                resolveAndClickDomInputByNodeId?: (s: string, c: number) => Promise<{ status: string; reason?: string }>;
                resolveAndClickDomInput?: (s: string, c: number) => Promise<{ status: string; reason?: string }>;
              };
              if (typeof v4.resolveAndClickDomInputByNodeId === 'function') {
                const out = await v4.resolveAndClickDomInputByNodeId(selector, contextId);
                if (out.status === 'dropped') return finish(false, out.reason ?? 'click failed');
                chassis.journal.acts.push({ name: `click:${selector}`, ok: true });
                continue;
              }
              if (typeof v4.resolveAndClickDomInput === 'function') {
                const out = await v4.resolveAndClickDomInput(selector, contextId);
                if (out.status === 'dropped') return finish(false, out.reason ?? 'click failed');
                chassis.journal.acts.push({ name: `click:${selector}`, ok: true });
                continue;
              }
              const r = await session.evaluate(
                `(() => {
                  const p = globalThis.__speculumProjection;
                  if (!p || p.contextId !== ${contextId}) return { ok: false, reason: 'producer' };
                  const el = document.querySelector(${JSON.stringify(selector)});
                  if (!el) return { ok: false, reason: 'missing_element' };
                  const id = p.domNodes.keyOf(el);
                  if (!id || id <= 0) return { ok: false, reason: 'no_node_id' };
                  const rect = el.getBoundingClientRect();
                  return {
                    ok: true,
                    id,
                    generation: p.domNodes.generation,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                  };
                })()`,
              );
              if (!r.ok) return finish(false, r.errorMessage ?? 'resolveAndClick evaluate failed');
              let info: { id: number; generation: number; x: number; y: number };
              try {
                info = JSON.parse(r.value ?? '{}') as typeof info;
              } catch {
                return finish(false, 'resolveAndClick parse failed');
              }
              if (!info.id) return finish(false, 'resolveAndClick no id');
              let vw = 1280;
              let vh = 720;
              try {
                const st = await session.getStatus();
                if (st.width > 0) vw = st.width;
                if (st.height > 0) vh = st.height;
              } catch {
                /* */
              }
              for (const type of ['move', 'down', 'up'] as const) {
                const out = await push({
                  type,
                  schemaVersion: 1,
                  generation: info.generation,
                  targetId: info.id,
                  contextId,
                  timestampClient: Date.now(),
                  viewportW: vw,
                  viewportH: vh,
                  x: info.x,
                  y: info.y,
                  nodeId: info.id,
                  payloadJson: JSON.stringify({ x: info.x, y: info.y, button: 'left' }),
                });
                if (out.status === 'dropped') return finish(false, `${type}: ${out.reason}`);
              }
              chassis.journal.acts.push({ name: `click:${selector}`, ok: true });
              continue;
            }
            if (st.type === 'resolveAndType') {
              const selector = String(st.selector ?? '');
              const value = String(st.value ?? '');
              const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
              const v4 = session as {
                resolveAndTypeDomInput?: (s: string, v: string, c: number) => Promise<{ status: string; reason?: string }>;
              };
              if (typeof v4.resolveAndTypeDomInput !== 'function') return finish(false, 'resolveAndType missing');
              const out = await v4.resolveAndTypeDomInput(selector, value, contextId);
              if (out.status === 'dropped') return finish(false, out.reason ?? 'type failed');
              chassis.journal.acts.push({ name: `type:${selector}`, ok: true });
              continue;
            }
            if (st.type === 'resolveAndScrollElement') {
              const selector = String(st.selector ?? '');
              const scrollTop = typeof st.scrollTop === 'number' ? st.scrollTop : 0;
              const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
              const v4 = session as {
                resolveAndScrollElementDomInput?: (s: string, t: number, c: number) => Promise<{ status: string; reason?: string }>;
              };
              if (typeof v4.resolveAndScrollElementDomInput !== 'function') {
                return finish(false, 'resolveAndScrollElement missing');
              }
              const out = await v4.resolveAndScrollElementDomInput(selector, scrollTop, contextId);
              if (out.status === 'dropped') {
                return finish(false, `${selector}@${contextId}: ${out.reason ?? 'scroll failed'}`);
              }
              chassis.journal.acts.push({ name: `scroll:${selector}`, ok: true });
              continue;
            }
            if (st.type === 'resolveAndScrollViewport') {
              const scrollY = typeof st.scrollY === 'number' ? st.scrollY : 0;
              const scrollX = typeof st.scrollX === 'number' ? st.scrollX : 0;
              const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
              const v4 = session as {
                resolveAndScrollViewportDomInput?: (y: number, x: number, c: number) => Promise<{ status: string; reason?: string }>;
              };
              if (typeof v4.resolveAndScrollViewportDomInput !== 'function') {
                return finish(false, 'resolveAndScrollViewport missing');
              }
              const out = await v4.resolveAndScrollViewportDomInput(scrollY, scrollX, contextId);
              if (out.status === 'dropped') return finish(false, out.reason ?? 'viewport scroll failed');
              chassis.journal.acts.push({ name: `scrollViewport:${scrollY}`, ok: true });
              continue;
            }
            const out = await push(st);
            if (out.status === 'dropped') return finish(false, out.reason);
          }
          return finish(true);
        }
        const out = await push(params);
        return finish(out.status === 'dispatched', out.status === 'dropped' ? out.reason : undefined);
      }
      case 'snap': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const mode = (params.cssom as 'none' | 'committed' | 'scan') ?? 'scan';
        const id = String(params.id ?? action.id);
        try {
          await session.haltClocks?.();
          const view = await captureVirtualLabSnap(session as never, 1, {
            table: 'full',
            tree: params.includeTree === true,
            cssom: mode,
            formProps: true,
            frameNewNodes: true,
            liveChildOrder: true,
          });
          const result = {
            ok: view.ok,
            reason: view.reason,
            generation: view.generation,
            sequence: view.sequence,
            o2: view.o2,
            cssomO2: view.cssomO2,
            table: view.table,
            tree: view.tree,
            formProps: view.formProps,
            nodeNewConnected: view.nodeNewConnected,
            cascade: view.cascade,
          };
          chassis.journal.snaps.push({ id, mode, result });
          if (chassis.dossierHandle) {
            await writeJson(chassis.dossierHandle, `probes/snaps/${id}.json`, result, 'probes.snap');
          }
          return finish(result.ok !== false, result.ok === false ? String(result.reason) : id);
        } finally {
          await session.resumeClocks?.();
        }
      }
      case 'opWindow.start': {
        chassis.startOpWindow(String(params.windowId ?? action.id));
        return finish(true);
      }
      case 'opWindow.stop': {
        const counts = chassis.stopOpWindow(String(params.windowId ?? action.id));
        return finish(true, JSON.stringify(counts));
      }
      case 'requestResync': {
        await chassis.browser?.requestResync?.({
          reason: String(params.reason ?? bp.id),
          contextId: typeof params.contextId === 'number' && params.contextId > 0 ? params.contextId : 1,
        });
        return finish(true);
      }
      case 'cpu.start': {
        const start = await chassis.browser?.startCpuProfile?.();
        if (!start?.ok) return finish(false, start?.reason ?? 'startCpuProfile failed');
        return finish(true);
      }
      case 'cpu.stop': {
        const stop = await chassis.browser?.stopCpuProfile?.();
        if (!stop?.ok || !stop.profileBytes) return finish(false, stop?.reason ?? 'stopCpuProfile failed');
        const raw = JSON.parse(new TextDecoder().decode(stop.profileBytes)) as CpuProfile;
        const summary = summarizeProfile(raw, 20);
        if (chassis.dossierHandle) {
          await writeJson(chassis.dossierHandle, 'probes/cpu/summary.json', summary, 'probes.cpu.summary');
          await writeBinaryArtifact(
            chassis.dossierHandle,
            'probes/cpu/profile.cpuprofile',
            JSON.stringify(raw),
            'probes.cpu.profile',
            'application/json',
          );
        }
        (chassis.journal as { cpuSummary?: unknown }).cpuSummary = summary;
        return finish(true, `samples=${summary.totalSamples}`);
      }
      case 'iso': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const iso = await runIsomorphism({
          session,
          contextIds: chassis.contextIndex.list(),
          getClientSnapshot: hooks.requestClientSnapshot
            ? (contextId) => hooks.requestClientSnapshot!(contextId)
            : undefined,
        });
        chassis.journal.iso = iso;
        if (iso.nested && iso.nested.virtualDocs + iso.nested.clientDocs > 0) {
          const prev = chassis.journal.nestedEvidence ?? {
            virtualDocs: 0,
            clientDocs: 0,
            clientFrameHrefs: [] as string[],
            treeIdenticalWhileNested: false,
            treeDivergencesWhileNested: 0,
          };
          const hrefs = [...prev.clientFrameHrefs];
          for (const h of iso.nested.clientFrameHrefs) {
            if (!hrefs.includes(h)) hrefs.push(h);
          }
          let treeIdenticalWhileNested = prev.treeIdenticalWhileNested;
          let treeDivergencesWhileNested = prev.treeDivergencesWhileNested;
          if (iso.nested.virtualDocs > 0 && iso.structuralDiff) {
            if (iso.structuralDiff.identical) treeIdenticalWhileNested = true;
            else {
              treeDivergencesWhileNested = iso.structuralDiff.divergenceCount;
            }
          }
          chassis.journal.nestedEvidence = {
            virtualDocs: Math.max(prev.virtualDocs, iso.nested.virtualDocs),
            clientDocs: Math.max(prev.clientDocs, iso.nested.clientDocs),
            clientFrameHrefs: hrefs,
            treeIdenticalWhileNested,
            treeDivergencesWhileNested,
          };
        }
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/iso.json',
            {
              sequence: iso.sequence,
              generation: iso.generation,
              o2Identical: iso.o2?.identical ?? null,
              cssomIdentical: iso.cssomO2?.identical ?? null,
              tableIdentical: iso.table.identical,
              o2DivergenceCount: iso.o2?.divergenceCount ?? null,
              cssomDivergenceCount: iso.cssomO2?.divergenceCount ?? null,
              skipped: iso.skipped,
              nodeNewConnected: iso.nodeNewConnected,
              cascade: iso.cascade,
              formProps: iso.formProps,
            },
            'probes.iso',
          );
        }
        return finish(true);
      }
      case 'probe.turnstile': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const diagnostic = await runTurnstileDiagnostic({
          chassis,
          session,
          getClientSnapshot: hooks.requestClientSnapshot
            ? (contextId, options) => hooks.requestClientSnapshot!(contextId, options)
            : undefined,
        });
        (chassis.journal as { turnstileDiagnostic?: unknown }).turnstileDiagnostic = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/turnstile-diagnostic.json',
            diagnostic,
            'probes.turnstile',
          );
        }
        chassis.journal.acts.push({ name: 'probe.turnstile', ok: true });
        return finish(true, `contexts=${diagnostic.contextIds.join(',')}`);
      }
      case 'probe.nestedApplyFailure': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const diagnostic = await runNestedApplyFailureDiagnostic({
          chassis,
          session,
          frameCapture: chassis.frameCapture,
          getClientSnapshot: hooks.requestClientSnapshot
            ? (contextId, options) => hooks.requestClientSnapshot!(contextId, options)
            : undefined,
        });
        (chassis.journal as { nestedApplyFailure?: unknown }).nestedApplyFailure = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/nested-apply-failure.json',
            diagnostic,
            'probes.nestedApplyFailure',
          );
          await writeJson(
            chassis.dossierHandle,
            'wire/frame-capture.json',
            chassis.frameCapture.toJSON(),
            'wire.frameCapture',
          );
        }
        chassis.journal.acts.push({ name: 'probe.nestedApplyFailure', ok: true });
        const hint = diagnostic.hypothesis[0] ?? `insertFailures=${diagnostic.insertFailures.length}`;
        return finish(true, hint);
      }
      case 'probe.turnstileRectLadder': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const { runTurnstileRectLadder } = await import('../probes/turnstileRectLadder');
        const diagnostic = await runTurnstileRectLadder({
          chassis,
          session,
          getClientRectLadder: hooks.requestClientSnapshot
            ? async (nestedContextId, widgetNodeId) => {
                const snap = await hooks.requestClientSnapshot!(1, {
                  rectLadderProbe: { nestedContextId, widgetNodeId },
                });
                return snap?.rectLadder ?? null;
              }
            : undefined,
        });
        (chassis.journal as { turnstileRectLadder?: unknown }).turnstileRectLadder = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/turnstile-rect-ladder.json',
            diagnostic,
            'probes.turnstileRectLadder',
          );
        }
        chassis.journal.acts.push({ name: 'probe.turnstileRectLadder', ok: true });
        return finish(true, diagnostic.hypothesis[0] ?? 'rect ladder captured');
      }
      case 'probe.turnstilePaint': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const { runTurnstilePaintDiagnostic } = await import('../probes/turnstilePaintDiagnostic');
        const diagnostic = await runTurnstilePaintDiagnostic({
          chassis,
          session,
          dossier: chassis.dossierHandle,
          captureProjectedViewportClip: hooks.captureProjectedViewportClip,
          getClientPaintProbe: hooks.requestClientSnapshot
            ? async ({ nestedContextId, widgetNodeId }) => {
                const snap = await hooks.requestClientSnapshot!(1, {
                  paintProbe: { nestedContextId, widgetNodeId },
                });
                if (!snap?.paintProbe) return null;
                const { widgetPaint, widgetPaintOk, widgetPaintReason } = snap.paintProbe;
                return { widgetPaint, widgetPaintOk, widgetPaintReason };
              }
            : undefined,
        });
        (chassis.journal as { turnstilePaint?: unknown }).turnstilePaint = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/turnstile-paint.json',
            diagnostic,
            'probes.turnstilePaint',
          );
        }
        chassis.journal.acts.push({ name: 'probe.turnstilePaint', ok: true });
        return finish(true, diagnostic.hypothesis[0] ?? 'paint probe captured');
      }
      case 'probe.cssomSheetDump': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const nestedContextId =
          typeof params.nestedContextId === 'number' && params.nestedContextId > 0
            ? params.nestedContextId
            : 1;
        let virtualDump = parseCssomSheetDump(null);
        const raw = await evaluateVirtualProbe(session, CSSOM_SHEET_DUMP_EXPR, nestedContextId);
        virtualDump = parseCssomSheetDump(raw);
        let projectedDump = parseCssomSheetDump(null);
        if (hooks.requestClientSnapshot) {
          const snap = await hooks.requestClientSnapshot!(nestedContextId >= 2 ? nestedContextId : 1, {
            cssomSheetDump: { nestedContextId },
          });
          if (snap?.cssomSheetDump) projectedDump = snap.cssomSheetDump;
        }
        const compare = compareSheetDumps(virtualDump, projectedDump);
        const payload = { nestedContextId, virtual: virtualDump, projected: projectedDump, compare };
        (chassis.journal as { cssomSheetDump?: unknown }).cssomSheetDump = payload;
        if (chassis.dossierHandle) {
          await writeJson(chassis.dossierHandle, 'probes/cssom-sheet-dump.json', payload, 'probes.cssomSheetDump');
          const basename =
            typeof params.artifactBasename === 'string' && params.artifactBasename.trim()
              ? params.artifactBasename.trim()
              : null;
          if (basename) {
            await writeJson(
              chassis.dossierHandle,
              `probes/${basename}-virtual.json`,
              virtualDump,
              'probes.cssomSheetDump.virtual',
            );
            await writeJson(
              chassis.dossierHandle,
              `probes/${basename}-projected.json`,
              projectedDump,
              'probes.cssomSheetDump.projected',
            );
          }
        }
        chassis.journal.acts.push({ name: 'probe.cssomSheetDump', ok: true });
        return finish(true, compare.identical ? 'identical' : compare.notes[0] ?? 'diverged');
      }
      case 'probe.paintDiff': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const clip = params.clip as { x: number; y: number; width: number; height: number } | undefined;
        if (!clip || typeof clip.width !== 'number') return finish(false, 'clip required');
        const diagnostic = await runPaintDiffProbe({
          chassis,
          session,
          dossier: chassis.dossierHandle,
          clip,
          contextId: typeof params.contextId === 'number' ? params.contextId : 1,
          artifactPrefix: typeof params.artifactPrefix === 'string' ? params.artifactPrefix : 'paint-diff',
          projectedCdpUrl: hooks.projectedCdpUrl,
          labOrigin: hooks.labOrigin,
        });
        const journalKey = typeof params.journalKey === 'string' ? params.journalKey : 'paintDiff';
        (chassis.journal as Record<string, unknown>)[journalKey] = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            `probes/${journalKey}.json`,
            diagnostic,
            'probes.paintDiff',
          );
        }
        chassis.journal.acts.push({ name: 'probe.paintDiff', ok: true });
        return finish(true, diagnostic.hypothesis[0] ?? 'paint diff captured');
      }
      case 'probe.cssomMatrix': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const nestedContextId =
          typeof params.nestedContextId === 'number' && params.nestedContextId > 0
            ? params.nestedContextId
            : 2;
        const diagnostic = await runCssomMatrixDiagnostic({
          chassis,
          session,
          dossier: chassis.dossierHandle,
          nestedContextId,
          projectedCdpUrl: hooks.projectedCdpUrl,
          labOrigin: hooks.labOrigin,
          getClientSheetDump: hooks.requestClientSnapshot
            ? async () => {
                const snap = await hooks.requestClientSnapshot!(nestedContextId, {
                  cssomSheetDump: { nestedContextId },
                });
                return snap?.cssomSheetDump ?? null;
              }
            : undefined,
        });
        (chassis.journal as { cssomMatrix?: unknown }).cssomMatrix = diagnostic;
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/cssom-matrix.json',
            diagnostic,
            'probes.cssomMatrix',
          );
        }
        chassis.journal.acts.push({ name: 'probe.cssomMatrix', ok: true });
        return finish(true, diagnostic.hypothesis[0] ?? 'cssom matrix captured');
      }
      case 'probe.launchTelemetry': {
        const session = chassis.browser;
        if (!session) return finish(false, 'no session');
        const diagnostic = await runLaunchTelemetryProbe({ chassis, session });
        (chassis.journal as { launchTelemetry?: unknown }).launchTelemetry = diagnostic;
        (chassis.journal as { established?: boolean }).established = diagnostic.established;
        (chassis.journal as { installTelemetry?: unknown }).installTelemetry =
          diagnostic.installTelemetry ?? undefined;
        (chassis.journal as { bootOutcome?: unknown }).bootOutcome = diagnostic.bootOutcome ?? undefined;
        if (bp.id === 'document-churn') {
          (chassis.journal as { expectedMinInstalls?: number }).expectedMinInstalls = 4;
        }
        if (chassis.dossierHandle) {
          await writeJson(
            chassis.dossierHandle,
            'probes/launch-telemetry.json',
            diagnostic,
            'probes.launchTelemetry',
          );
        }
        chassis.journal.acts.push({ name: 'probe.launchTelemetry', ok: true });
        return finish(
          diagnostic.established,
          diagnostic.established ? 'established' : diagnostic.bootOutcome?.reason ?? 'not established',
        );
      }
      case 'collect.enable':
        return finish(true, 'collectors always on chassis');
      case 'injectFrame': {
        const kind = parseHostileKind(params.kind, bp.id);
        if (!kind) return finish(false, `unknown inject kind ${String(params.kind ?? bp.id)}`);
        const record = (row: (typeof chassis.journal.injects)[number], detail: string, ok = true) => {
          chassis.journal.injects.push(row);
          return finish(ok, detail);
        };
        if (!chassis.hasClientRelay || !hooks.requestClientSnapshot) {
          return record(
            { kind, skipped: true, skipReason: 'no DOM client' },
            'skipped: no DOM client',
          );
        }
        const getClientSnapshot = () => hooks.requestClientSnapshot!(1);
        chassis.suppressVirtualRelay = true;
        try {
          const live = await pollClientSnapshot(
            getClientSnapshot,
            (s) => s.armed === true && s.resyncInFlight !== true && s.sequence != null,
            INJECT_READY_MS,
          );
          if (live == null || live.sequence == null) {
            return record(
              { kind, skipped: true, skipReason: 'client snapshot missing' },
              'skipped: client snapshot missing',
            );
          }
          if (live.armed !== true) {
            return record(
              { kind, skipped: true, skipReason: 'client not armed' },
              'skipped: client not armed',
            );
          }
          if (live.resyncInFlight === true) {
            return record(
              { kind, skipped: true, skipReason: 'resync in flight' },
              'skipped: resync in flight',
            );
          }
          const beforeSeq = live.sequence;
          const generation = live.generation ?? chassis.stats.lastGeneration ?? 1;
          const hash0 = tableHashFromSnap(live);
          if (hash0 === null) {
            return record(
              { kind, skipped: true, skipReason: 'client tableHash missing' },
              'skipped: client tableHash missing',
            );
          }

          const observeDesync = async (ack: InjectAck | null) => {
            if (ack?.desynced === true) return ackToSnap(ack);
            const polled = await waitDesyncOrTimeout(getClientSnapshot, INJECT_APPLY_MS);
            if (polled?.desynced === true) return polled;
            return ackToSnap(ack) ?? polled;
          };

          if (kind === 'attr' || kind === 'ruleset') {
            const seq = beforeSeq + 1;
            const bytes =
              kind === 'attr'
                ? encodeAttrDesyncFrame(generation, seq, hash0)
                : encodeRulesetDesyncFrame(generation, seq, hash0);
            const ack = await deliverHostileFrame(chassis, hooks, bytes);
            const after = (await observeDesync(ack)) ?? ackToSnap(ack);
            const got = injectDetail({
              beforeSeq,
              after,
              stillSynced: 'client still synced after inject',
            });
            return record(
              {
                kind,
                sequence: got.afterSeq,
                beforeSeq,
                afterSeq: got.afterSeq,
                desynced: got.desynced,
                applyError: got.applyError,
              },
              got.detail,
            );
          }

          const setupSeq = beforeSeq + 1;
          const setupAck = await deliverHostileFrame(
            chassis,
            hooks,
            encodeEofSetupFrame(generation, setupSeq, hash0),
          );
          const afterSetup =
            setupAck !== null
              ? ackToSnap(setupAck)
              : await pollClientSnapshot(
                  getClientSnapshot,
                  (s) =>
                    s.desynced === true ||
                    (s.sequence != null &&
                      s.sequence >= setupSeq &&
                      tableHashFromSnap(s) !== null &&
                      tableHashFromSnap(s) !== hash0),
                  INJECT_APPLY_MS,
                );
          if (afterSetup?.desynced) {
            return record(
              {
                kind,
                sequence: afterSetup.sequence ?? setupSeq,
                beforeSeq,
                afterSeq: afterSetup.sequence ?? setupSeq,
                desynced: true,
                applyError: afterSetup.applyError ?? 'eof setup desynced',
              },
              'eof setup frame desynced (want success then ghost)',
            );
          }
          if ((afterSetup?.sequence ?? beforeSeq) <= beforeSeq) {
            return record(
              {
                kind,
                sequence: afterSetup?.sequence ?? beforeSeq,
                beforeSeq,
                afterSeq: afterSetup?.sequence ?? beforeSeq,
                desynced: false,
                applyError: 'inject not ingested',
              },
              'inject not ingested',
            );
          }
          const hash1 = tableHashFromSnap(afterSetup) ?? hash0;
          const setupOkSeq = afterSetup?.sequence ?? setupSeq;
          const tamper = hooks.requestTamper ? await hooks.requestTamper() : null;
          if (tamper == null || tamper.ok !== true) {
            const reason = tamper?.reason ?? 'tamper missed constructed sheet';
            return record(
              {
                kind,
                sequence: setupOkSeq,
                beforeSeq,
                afterSeq: setupOkSeq,
                desynced: false,
                applyError: reason,
              },
              reason,
            );
          }
          const checkAck = await deliverHostileFrame(
            chassis,
            hooks,
            encodeEofCheckFrame(generation, setupOkSeq + 1, hash1),
          );
          const after = (await observeDesync(checkAck)) ?? ackToSnap(checkAck);
          const got = injectDetail({
            beforeSeq: setupOkSeq,
            after,
            stillSynced: 'client still synced after eof CHECK',
          });
          return record(
            {
              kind,
              sequence: got.afterSeq,
              beforeSeq,
              afterSeq: got.afterSeq,
              desynced: got.desynced,
              applyError: got.applyError,
            },
            got.detail,
          );
        } finally {
          chassis.suppressVirtualRelay = false;
        }
      }
      case 'fold': {
        const ruleset = String(params.ruleset ?? bp.fold ?? 'soak');
        if (ruleset === 'soak' || ruleset === 'fold/soak') verdicts = foldSoak(chassis, overrides);
        else if (ruleset === 'cssom-foundation' || ruleset === 'fold/cssomFoundation')
          verdicts = foldCssomFoundation(chassis);
        else if (ruleset === 'cssom-heavy' || ruleset === 'fold/cssomHeavy') verdicts = foldCssomHeavy(chassis);
        else if (ruleset === 'cssom-double' || ruleset === 'fold/cssomDouble')
          verdicts = foldCssomDouble(chassis);
        else if (ruleset === 'apply-attrs' || ruleset === 'fold/applyAttrs') verdicts = foldApplyAttrs(chassis);
        else if (ruleset === 'svg-ns' || ruleset === 'fold/svgNs') verdicts = foldSvgNs(chassis);
        else if (ruleset === 'forms-state' || ruleset === 'fold/formsState') verdicts = foldFormsState(chassis);
        else if (ruleset === 'shadow-open' || ruleset === 'fold/shadowOpen') verdicts = foldShadowOpen(chassis);
        else if (ruleset === 'shadow-closed' || ruleset === 'fold/shadowClosed') verdicts = foldShadowClosed(chassis);
        else if (ruleset === 'shadow-manual' || ruleset === 'fold/shadowManual') verdicts = foldShadowManual(chassis);
        else if (ruleset === 'iframe-open' || ruleset === 'fold/iframeOpen') verdicts = foldIframeOpen(chassis);
        else if (ruleset === 'apply-honesty-desync' || ruleset === 'fold/applyHonestyDesync') {
          const kind = parseHostileKind(params.kind, bp.id);
          if (!kind) return finish(false, `unknown honesty kind ${String(params.kind ?? bp.id)}`);
          verdicts = foldApplyHonestyDesync(chassis, kind);
        } else if (ruleset === 'csp-nav-locale' || ruleset === 'fold/cspNavLocale') {
          verdicts = foldCspNavLocale(chassis);
        } else if (ruleset === 'turnstile' || ruleset === 'fold/turnstile') {
          verdicts = foldTurnstile(chassis);
        } else if (ruleset === 'cssom-matrix-nested' || ruleset === 'fold/cssomMatrixNested') {
          verdicts = foldCssomMatrixNested(chassis);
        } else if (ruleset === 'document-churn' || ruleset === 'fold/documentChurn') {
          verdicts = foldDocumentChurn(chassis);
        } else return finish(false, `unknown fold ruleset ${ruleset}`);
        return finish(true, `verdicts=${verdicts.length}`);
      }
      case 'writeDossier': {
        const dir = await chassis.exportDossier(verdicts, Date.now() - startedAt);
        if (bp.humanNotes && chassis.dossierHandle) {
          await writeJson(chassis.dossierHandle, 'meta.humanNotes.json', bp.humanNotes, 'meta.humanNotes');
        }
        if (chassis.dossierHandle) {
          await writeJson(chassis.dossierHandle, 'blueprint.json', resolved, 'blueprint');
        }
        return finish(!!dir, dir ?? 'no dossier');
      }
      default:
        return finish(false, `unknown action type`);
    }
  };

  const result = await runBlueprintSchedule(resolved, {
    runAction,
    onProgress: hooks.onProgress,
  });

  if (result.validateError) {
    verdicts = [{ id: 'blueprint.validate', status: 'fail', reason: result.validateError }];
    const dir = await hooks.chassis.exportDossier(verdicts, Date.now() - startedAt);
    return { verdicts, dossierDir: dir, ok: false };
  }

  for (const st of result.states.values()) {
    if (st.status === 'failed') {
      verdicts.push({
        id: `action.${st.action.id}`,
        status: 'fail',
        reason: st.detail ?? 'action failed',
      });
    }
  }

  if (!verdicts.some((v) => v.id.startsWith('iso.') || v.id.startsWith('snap.') || v.id === 'sensor.idle')) {
    // fold may have been skipped due to earlier failure — still export
  }

  let dossierDir = hooks.chassis.dossierHandle?.dir ?? null;
  if (!result.states.has('writeDossier') && !resolved.queues.some((q) => q.actions.some((a) => a.type === 'writeDossier'))) {
    dossierDir = await hooks.chassis.exportDossier(verdicts, Date.now() - startedAt);
  } else if (hooks.chassis.dossierHandle) {
    // writeDossier already finalized; refresh verdicts file if fold ran
    const { writeJson: wj } = await import('../dossier/write');
    await wj(hooks.chassis.dossierHandle, 'verdicts.json', verdicts, 'verdicts');
    dossierDir = hooks.chassis.dossierHandle.dir;
  }

  const ok = !verdicts.some((v) => v.status === 'fail') && result.ok;
  return { verdicts, dossierDir, ok };
}
