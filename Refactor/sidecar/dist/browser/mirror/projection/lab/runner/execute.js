"use strict";
/**
 * Execute blueprint actions against LabChassis.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBlueprint = executeBlueprint;
const schedule_1 = require("./schedule");
const write_1 = require("../dossier/write");
const isomorphism_1 = require("../probes/isomorphism");
const cpuProfile_1 = require("../probes/cpuProfile");
const soak_1 = require("../blueprints/fold/soak");
const cssomFoundation_1 = require("../blueprints/fold/cssomFoundation");
const cssomHeavy_1 = require("../blueprints/fold/cssomHeavy");
const cssomDouble_1 = require("../blueprints/fold/cssomDouble");
const applyAttrs_1 = require("../blueprints/fold/applyAttrs");
const applyHonestyDesync_1 = require("../blueprints/fold/applyHonestyDesync");
const hostileFrames_1 = require("./hostileFrames");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
const INJECT_APPLY_WAIT_MS = 250;
function tableHashFromSnap(snap) {
    const raw = snap?.table?.tableHash;
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    try {
        return BigInt(raw);
    }
    catch {
        return null;
    }
}
function parseHostileKind(raw, fallback) {
    const v = String(raw ?? fallback);
    if (v === 'attr' || v === 'ruleset' || v === 'eof')
        return v;
    if (v.endsWith('-attr'))
        return 'attr';
    if (v.endsWith('-ruleset'))
        return 'ruleset';
    if (v.endsWith('-eof'))
        return 'eof';
    return null;
}
function applyConditionalActions(bp, overrides) {
    const o = overrides ?? {};
    const keep = (a) => {
        if (a.type === 'cpu.start' || a.type === 'cpu.stop') {
            if (o.cpu === false)
                return false;
            if (o.cpu !== true && a.params?.optional === true)
                return false;
        }
        if (a.type === 'iso') {
            if (o.iso === false)
                return false;
            if (o.iso !== true && a.params?.optional === true)
                return false;
        }
        return true;
    };
    const keptIds = new Set();
    for (const q of bp.queues)
        for (const a of q.actions)
            if (keep(a))
                keptIds.add(a.id);
    const rewrite = (ids) => {
        if (!ids)
            return ids;
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
async function executeBlueprint(bp, hooks) {
    const overrides = hooks.overrides ?? {};
    const resolved = applyConditionalActions(bp, overrides);
    const startedAt = Date.now();
    let verdicts = [];
    const runAction = async (action, queue) => {
        const chassis = hooks.chassis;
        const params = action.params ?? {};
        const t0 = new Date().toISOString();
        const finish = (ok, detail) => {
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
                const urlRaw = (typeof overrides.url === 'string' && overrides.url) ||
                    (typeof params.url === 'string' ? params.url : null);
                if (!urlRaw)
                    return finish(false, 'boot.url required');
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
                if (!urlRaw)
                    return finish(false, 'navigate.url required');
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
                if (!session)
                    return finish(false, 'no session');
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
                if (!session)
                    return finish(false, 'no session');
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
                if (!session?.flushProjectionSnapshot)
                    return finish(false, 'flushProjectionSnapshot missing');
                const mode = params.cssom ?? 'scan';
                const id = String(params.id ?? action.id);
                try {
                    const result = await session.flushProjectionSnapshot({
                        includeTree: params.includeTree === true,
                        cssom: mode,
                    });
                    chassis.journal.snaps.push({ id, mode, result });
                    if (chassis.dossierHandle) {
                        await (0, write_1.writeJson)(chassis.dossierHandle, `probes/snaps/${id}.json`, result, 'probes.snap');
                    }
                    return finish(result.ok !== false, result.ok === false ? String(result.reason) : id);
                }
                finally {
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
                if (!start?.ok)
                    return finish(false, start?.reason ?? 'startCpuProfile failed');
                return finish(true);
            }
            case 'cpu.stop': {
                const stop = await chassis.browser?.stopCpuProfile?.();
                if (!stop?.ok || !stop.profileBytes)
                    return finish(false, stop?.reason ?? 'stopCpuProfile failed');
                const raw = JSON.parse(new TextDecoder().decode(stop.profileBytes));
                const summary = (0, cpuProfile_1.summarizeProfile)(raw, 20);
                if (chassis.dossierHandle) {
                    await (0, write_1.writeJson)(chassis.dossierHandle, 'probes/cpu/summary.json', summary, 'probes.cpu.summary');
                    await (0, write_1.writeBinaryArtifact)(chassis.dossierHandle, 'probes/cpu/profile.cpuprofile', JSON.stringify(raw), 'probes.cpu.profile', 'application/json');
                }
                chassis.journal.cpuSummary = summary;
                return finish(true, `samples=${summary.totalSamples}`);
            }
            case 'iso': {
                const session = chassis.browser;
                if (!session)
                    return finish(false, 'no session');
                const iso = await (0, isomorphism_1.runIsomorphism)({
                    session,
                    getClientSnapshot: hooks.requestClientSnapshot,
                });
                chassis.journal.iso = iso;
                if (chassis.dossierHandle) {
                    await (0, write_1.writeJson)(chassis.dossierHandle, 'probes/iso.json', {
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
                    }, 'probes.iso');
                }
                return finish(true);
            }
            case 'collect.enable':
                return finish(true, 'collectors always on chassis');
            case 'injectFrame': {
                const kind = parseHostileKind(params.kind, bp.id);
                if (!kind)
                    return finish(false, `unknown inject kind ${String(params.kind ?? bp.id)}`);
                const record = (row, detail, ok = true) => {
                    chassis.journal.injects.push(row);
                    return finish(ok, detail);
                };
                if (!chassis.hasClientRelay || !hooks.requestClientSnapshot) {
                    return record({ kind, skipped: true, skipReason: 'no DOM client' }, 'skipped: no DOM client');
                }
                chassis.suppressVirtualRelay = true;
                try {
                    await sleep(50);
                    const before = await hooks.requestClientSnapshot();
                    if (before == null || before.sequence == null) {
                        return record({ kind, skipped: true, skipReason: 'client snapshot missing' }, 'skipped: client snapshot missing');
                    }
                    const generation = before.generation ?? chassis.stats.lastGeneration ?? 1;
                    const hash0 = tableHashFromSnap(before);
                    if (hash0 === null) {
                        return record({ kind, skipped: true, skipReason: 'client tableHash missing' }, 'skipped: client tableHash missing');
                    }
                    if (kind === 'attr' || kind === 'ruleset') {
                        const seq = before.sequence + 1;
                        const bytes = kind === 'attr'
                            ? (0, hostileFrames_1.encodeAttrDesyncFrame)(generation, seq, hash0)
                            : (0, hostileFrames_1.encodeRulesetDesyncFrame)(generation, seq, hash0);
                        chassis.relayClientOnlyFrame(bytes);
                        await sleep(INJECT_APPLY_WAIT_MS);
                        const after = await hooks.requestClientSnapshot();
                        return record({
                            kind,
                            sequence: after?.sequence ?? seq,
                            desynced: after?.desynced === true,
                            applyError: after?.applyError ?? null,
                        }, after?.desynced ? `desynced ${after.applyError ?? ''}` : 'client still synced after inject');
                    }
                    const setupSeq = before.sequence + 1;
                    chassis.relayClientOnlyFrame((0, hostileFrames_1.encodeEofSetupFrame)(generation, setupSeq, hash0));
                    await sleep(INJECT_APPLY_WAIT_MS);
                    const afterSetup = await hooks.requestClientSnapshot();
                    if (afterSetup?.desynced) {
                        return record({
                            kind,
                            sequence: afterSetup.sequence ?? setupSeq,
                            desynced: true,
                            applyError: afterSetup.applyError ?? 'eof setup desynced',
                        }, 'eof setup frame desynced (want success then ghost)');
                    }
                    const hash1 = tableHashFromSnap(afterSetup) ?? hash0;
                    const setupOkSeq = afterSetup?.sequence ?? setupSeq;
                    hooks.sendControl?.({ type: 'lab.tamper', kind: 'ghostRule' });
                    await sleep(50);
                    chassis.relayClientOnlyFrame((0, hostileFrames_1.encodeEofCheckFrame)(generation, setupOkSeq + 1, hash1));
                    await sleep(INJECT_APPLY_WAIT_MS);
                    const after = await hooks.requestClientSnapshot();
                    return record({
                        kind,
                        sequence: after?.sequence ?? setupOkSeq + 1,
                        desynced: after?.desynced === true,
                        applyError: after?.applyError ?? null,
                    }, after?.desynced ? `desynced ${after.applyError ?? ''}` : 'client still synced after eof CHECK');
                }
                finally {
                    chassis.suppressVirtualRelay = false;
                }
            }
            case 'fold': {
                const ruleset = String(params.ruleset ?? bp.fold ?? 'soak');
                if (ruleset === 'soak' || ruleset === 'fold/soak')
                    verdicts = (0, soak_1.foldSoak)(chassis, overrides);
                else if (ruleset === 'cssom-foundation' || ruleset === 'fold/cssomFoundation')
                    verdicts = (0, cssomFoundation_1.foldCssomFoundation)(chassis);
                else if (ruleset === 'cssom-heavy' || ruleset === 'fold/cssomHeavy')
                    verdicts = (0, cssomHeavy_1.foldCssomHeavy)(chassis);
                else if (ruleset === 'cssom-double' || ruleset === 'fold/cssomDouble')
                    verdicts = (0, cssomDouble_1.foldCssomDouble)(chassis);
                else if (ruleset === 'apply-attrs' || ruleset === 'fold/applyAttrs')
                    verdicts = (0, applyAttrs_1.foldApplyAttrs)(chassis);
                else if (ruleset === 'apply-honesty-desync' || ruleset === 'fold/applyHonestyDesync') {
                    const kind = parseHostileKind(params.kind, bp.id);
                    if (!kind)
                        return finish(false, `unknown honesty kind ${String(params.kind ?? bp.id)}`);
                    verdicts = (0, applyHonestyDesync_1.foldApplyHonestyDesync)(chassis, kind);
                }
                else
                    return finish(false, `unknown fold ruleset ${ruleset}`);
                return finish(true, `verdicts=${verdicts.length}`);
            }
            case 'writeDossier': {
                const dir = await chassis.exportDossier(verdicts, Date.now() - startedAt);
                if (bp.humanNotes && chassis.dossierHandle) {
                    await (0, write_1.writeJson)(chassis.dossierHandle, 'meta.humanNotes.json', bp.humanNotes, 'meta.humanNotes');
                }
                if (chassis.dossierHandle) {
                    await (0, write_1.writeJson)(chassis.dossierHandle, 'blueprint.json', resolved, 'blueprint');
                }
                return finish(!!dir, dir ?? 'no dossier');
            }
            default:
                return finish(false, `unknown action type`);
        }
    };
    const result = await (0, schedule_1.runBlueprintSchedule)(resolved, {
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
    }
    else if (hooks.chassis.dossierHandle) {
        // writeDossier already finalized; refresh verdicts file if fold ran
        const { writeJson: wj } = await Promise.resolve().then(() => __importStar(require('../dossier/write')));
        await wj(hooks.chassis.dossierHandle, 'verdicts.json', verdicts, 'verdicts');
        dossierDir = hooks.chassis.dossierHandle.dir;
    }
    const ok = !verdicts.some((v) => v.status === 'fail') && result.ok;
    return { verdicts, dossierDir, ok };
}
//# sourceMappingURL=execute.js.map