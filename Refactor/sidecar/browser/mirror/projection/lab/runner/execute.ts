/**
 * Execute blueprint actions against LabChassis.
 */

import type { LabChassis } from '../host/chassis';
import type { LabAction, LabBlueprint } from './types';
import { runBlueprintSchedule } from './schedule';
import type { LabVerdict } from '../dossier/types';
import { writeJson, writeBinaryArtifact } from '../dossier/write';
import { runIsomorphism } from '../probes/isomorphism';
import { summarizeProfile, type CpuProfile } from '../probes/cpuProfile';
import { foldSoak } from '../blueprints/fold/soak';
import { foldCssomFoundation } from '../blueprints/fold/cssomFoundation';
import { foldCssomHeavy } from '../blueprints/fold/cssomHeavy';
import { foldCssomDouble } from '../blueprints/fold/cssomDouble';
import { foldApplyAttrs } from '../blueprints/fold/applyAttrs';
import { foldApplyHonestyDesync } from '../blueprints/fold/applyHonestyDesync';
import type { HostileKind } from './hostileFrames';
import {
  encodeAttrDesyncFrame,
  encodeRulesetDesyncFrame,
  encodeEofSetupFrame,
  encodeEofCheckFrame,
} from './hostileFrames';
import type { ClientStateSnapshot } from '../probes/isomorphism';

export type ExecuteHooks = {
  chassis: LabChassis;
  resolveUrl: (url: string) => string;
  requestClientSnapshot?: () => Promise<import('../probes/isomorphism').ClientStateSnapshot | null>;
  sendControl?: (msg: { type: 'lab.tamper'; kind: 'ghostRule' }) => void;
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

const INJECT_APPLY_WAIT_MS = 250;

function tableHashFromSnap(snap: ClientStateSnapshot | null): bigint | null {
  const raw = snap?.table?.tableHash;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
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

    switch (action.type) {
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
        const r = await session.evaluate(expression);
        chassis.journal.acts.push({
          name: action.id,
          ok: r.ok,
          error: r.ok ? undefined : (r.errorMessage ?? 'evaluate failed'),
        });
        return finish(r.ok, r.errorMessage);
      }
      case 'snap': {
        const session = chassis.browser;
        if (!session?.flushProjectionSnapshot) return finish(false, 'flushProjectionSnapshot missing');
        const mode = (params.cssom as 'none' | 'committed' | 'scan') ?? 'scan';
        const id = String(params.id ?? action.id);
        try {
          const result = await session.flushProjectionSnapshot({
            includeTree: params.includeTree === true,
            cssom: mode,
          });
          chassis.journal.snaps.push({ id, mode, result });
          if (chassis.dossierHandle) {
            await writeJson(chassis.dossierHandle, `probes/snaps/${id}.json`, result, 'probes.snap');
          }
          return finish(result.ok !== false, result.ok === false ? String((result as { reason?: string }).reason) : id);
        } finally {
          await session.resumeProjectionWorld?.();
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
        chassis.browser?.sendPageProjectionControl?.({
          type: 'requestResync',
          reason: String(params.reason ?? bp.id),
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
          getClientSnapshot: hooks.requestClientSnapshot,
        });
        chassis.journal.iso = iso;
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
            },
            'probes.iso',
          );
        }
        return finish(true);
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
        chassis.suppressVirtualRelay = true;
        try {
          await sleep(50);
          const before = await hooks.requestClientSnapshot();
          if (before == null || before.sequence == null) {
            return record(
              { kind, skipped: true, skipReason: 'client snapshot missing' },
              'skipped: client snapshot missing',
            );
          }
          const generation = before.generation ?? chassis.stats.lastGeneration ?? 1;
          const hash0 = tableHashFromSnap(before);
          if (hash0 === null) {
            return record(
              { kind, skipped: true, skipReason: 'client tableHash missing' },
              'skipped: client tableHash missing',
            );
          }

          if (kind === 'attr' || kind === 'ruleset') {
            const seq = before.sequence + 1;
            const bytes =
              kind === 'attr'
                ? encodeAttrDesyncFrame(generation, seq, hash0)
                : encodeRulesetDesyncFrame(generation, seq, hash0);
            chassis.relayClientOnlyFrame(bytes);
            await sleep(INJECT_APPLY_WAIT_MS);
            const after = await hooks.requestClientSnapshot();
            return record(
              {
                kind,
                sequence: after?.sequence ?? seq,
                desynced: after?.desynced === true,
                applyError: after?.applyError ?? null,
              },
              after?.desynced ? `desynced ${after.applyError ?? ''}` : 'client still synced after inject',
            );
          }

          const setupSeq = before.sequence + 1;
          chassis.relayClientOnlyFrame(encodeEofSetupFrame(generation, setupSeq, hash0));
          await sleep(INJECT_APPLY_WAIT_MS);
          const afterSetup = await hooks.requestClientSnapshot();
          if (afterSetup?.desynced) {
            return record(
              {
                kind,
                sequence: afterSetup.sequence ?? setupSeq,
                desynced: true,
                applyError: afterSetup.applyError ?? 'eof setup desynced',
              },
              'eof setup frame desynced (want success then ghost)',
            );
          }
          const hash1 = tableHashFromSnap(afterSetup) ?? hash0;
          const setupOkSeq = afterSetup?.sequence ?? setupSeq;
          hooks.sendControl?.({ type: 'lab.tamper', kind: 'ghostRule' });
          await sleep(50);
          chassis.relayClientOnlyFrame(encodeEofCheckFrame(generation, setupOkSeq + 1, hash1));
          await sleep(INJECT_APPLY_WAIT_MS);
          const after = await hooks.requestClientSnapshot();
          return record(
            {
              kind,
              sequence: after?.sequence ?? setupOkSeq + 1,
              desynced: after?.desynced === true,
              applyError: after?.applyError ?? null,
            },
            after?.desynced ? `desynced ${after.applyError ?? ''}` : 'client still synced after eof CHECK',
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
        else if (ruleset === 'apply-honesty-desync' || ruleset === 'fold/applyHonestyDesync') {
          const kind = parseHostileKind(params.kind, bp.id);
          if (!kind) return finish(false, `unknown honesty kind ${String(params.kind ?? bp.id)}`);
          verdicts = foldApplyHonestyDesync(chassis, kind);
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
