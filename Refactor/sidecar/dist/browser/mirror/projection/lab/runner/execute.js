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
const svgNs_1 = require("../blueprints/fold/svgNs");
const formsState_1 = require("../blueprints/fold/formsState");
const shadowOpen_1 = require("../blueprints/fold/shadowOpen");
const iframeOpen_1 = require("../blueprints/fold/iframeOpen");
const applyHonestyDesync_1 = require("../blueprints/fold/applyHonestyDesync");
const hostileFrames_1 = require("./hostileFrames");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
const INJECT_POLL_MS = 10;
const INJECT_READY_MS = 2_000;
const INJECT_APPLY_MS = 2_000;
function tableHashFromSnap(snap) {
    const raw = snap?.table?.tableHash;
    if (typeof raw === 'string' && raw.length > 0) {
        try {
            return BigInt(raw);
        }
        catch {
            return null;
        }
    }
    return null;
}
async function pollClientSnapshot(get, pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const snap = await get();
        if (snap !== null) {
            last = snap;
            if (pred(snap))
                return snap;
        }
        await sleep(INJECT_POLL_MS);
    }
    return last;
}
function injectDetail(args) {
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
function ackToSnap(ack) {
    if (ack === null)
        return null;
    return {
        tree: null,
        table: ack.tableHash ? { rowCount: 0, tableHash: ack.tableHash } : null,
        sequence: ack.sequence,
        generation: ack.generation,
        desynced: ack.desynced,
        applyError: ack.applyError,
    };
}
async function deliverHostileFrame(chassis, hooks, bytes) {
    if (hooks.injectClientFrame) {
        chassis.noteClientOnlyFrame(bytes);
        return hooks.injectClientFrame(bytes);
    }
    chassis.relayClientOnlyFrame(bytes);
    return null;
}
/** lastSequence advances before apply — seq bump alone is not a desync observation. */
async function waitDesyncOrTimeout(getClientSnapshot, timeoutMs) {
    return pollClientSnapshot(getClientSnapshot, (s) => s.desynced === true, timeoutMs);
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
        const actionType = action.type === 'pushDomInput' ? 'pushInput' : action.type;
        switch (actionType) {
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
                    inputAdapterKind: overrides.inputAdapterKind,
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
            case 'pushInput': {
                const session = chassis.browser;
                const pushFn = session.pushInput?.bind(session);
                if (!session || !pushFn)
                    return finish(false, 'pushInput missing');
                const push = pushFn;
                const sequence = params.sequence;
                if (Array.isArray(sequence)) {
                    for (const step of sequence) {
                        if (!step || typeof step !== 'object')
                            return finish(false, 'invalid pushDomInput step');
                        const st = step;
                        if (st.type === 'resolveAndClick') {
                            const selector = String(st.selector ?? '');
                            const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
                            const v4 = session;
                            if (typeof v4.resolveAndClickDomInput === 'function') {
                                const out = await v4.resolveAndClickDomInput(selector, contextId);
                                if (out.status === 'dropped')
                                    return finish(false, out.reason ?? 'click failed');
                                chassis.journal.acts.push({ name: `click:${selector}`, ok: true });
                                continue;
                            }
                            const r = await session.evaluate(`(() => {
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
                })()`);
                            if (!r.ok)
                                return finish(false, r.errorMessage ?? 'resolveAndClick evaluate failed');
                            let info;
                            try {
                                info = JSON.parse(r.value ?? '{}');
                            }
                            catch {
                                return finish(false, 'resolveAndClick parse failed');
                            }
                            if (!info.id)
                                return finish(false, 'resolveAndClick no id');
                            let vw = 1280;
                            let vh = 720;
                            try {
                                const st = await session.getStatus();
                                if (st.width > 0)
                                    vw = st.width;
                                if (st.height > 0)
                                    vh = st.height;
                            }
                            catch {
                                /* */
                            }
                            for (const type of ['move', 'down', 'up']) {
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
                                    payloadJson: JSON.stringify({ x: info.x, y: info.y, button: 'left' }),
                                    census: {
                                        contexts: [
                                            {
                                                contextId,
                                                positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }],
                                            },
                                        ],
                                    },
                                });
                                if (out.status === 'dropped')
                                    return finish(false, `${type}: ${out.reason}`);
                            }
                            chassis.journal.acts.push({ name: `click:${selector}`, ok: true });
                            continue;
                        }
                        if (st.type === 'resolveAndType') {
                            const selector = String(st.selector ?? '');
                            const value = String(st.value ?? '');
                            const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
                            const v4 = session;
                            if (typeof v4.resolveAndTypeDomInput !== 'function')
                                return finish(false, 'resolveAndType missing');
                            const out = await v4.resolveAndTypeDomInput(selector, value, contextId);
                            if (out.status === 'dropped')
                                return finish(false, out.reason ?? 'type failed');
                            chassis.journal.acts.push({ name: `type:${selector}`, ok: true });
                            continue;
                        }
                        if (st.type === 'resolveAndScrollElement') {
                            const selector = String(st.selector ?? '');
                            const scrollTop = typeof st.scrollTop === 'number' ? st.scrollTop : 0;
                            const contextId = typeof st.contextId === 'number' && st.contextId > 0 ? st.contextId : 1;
                            const v4 = session;
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
                            const v4 = session;
                            if (typeof v4.resolveAndScrollViewportDomInput !== 'function') {
                                return finish(false, 'resolveAndScrollViewport missing');
                            }
                            const out = await v4.resolveAndScrollViewportDomInput(scrollY, scrollX, contextId);
                            if (out.status === 'dropped')
                                return finish(false, out.reason ?? 'viewport scroll failed');
                            chassis.journal.acts.push({ name: `scrollViewport:${scrollY}`, ok: true });
                            continue;
                        }
                        const out = await push(st);
                        if (out.status === 'dropped')
                            return finish(false, out.reason);
                    }
                    return finish(true);
                }
                const out = await push(params);
                return finish(out.status === 'dispatched', out.status === 'dropped' ? out.reason : undefined);
            }
            case 'snap': {
                const session = chassis.browser;
                if (!session)
                    return finish(false, 'no session');
                const mode = params.cssom ?? 'scan';
                const id = String(params.id ?? action.id);
                try {
                    await session.haltClocks?.();
                    const view = await (0, isomorphism_1.captureVirtualLabSnap)(session, 1, {
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
                        await (0, write_1.writeJson)(chassis.dossierHandle, `probes/snaps/${id}.json`, result, 'probes.snap');
                    }
                    return finish(result.ok !== false, result.ok === false ? String(result.reason) : id);
                }
                finally {
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
                    contextIds: chassis.contextIndex.list(),
                    getClientSnapshot: hooks.requestClientSnapshot
                        ? (contextId) => hooks.requestClientSnapshot(contextId)
                        : undefined,
                });
                chassis.journal.iso = iso;
                if (iso.nested && iso.nested.virtualDocs + iso.nested.clientDocs > 0) {
                    const prev = chassis.journal.nestedEvidence ?? {
                        virtualDocs: 0,
                        clientDocs: 0,
                        clientFrameHrefs: [],
                        treeIdenticalWhileNested: false,
                        treeDivergencesWhileNested: 0,
                    };
                    const hrefs = [...prev.clientFrameHrefs];
                    for (const h of iso.nested.clientFrameHrefs) {
                        if (!hrefs.includes(h))
                            hrefs.push(h);
                    }
                    let treeIdenticalWhileNested = prev.treeIdenticalWhileNested;
                    let treeDivergencesWhileNested = prev.treeDivergencesWhileNested;
                    if (iso.nested.virtualDocs > 0 && iso.structuralDiff) {
                        if (iso.structuralDiff.identical)
                            treeIdenticalWhileNested = true;
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
                        formProps: iso.formProps,
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
                const getClientSnapshot = () => hooks.requestClientSnapshot(1);
                chassis.suppressVirtualRelay = true;
                try {
                    const live = await pollClientSnapshot(getClientSnapshot, (s) => s.armed === true && s.resyncInFlight !== true && s.sequence != null, INJECT_READY_MS);
                    if (live == null || live.sequence == null) {
                        return record({ kind, skipped: true, skipReason: 'client snapshot missing' }, 'skipped: client snapshot missing');
                    }
                    if (live.armed !== true) {
                        return record({ kind, skipped: true, skipReason: 'client not armed' }, 'skipped: client not armed');
                    }
                    if (live.resyncInFlight === true) {
                        return record({ kind, skipped: true, skipReason: 'resync in flight' }, 'skipped: resync in flight');
                    }
                    const beforeSeq = live.sequence;
                    const generation = live.generation ?? chassis.stats.lastGeneration ?? 1;
                    const hash0 = tableHashFromSnap(live);
                    if (hash0 === null) {
                        return record({ kind, skipped: true, skipReason: 'client tableHash missing' }, 'skipped: client tableHash missing');
                    }
                    const observeDesync = async (ack) => {
                        if (ack?.desynced === true)
                            return ackToSnap(ack);
                        const polled = await waitDesyncOrTimeout(getClientSnapshot, INJECT_APPLY_MS);
                        if (polled?.desynced === true)
                            return polled;
                        return ackToSnap(ack) ?? polled;
                    };
                    if (kind === 'attr' || kind === 'ruleset') {
                        const seq = beforeSeq + 1;
                        const bytes = kind === 'attr'
                            ? (0, hostileFrames_1.encodeAttrDesyncFrame)(generation, seq, hash0)
                            : (0, hostileFrames_1.encodeRulesetDesyncFrame)(generation, seq, hash0);
                        const ack = await deliverHostileFrame(chassis, hooks, bytes);
                        const after = (await observeDesync(ack)) ?? ackToSnap(ack);
                        const got = injectDetail({
                            beforeSeq,
                            after,
                            stillSynced: 'client still synced after inject',
                        });
                        return record({
                            kind,
                            sequence: got.afterSeq,
                            beforeSeq,
                            afterSeq: got.afterSeq,
                            desynced: got.desynced,
                            applyError: got.applyError,
                        }, got.detail);
                    }
                    const setupSeq = beforeSeq + 1;
                    const setupAck = await deliverHostileFrame(chassis, hooks, (0, hostileFrames_1.encodeEofSetupFrame)(generation, setupSeq, hash0));
                    const afterSetup = setupAck !== null
                        ? ackToSnap(setupAck)
                        : await pollClientSnapshot(getClientSnapshot, (s) => s.desynced === true ||
                            (s.sequence != null &&
                                s.sequence >= setupSeq &&
                                tableHashFromSnap(s) !== null &&
                                tableHashFromSnap(s) !== hash0), INJECT_APPLY_MS);
                    if (afterSetup?.desynced) {
                        return record({
                            kind,
                            sequence: afterSetup.sequence ?? setupSeq,
                            beforeSeq,
                            afterSeq: afterSetup.sequence ?? setupSeq,
                            desynced: true,
                            applyError: afterSetup.applyError ?? 'eof setup desynced',
                        }, 'eof setup frame desynced (want success then ghost)');
                    }
                    if ((afterSetup?.sequence ?? beforeSeq) <= beforeSeq) {
                        return record({
                            kind,
                            sequence: afterSetup?.sequence ?? beforeSeq,
                            beforeSeq,
                            afterSeq: afterSetup?.sequence ?? beforeSeq,
                            desynced: false,
                            applyError: 'inject not ingested',
                        }, 'inject not ingested');
                    }
                    const hash1 = tableHashFromSnap(afterSetup) ?? hash0;
                    const setupOkSeq = afterSetup?.sequence ?? setupSeq;
                    const tamper = hooks.requestTamper ? await hooks.requestTamper() : null;
                    if (tamper == null || tamper.ok !== true) {
                        const reason = tamper?.reason ?? 'tamper missed constructed sheet';
                        return record({
                            kind,
                            sequence: setupOkSeq,
                            beforeSeq,
                            afterSeq: setupOkSeq,
                            desynced: false,
                            applyError: reason,
                        }, reason);
                    }
                    const checkAck = await deliverHostileFrame(chassis, hooks, (0, hostileFrames_1.encodeEofCheckFrame)(generation, setupOkSeq + 1, hash1));
                    const after = (await observeDesync(checkAck)) ?? ackToSnap(checkAck);
                    const got = injectDetail({
                        beforeSeq: setupOkSeq,
                        after,
                        stillSynced: 'client still synced after eof CHECK',
                    });
                    return record({
                        kind,
                        sequence: got.afterSeq,
                        beforeSeq,
                        afterSeq: got.afterSeq,
                        desynced: got.desynced,
                        applyError: got.applyError,
                    }, got.detail);
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
                else if (ruleset === 'svg-ns' || ruleset === 'fold/svgNs')
                    verdicts = (0, svgNs_1.foldSvgNs)(chassis);
                else if (ruleset === 'forms-state' || ruleset === 'fold/formsState')
                    verdicts = (0, formsState_1.foldFormsState)(chassis);
                else if (ruleset === 'shadow-open' || ruleset === 'fold/shadowOpen')
                    verdicts = (0, shadowOpen_1.foldShadowOpen)(chassis);
                else if (ruleset === 'shadow-closed' || ruleset === 'fold/shadowClosed')
                    verdicts = (0, shadowOpen_1.foldShadowClosed)(chassis);
                else if (ruleset === 'shadow-manual' || ruleset === 'fold/shadowManual')
                    verdicts = (0, shadowOpen_1.foldShadowManual)(chassis);
                else if (ruleset === 'iframe-open' || ruleset === 'fold/iframeOpen')
                    verdicts = (0, iframeOpen_1.foldIframeOpen)(chassis);
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