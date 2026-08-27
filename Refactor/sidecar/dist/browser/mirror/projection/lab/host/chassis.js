"use strict";
/**
 * Lab chassis — Virtual lifecycle, sinks, dossier bind. Caller of BrowserSession only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabChassis = exports.CssomOpWindow = void 0;
exports.getActiveLabChassis = getActiveLabChassis;
exports.installLabProcessCrashHooks = installLabProcessCrashHooks;
exports.acceptClientTelemetry = acceptClientTelemetry;
const node_crypto_1 = require("node:crypto");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const PageProjectionBrowserSession_1 = require("../../session/PageProjectionBrowserSession");
const labLaunch_1 = require("../../session/labLaunch");
const cpuProfile_1 = require("../probes/cpuProfile");
const write_1 = require("../dossier/write");
const frameInvariantMonitor_1 = require("../probes/frameInvariantMonitor");
const metricsAggregator_1 = require("../probes/metricsAggregator");
const nodeTableApply_1 = require("../probes/nodeTableApply");
const isomorphism_1 = require("../probes/isomorphism");
const iso_1 = require("../blueprints/fold/iso");
const contextIndex_1 = require("./contextIndex");
const opcodes_1 = require("@speculum/page-projection/core/opcodes");
const decode_1 = require("@speculum/page-projection/core/decode");
const frame_1 = require("@speculum/page-projection/core/frame");
class CssomOpWindow {
    enabled = false;
    counts = {
        sheetNew: 0,
        sheetDrop: 0,
        sheetOrder: 0,
        ruleNew: 0,
        ruleDrop: 0,
        ruleSet: 0,
    };
    persistent = new decode_1.PersistentStringTable();
    assembler = new decode_1.FramePartAssembler();
    start() {
        const c = this.counts;
        c.sheetNew = 0;
        c.sheetDrop = 0;
        c.sheetOrder = 0;
        c.ruleNew = 0;
        c.ruleDrop = 0;
        c.ruleSet = 0;
        this.enabled = true;
    }
    stop() {
        this.enabled = false;
    }
    observe(buf) {
        if (!this.enabled)
            return;
        const decoded = (0, decode_1.decodeFramePart)(buf, this.persistent);
        if (!decoded.ok)
            return;
        const assembled = this.assembler.ingest(decoded.part);
        if (assembled === 'missing_part' || assembled === 'malformed' || assembled === null)
            return;
        for (const op of assembled.ops) {
            if (op.op === opcodes_1.OpCode.SheetNew)
                this.counts.sheetNew += 1;
            else if (op.op === opcodes_1.OpCode.SheetDrop)
                this.counts.sheetDrop += 1;
            else if (op.op === opcodes_1.OpCode.SheetOrder)
                this.counts.sheetOrder += 1;
            else if (op.op === opcodes_1.OpCode.RuleNew)
                this.counts.ruleNew += 1;
            else if (op.op === opcodes_1.OpCode.RuleDrop)
                this.counts.ruleDrop += 1;
            else if (op.op === opcodes_1.OpCode.RuleSet)
                this.counts.ruleSet += 1;
        }
    }
}
exports.CssomOpWindow = CssomOpWindow;
function peekFrameHeader(buf) {
    const peeked = (0, decode_1.peekFrameHeader)(buf);
    if (!peeked)
        return null;
    return { generation: peeked.generation, sequence: peeked.sequence, contextId: peeked.contextId };
}
/** Last booted chassis — process crash hooks write here before exit. */
let activeChassis = null;
function getActiveLabChassis() {
    return activeChassis;
}
function installLabProcessCrashHooks() {
    const sink = (errorCode, err) => {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        const chassis = activeChassis;
        if (chassis) {
            chassis.recordCrash({
                errorCode,
                phase: 'runtime',
                message,
                source: 'process',
                stack,
            });
            void chassis.emergencyExport().catch(() => undefined);
        }
        console.error(`[projection-lab] ${errorCode}:`, message);
        if (stack)
            console.error(stack);
        if (chassis?.dossierHandle) {
            console.error(`[projection-lab] crash written → ${chassis.dossierHandle.dir}/crash.json`);
        }
    };
    process.on('unhandledRejection', (reason) => {
        sink('unhandled_rejection', reason);
    });
    process.on('uncaughtException', (err) => {
        sink('uncaught_exception', err);
        process.exitCode = 1;
    });
}
class LabChassis {
    connectionId;
    opts;
    session = null;
    record = null;
    dossier = null;
    frameRateHz = 60;
    telemetry = { ...telemetry_1.LAB_TELEMETRY_DEFAULTS };
    cpuProfiling = false;
    disposed = false;
    bootAtMs = 0;
    crash = null;
    cpuProfileStarted = false;
    stats = {
        framesFromVirtual: 0,
        bytesFromVirtual: 0,
        lastSequence: null,
        lastGeneration: null,
        telemetryMessages: 0,
    };
    metrics = new metricsAggregator_1.MetricsAggregator();
    contextIndex = new contextIndex_1.ContextIndex();
    invariantMonitors = new Map();
    /** Root-context wire monitor — legacy alias for CLI folds that expect a single monitor. */
    get invariantMonitor() {
        return this.monitorFor(frame_1.CONTEXT_ID_ROOT);
    }
    /**
     * Root-only apply mirror for CLI inject folds — tracks the top-level context sequence/table.
     * Nested context frames update per-context invariant monitors but not this applier or
     * `stats.lastSequence` (inject proofs target the root surface).
     */
    nodeTable = new nodeTableApply_1.NodeTableApplier();
    eventCounts = {};
    desyncs = [];
    idlePolls = 0;
    resyncPolls = 0;
    sheetsAbortedSum = 0;
    opWindows = new Map();
    onFrameRelay = null;
    onTelemetryRelay = null;
    onConsoleRelay = null;
    onFaultRelay = null;
    onDebugRelay = null;
    /** When true, Virtual frames still update collectors but are not sent to the DOM client. */
    suppressVirtualRelay = false;
    browseSnapSeq = 0;
    /** Bumped on dispose / cancel so in-flight browse snaps abort before write. */
    browseSnapEpoch = 0;
    /** Captured before disposeVirtual so Stop export still has inject metrics. */
    lastInputPipelineMetrics = null;
    /** Client capture counters from browse.stop payload. */
    lastInputCaptureMetrics = null;
    getClientSnapshotFn = null;
    static BROWSE_SNAP_TIMEOUT_MS = 45_000;
    journal = {
        acts: [],
        snaps: [],
        opWindows: {},
        injects: [],
        timeline: [],
        browseSnaps: [],
        intents: [],
        consoleCount: 0,
    };
    constructor(opts) {
        this.connectionId = (0, node_crypto_1.randomUUID)();
        this.opts = opts;
    }
    get sessionId() {
        return this.record?.sessionId ?? null;
    }
    get browser() {
        return this.session;
    }
    get dossierHandle() {
        return this.dossier;
    }
    get sessionRecord() {
        return this.record;
    }
    setFrameRelay(fn) {
        this.onFrameRelay = fn;
    }
    get hasClientRelay() {
        return this.onFrameRelay !== null;
    }
    /**
     * Record generation/sequence of a client-only inject without touching Virtual collectors.
     */
    noteClientOnlyFrame(buf) {
        const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        const hdr = peekFrameHeader(b);
        if (hdr) {
            this.stats.lastGeneration = hdr.generation;
            this.stats.lastSequence = hdr.sequence;
        }
    }
    /**
     * Send bytes on the client relay only — not Virtual, not nodeTable / invariants / op windows.
     * Updates lastSequence so a follow-up inject can stay contiguous with what the client saw.
     */
    relayClientOnlyFrame(buf) {
        const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        this.noteClientOnlyFrame(b);
        this.onFrameRelay?.(b);
    }
    setTelemetryRelay(fn) {
        this.onTelemetryRelay = fn;
    }
    setConsoleRelay(fn) {
        this.onConsoleRelay = fn;
    }
    setFaultRelay(fn) {
        this.onFaultRelay = fn;
    }
    setDebugRelay(fn) {
        this.onDebugRelay = fn;
    }
    sessionWallMs(now = Date.now()) {
        return this.bootAtMs > 0 ? Math.max(0, now - this.bootAtMs) : 0;
    }
    get crashRecord() {
        return this.crash;
    }
    /**
     * First crash wins. Writes crash.json sync so process-exit still leaves evidence.
     */
    recordCrash(fault) {
        if (this.crash)
            return this.crash;
        const at = new Date().toISOString();
        const record = {
            errorCode: fault.errorCode,
            message: fault.message,
            phase: fault.phase,
            t: Date.now(),
            at,
            source: fault.source ?? 'lab',
            stack: fault.stack,
        };
        this.crash = record;
        if (this.record) {
            this.record.status = 'faulted';
            this.record.fault = { message: `${record.errorCode}: ${record.message}`, at };
            if (this.dossier)
                (0, write_1.writeJsonSync)(this.dossier, 'session.json', this.record, 'session');
        }
        if (this.dossier) {
            (0, write_1.writeJsonSync)(this.dossier, 'crash.json', record, 'crash');
        }
        this.onFaultRelay?.(record);
        return record;
    }
    collectDebugProbe() {
        const session = this.session;
        const input = session?.getInputPipelineMetrics?.() ?? null;
        const intents = this.journal.intents;
        const intentOk = intents.filter((i) => i.ok).length;
        const intentDrop = intents.length - intentOk;
        const dropsByError = {};
        for (const i of intents) {
            if (i.ok || !i.error)
                continue;
            dropsByError[i.error] = (dropsByError[i.error] ?? 0) + 1;
        }
        return {
            t: Date.now(),
            wallMs: this.sessionWallMs(),
            cpuProfiling: this.cpuProfiling,
            cpuProfileStarted: this.cpuProfileStarted,
            crash: this.crash,
            sessionStatus: this.record?.status ?? null,
            dossierDir: this.dossier?.dir ?? null,
            framesFromVirtual: this.stats.framesFromVirtual,
            bytesFromVirtual: this.stats.bytesFromVirtual,
            telemetryMessages: this.stats.telemetryMessages,
            consoleCount: this.journal.consoleCount,
            intentJournal: {
                total: intents.length,
                ok: intentOk,
                dropped: intentDrop,
                dropsByError,
            },
            inputPipeline: input,
            metrics: this.metrics.getSummary(this.sessionWallMs()),
        };
    }
    pushDebugProbe() {
        this.onDebugRelay?.(this.collectDebugProbe());
    }
    /** Best-effort dump when process is dying — metrics + input pipe + crash. */
    async emergencyExport() {
        if (!this.dossier || !this.record)
            return null;
        try {
            const wallMs = this.sessionWallMs();
            await this.writeBrowseProbes(wallMs);
            await (0, write_1.finalizeDossier)(this.dossier, {
                session: this.record,
                verdicts: [
                    {
                        id: 'session.crash',
                        status: 'fail',
                        reason: this.crash
                            ? `${this.crash.errorCode}: ${this.crash.message}`
                            : 'emergency export without crash record',
                    },
                ],
                meta: {
                    wallMs,
                    url: this.record.url,
                    blueprintId: this.record.blueprintId,
                    frameRateHz: this.record.frameRateHz,
                    options: {
                        cpuProfiling: this.cpuProfiling,
                        emergency: true,
                        crash: this.crash,
                    },
                },
                counts: {
                    ...this.eventCounts,
                    console: this.journal.consoleCount,
                    intent: this.journal.intents.length,
                },
            });
            return this.dossier.dir;
        }
        catch {
            return this.dossier.dir;
        }
    }
    /** Bind Projected snapshot puller (WS `requestSnapshot` ↔ `client.snapshotResult`). */
    setClientSnapshotProvider(fn) {
        this.getClientSnapshotFn = fn;
    }
    get browseSnapCount() {
        return this.journal.browseSnaps.length;
    }
    observeFrameBytes(buf) {
        const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        this.stats.framesFromVirtual += 1;
        this.stats.bytesFromVirtual += b.length;
        const hdr = peekFrameHeader(b);
        this.contextIndex.observeFrameHeader(hdr);
        if (hdr) {
            this.monitorFor(hdr.contextId).observeFrameBytes(b);
            if (hdr.contextId === frame_1.CONTEXT_ID_ROOT) {
                this.stats.lastGeneration = hdr.generation;
                this.stats.lastSequence = hdr.sequence;
                this.nodeTable.observeFrameBytes(b);
                for (const w of this.opWindows.values())
                    w.observe(b);
            }
        }
        this.metrics.observeWireBytes(b.length);
        if (!this.suppressVirtualRelay)
            this.onFrameRelay?.(b);
    }
    monitorFor(contextId) {
        let monitor = this.invariantMonitors.get(contextId);
        if (!monitor) {
            monitor = new frameInvariantMonitor_1.FrameInvariantMonitor();
            this.invariantMonitors.set(contextId, monitor);
        }
        return monitor;
    }
    observeTelemetry(message) {
        this.stats.telemetryMessages += 1;
        this.contextIndex.observeTelemetry(message);
        this.metrics.observeTelemetry(message);
        this.monitorFor(message.contextId).observeTelemetry(message);
        this.eventCounts[message.kind] = (this.eventCounts[message.kind] ?? 0) + 1;
        if (message.kind === 'desynced')
            this.desyncs.push(message);
        if (message.kind === 'cssomPoll') {
            if (message.source === 'idle')
                this.idlePolls += 1;
            if (message.source === 'resync')
                this.resyncPolls += 1;
            this.sheetsAbortedSum += message.sheetsAborted ?? 0;
        }
        if (this.dossier)
            void (0, write_1.appendTelemetryEvent)(this.dossier, message);
        this.onTelemetryRelay?.(message);
    }
    startOpWindow(windowId) {
        const w = new CssomOpWindow();
        w.start();
        this.opWindows.set(windowId, w);
    }
    stopOpWindow(windowId) {
        const w = this.opWindows.get(windowId);
        if (!w)
            return { sheetNew: 0, sheetDrop: 0, sheetOrder: 0, ruleNew: 0, ruleDrop: 0, ruleSet: 0 };
        w.stop();
        const counts = { ...w.counts };
        this.journal.opWindows[windowId] = counts;
        this.opWindows.delete(windowId);
        if (this.dossier) {
            void (0, write_1.writeJson)(this.dossier, `wire/op-windows/${windowId}.json`, counts, 'wire.opWindow');
        }
        return counts;
    }
    browserEvents() {
        return {
            onVideoFrame: () => undefined,
            onAudioFrame: () => undefined,
            onPageProjectionFrame: (diff) => {
                this.observeFrameBytes(Buffer.from(diff.body));
            },
            onPageProjectionTelemetry: (message) => {
                this.observeTelemetry(message);
            },
            onConsole: (level, text) => {
                const ev = { t: Date.now(), level, text };
                this.journal.consoleCount += 1;
                this.eventCounts.console = (this.eventCounts.console ?? 0) + 1;
                if (this.dossier) {
                    void (0, write_1.appendNdjsonArtifact)(this.dossier, 'telemetry/console.ndjson', ev, 'telemetry.console');
                }
                this.onConsoleRelay?.(ev);
            },
            onLocationChanged: () => undefined,
            onMainFrameNavigationBlocked: () => undefined,
            onEditableFocusChanged: () => undefined,
            onCameraPermissionRequested: async () => 'deny',
            onMicrophonePermissionRequested: async () => 'deny',
            onCrash: (fault) => {
                const source = fault.errorCode === 'page_crash'
                    ? 'page'
                    : fault.errorCode === 'browser_disconnected'
                        ? 'browser'
                        : 'lab';
                this.recordCrash({
                    errorCode: fault.errorCode,
                    message: fault.message,
                    phase: fault.phase,
                    source,
                });
            },
        };
    }
    async boot(opts) {
        if (this.session)
            await this.disposeVirtual();
        this.frameRateHz = opts.frameRateHz ?? 60;
        this.telemetry = {
            ...telemetry_1.LAB_TELEMETRY_DEFAULTS,
            ...opts.telemetry,
        };
        this.cpuProfiling = opts.cpuProfiling === true;
        this.cpuProfileStarted = false;
        this.crash = null;
        this.bootAtMs = Date.now();
        this.metrics.reset();
        this.idlePolls = 0;
        this.resyncPolls = 0;
        this.sheetsAbortedSum = 0;
        this.journal = {
            acts: [],
            snaps: [],
            opWindows: {},
            injects: [],
            timeline: [],
            browseSnaps: [],
            intents: [],
            consoleCount: 0,
        };
        this.browseSnapSeq = 0;
        this.browseSnapEpoch += 1;
        this.contextIndex.noteBoot();
        this.invariantMonitors.clear();
        Object.keys(this.eventCounts).forEach((k) => delete this.eventCounts[k]);
        this.desyncs.length = 0;
        const sessionId = (0, node_crypto_1.randomUUID)();
        const createdAt = new Date().toISOString();
        const slug = opts.slug ?? (opts.blueprintId ? opts.blueprintId : (0, write_1.urlSlug)(opts.url));
        const baseDir = this.opts.outDir ?? (0, write_1.defaultLabRunsDir)();
        const record = {
            sessionId,
            mode: opts.mode,
            createdAt,
            url: opts.url,
            frameRateHz: this.frameRateHz,
            headed: !this.opts.headless,
            telemetry: this.telemetry,
            cpuProfiling: this.cpuProfiling,
            blueprintId: opts.blueprintId ?? null,
            dossierDir: '',
            status: 'booting',
        };
        this.dossier = await (0, write_1.createDossier)({
            baseDir,
            createdAt,
            slug,
            session: record,
        });
        record.dossierDir = this.dossier.dir;
        this.record = record;
        const factory = (0, PageProjectionBrowserSession_1.createPageProjectionBrowserSessionFactory)({
            headless: this.opts.headless,
            probes: {
                startCpuProfile: cpuProfile_1.startCpuProfile,
                stopCpuProfile: cpuProfile_1.stopCpuProfile,
            },
        });
        this.session = factory.create(sessionId, this.browserEvents());
        await this.session.launch((0, labLaunch_1.labLaunchOptions)({
            width: opts.width,
            height: opts.height,
            device: opts.device,
            frameRateHz: this.frameRateHz,
            projectionTelemetry: this.telemetry,
            cpuProfiling: this.cpuProfiling,
        }));
        await this.session.navigate(opts.url);
        record.url = opts.url;
        record.status = opts.mode === 'run' ? 'running' : 'live';
        await (0, write_1.writeJson)(this.dossier, 'session.json', record, 'session');
        activeChassis = this;
        if (this.cpuProfiling && opts.mode === 'browse') {
            const start = await this.session
                .startCpuProfile?.();
            this.cpuProfileStarted = start?.ok === true;
            if (!this.cpuProfileStarted) {
                await (0, write_1.writeJson)(this.dossier, 'probes/cpu/start-failed.json', { ok: false, reason: start?.reason ?? 'startCpuProfile failed' }, 'probes.cpu.startFailed');
            }
        }
        this.pushDebugProbe();
        return record;
    }
    async navigate(url) {
        if (!this.session || !this.record)
            throw new Error('chassis not booted');
        await this.session.navigate(url);
        this.record.url = url;
        if (this.dossier)
            await (0, write_1.writeJson)(this.dossier, 'session.json', this.record, 'session');
    }
    async resize(req) {
        if (!this.session) {
            return {
                ok: false,
                width: 0,
                height: 0,
                errorCode: 'session_not_open',
                phase: 'validate',
                message: 'chassis not booted',
            };
        }
        return this.session.resize({
            width: req.width,
            height: req.height,
            device: req.device,
        });
    }
    async journalIntent(intent, result) {
        const entry = {
            t: Date.now(),
            intent,
            ok: result.ok,
            error: result.error,
            mode: result.mode ?? 'CDP',
            dispatchMs: result.dispatchMs,
            clientLagMs: result.clientLagMs,
        };
        this.journal.intents.push(entry);
        this.eventCounts.intent = (this.eventCounts.intent ?? 0) + 1;
        // Motion intents are high-rate; keep them in memory for Stop export, skip live ndjson.
        const type = typeof intent.type === 'string' ? intent.type.toLowerCase() : '';
        const motion = type === 'move'
            || type === 'mousemove'
            || type === 'pointermove'
            || type === 'wheel'
            || type === 'scrollviewport'
            || type === 'scrollset';
        if (this.dossier && (!motion || !result.ok)) {
            await (0, write_1.appendNdjsonArtifact)(this.dossier, 'journal/intents.jsonl', entry, 'journal.intents');
        }
    }
    /** Client capture snapshot from browse.stop — written into input-pipeline probe. */
    setInputCaptureMetrics(metrics) {
        this.lastInputCaptureMetrics = metrics ?? null;
    }
    /**
     * Browse debug snap: digest/table pair for root + Projected nested contexts.
     * Full tree + cssom scan is blueprint iso only — on live Eneba it pins CDP for tens of seconds.
     */
    async captureBrowseSnap(label) {
        if (!this.session)
            throw new Error('chassis not booted');
        if (!this.getClientSnapshotFn)
            throw new Error('client snapshot provider not bound');
        const epoch = this.browseSnapEpoch;
        this.browseSnapSeq += 1;
        const id = `browse-${String(this.browseSnapSeq).padStart(3, '0')}`;
        const contextIds = await this.resolveBrowseSnapContextIds(epoch);
        let timeoutId;
        let iso;
        try {
            iso = await Promise.race([
                (0, isomorphism_1.runIsomorphism)({
                    session: this.session,
                    contextIds,
                    getClientSnapshot: (contextId) => this.getClientSnapshotFn(contextId),
                    virtualCapture: {
                        table: 'full',
                        liveChildOrder: true,
                        tree: false,
                        cssom: 'none',
                        formProps: false,
                        frameNewNodes: false,
                    },
                }),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(`browse snap timed out after ${LabChassis.BROWSE_SNAP_TIMEOUT_MS}ms`)), LabChassis.BROWSE_SNAP_TIMEOUT_MS);
                }),
            ]);
        }
        catch (err) {
            this.browseSnapEpoch += 1;
            throw err;
        }
        finally {
            if (timeoutId !== undefined)
                clearTimeout(timeoutId);
        }
        if (epoch !== this.browseSnapEpoch) {
            throw new Error('browse snap cancelled');
        }
        const record = {
            id,
            label,
            t: Date.now(),
            iso,
            allPass: iso.allPass === true,
        };
        this.journal.browseSnaps.push(record);
        this.journal.snaps.push({ id, mode: 'browse', result: iso });
        if (this.dossier) {
            await (0, write_1.writeJson)(this.dossier, `probes/snaps/${id}.json`, record, 'probes.snap');
        }
        return record;
    }
    /** Root always; other wire contexts only when Projected still has a surface for them. */
    async resolveBrowseSnapContextIds(epoch) {
        const wire = this.contextIndex.list();
        const candidates = wire.length > 0 ? wire : [frame_1.CONTEXT_ID_ROOT];
        const out = [];
        for (const id of candidates) {
            if (epoch !== this.browseSnapEpoch)
                throw new Error('browse snap cancelled');
            if (id === frame_1.CONTEXT_ID_ROOT) {
                out.push(id);
                continue;
            }
            const client = await this.getClientSnapshotFn(id);
            if (client != null)
                out.push(id);
        }
        if (out.length === 0)
            out.push(frame_1.CONTEXT_ID_ROOT);
        return out;
    }
    async validateBrowseSnaps() {
        const snaps = this.journal.browseSnaps;
        const verdicts = [];
        if (snaps.length === 0) {
            verdicts.push({ id: 'browse.iso', status: 'skipped', reason: 'no browse snaps collected' });
        }
        else {
            for (const snap of snaps) {
                const folded = (0, iso_1.foldIsoJournal)(snap.iso, { requireDomTree: false });
                for (const v of folded) {
                    verdicts.push({
                        ...v,
                        id: `${snap.id}.${v.id}`,
                        reason: `[${snap.id}${snap.label ? ` ${snap.label}` : ''}] ${v.reason ?? ''}`.trim(),
                    });
                }
                if (!snap.allPass) {
                    verdicts.push({
                        id: `${snap.id}.allPass`,
                        status: 'fail',
                        reason: 'stored snap reported allPass=false',
                    });
                }
            }
        }
        const pass = verdicts.filter((v) => v.status === 'pass').length;
        const fail = verdicts.filter((v) => v.status === 'fail').length;
        const skipped = verdicts.filter((v) => v.status === 'skipped').length;
        const allPass = fail === 0 && snaps.length > 0 && snaps.every((s) => s.allPass);
        const summary = {
            allPass,
            snapCount: snaps.length,
            pass,
            fail,
            skipped,
            verdicts,
            snaps: snaps.map((s) => ({
                id: s.id,
                label: s.label,
                t: s.t,
                allPass: s.allPass,
                sequence: s.iso?.sequence ?? null,
                generation: s.iso?.generation ?? null,
            })),
        };
        this.journal.browseIso = summary;
        if (this.dossier) {
            await (0, write_1.writeJson)(this.dossier, 'probes/iso-browse.json', summary, 'probes.isoBrowse');
        }
        return { allPass, snapCount: snaps.length, pass, fail, skipped, verdicts };
    }
    /** Snapshot input inject metrics while Virtual is still alive. */
    captureInputPipelineMetrics() {
        const session = this.session;
        this.lastInputPipelineMetrics = session?.getInputPipelineMetrics?.() ?? this.lastInputPipelineMetrics;
    }
    async disposeVirtual() {
        this.captureInputPipelineMetrics();
        // Invalidate in-flight snaps before closing so writers abort; closing the page
        // also unblocks a stuck page.evaluate that would otherwise pin CDP through Stop.
        this.browseSnapEpoch += 1;
        if (activeChassis === this)
            activeChassis = null;
        if (this.session) {
            if (this.cpuProfileStarted) {
                await this.stopCpuProfileToDossier(3_000);
            }
            await this.session.dispose();
            this.session = null;
        }
        if (this.record && this.record.status !== 'faulted') {
            this.record.status = 'stopped';
        }
    }
    /** Best-effort CPU stop; never blocks teardown longer than `timeoutMs`. */
    async stopCpuProfileToDossier(timeoutMs) {
        if (!this.cpuProfileStarted || !this.session) {
            this.cpuProfileStarted = false;
            return;
        }
        try {
            const stop = await Promise.race([
                this.session.stopCpuProfile?.() ?? Promise.resolve(null),
                new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
            ]);
            this.cpuProfileStarted = false;
            if (!this.dossier)
                return;
            if (stop?.ok && stop.profileBytes) {
                const raw = JSON.parse(new TextDecoder().decode(stop.profileBytes));
                const summary = (0, cpuProfile_1.summarizeProfile)(raw, 20);
                await (0, write_1.writeJson)(this.dossier, 'probes/cpu/summary.json', summary, 'probes.cpu.summary');
                await (0, write_1.writeBinaryArtifact)(this.dossier, 'probes/cpu/profile.cpuprofile', JSON.stringify(raw), 'probes.cpu.profile', 'application/json');
            }
            else if (stop && !stop.ok) {
                await (0, write_1.writeJson)(this.dossier, 'probes/cpu/stop-failed.json', { ok: false, reason: stop.reason ?? 'stopCpuProfile failed' }, 'probes.cpu.stopFailed');
            }
            else if (!stop) {
                await (0, write_1.writeJson)(this.dossier, 'probes/cpu/stop-failed.json', { ok: false, reason: `stopCpuProfile timed out after ${timeoutMs}ms` }, 'probes.cpu.stopFailed');
            }
        }
        catch (err) {
            this.cpuProfileStarted = false;
            if (this.dossier) {
                await (0, write_1.writeJson)(this.dossier, 'probes/cpu/stop-failed.json', { ok: false, reason: err instanceof Error ? err.message : String(err) }, 'probes.cpu.stopFailed');
            }
        }
    }
    async writeBrowseProbes(wallMs) {
        if (!this.dossier)
            return;
        if (this.cpuProfileStarted && this.session) {
            await this.stopCpuProfileToDossier(8_000);
        }
        const metricsSummary = this.metrics.getSummary(wallMs);
        await (0, write_1.writeJson)(this.dossier, 'probes/metrics.json', metricsSummary, 'probes.metrics');
        const session = this.session;
        const inject = session?.getInputPipelineMetrics?.() ?? this.lastInputPipelineMetrics;
        const intents = this.journal.intents;
        const dropsByError = {};
        for (const i of intents) {
            if (i.ok || !i.error)
                continue;
            dropsByError[i.error] = (dropsByError[i.error] ?? 0) + 1;
        }
        const byType = {};
        const byMode = {};
        const dispatchSamples = [];
        const lagSamples = [];
        for (const i of intents) {
            const t = typeof i.intent.type === 'string' ? i.intent.type : 'unknown';
            byType[t] = (byType[t] ?? 0) + 1;
            const mode = i.mode ?? '?';
            let m = byMode[mode];
            if (!m) {
                m = { total: 0, ok: 0, dropped: 0 };
                byMode[mode] = m;
            }
            m.total += 1;
            if (i.ok)
                m.ok += 1;
            else
                m.dropped += 1;
            if (typeof i.dispatchMs === 'number' && Number.isFinite(i.dispatchMs)) {
                dispatchSamples.push(i.dispatchMs);
            }
            if (typeof i.clientLagMs === 'number' && Number.isFinite(i.clientLagMs)) {
                lagSamples.push(i.clientLagMs);
            }
        }
        const pct = (samples) => {
            if (samples.length === 0)
                return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
            const sorted = [...samples].sort((a, b) => a - b);
            const sum = sorted.reduce((a, b) => a + b, 0);
            const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
            return {
                count: sorted.length,
                min: sorted[0],
                avg: sum / sorted.length,
                p95: sorted[p95Idx],
                max: sorted[sorted.length - 1],
            };
        };
        await (0, write_1.writeJson)(this.dossier, 'probes/input-pipeline.json', {
            wallMs,
            backend: 'cdp',
            path: 'eventApplier+sparseCdp',
            capture: this.lastInputCaptureMetrics,
            journal: {
                total: intents.length,
                ok: intents.filter((x) => x.ok).length,
                dropped: intents.filter((x) => !x.ok).length,
                dropsByError,
                byType,
                byMode,
                dispatchMs: pct(dispatchSamples),
                clientLagMs: pct(lagSamples),
            },
            dispatch: inject,
            crash: this.crash,
        }, 'probes.inputPipeline');
        if (this.crash) {
            (0, write_1.writeJsonSync)(this.dossier, 'crash.json', this.crash, 'crash');
        }
    }
    async exportDossier(verdicts = [], wallMs = 0) {
        if (!this.dossier || !this.record)
            return null;
        if (this.record.status !== 'faulted')
            this.record.status = 'stopped';
        const effectiveWallMs = wallMs > 0 ? wallMs : this.sessionWallMs();
        // Auto-validate browse snaps on Stop when any were collected and not yet folded.
        let exportVerdicts = [...verdicts];
        if (this.journal.browseSnaps.length > 0 && !this.journal.browseIso) {
            const validated = await this.validateBrowseSnaps();
            exportVerdicts = [...exportVerdicts, ...validated.verdicts];
        }
        else if (this.journal.browseIso && typeof this.journal.browseIso === 'object') {
            const prior = this.journal.browseIso;
            if (Array.isArray(prior.verdicts) && exportVerdicts.length === 0) {
                exportVerdicts = [...prior.verdicts];
            }
        }
        if (this.crash) {
            exportVerdicts.push({
                id: 'session.crash',
                status: 'fail',
                reason: `${this.crash.errorCode}: ${this.crash.message}`,
            });
        }
        await this.writeBrowseProbes(effectiveWallMs);
        await (0, write_1.writeJson)(this.dossier, 'wire/invariants.json', this.invariantsDossier(), 'wire.invariants');
        await (0, write_1.writeJson)(this.dossier, 'journal/contexts.json', this.contextIndex.toJSON(), 'journal.contexts');
        await (0, write_1.writeJson)(this.dossier, 'journal/acts.json', this.journal.acts, 'journal.acts');
        await (0, write_1.writeJson)(this.dossier, 'journal/timeline.json', this.journal.timeline, 'journal.timeline');
        if (this.journal.injects.length > 0) {
            await (0, write_1.writeJson)(this.dossier, 'journal/injects.json', this.journal.injects, 'journal.injects');
        }
        if (this.journal.intents.length > 0) {
            await (0, write_1.writeJson)(this.dossier, 'journal/intents.json', this.journal.intents, 'journal.intents');
        }
        if (this.journal.iso) {
            await (0, write_1.writeJson)(this.dossier, 'probes/iso.json', this.journal.iso, 'probes.iso');
        }
        if (this.journal.browseIso) {
            await (0, write_1.writeJson)(this.dossier, 'probes/iso-browse.json', this.journal.browseIso, 'probes.isoBrowse');
        }
        if (this.journal.browseSnaps.length > 0) {
            await (0, write_1.writeJson)(this.dossier, 'probes/browse-snaps-index.json', this.journal.browseSnaps.map((s) => ({
                id: s.id,
                label: s.label,
                t: s.t,
                allPass: s.allPass,
            })), 'probes.browseSnapsIndex');
        }
        const { dossierDir } = await (0, write_1.finalizeDossier)(this.dossier, {
            session: this.record,
            verdicts: exportVerdicts,
            meta: {
                wallMs: effectiveWallMs,
                url: this.record.url,
                blueprintId: this.record.blueprintId,
                frameRateHz: this.record.frameRateHz,
                options: {
                    cpuProfiling: this.cpuProfiling,
                    browseSnapCount: this.journal.browseSnaps.length,
                    consoleCount: this.journal.consoleCount,
                    intentCount: this.journal.intents.length,
                    crash: this.crash,
                },
            },
            counts: {
                ...this.eventCounts,
                console: this.journal.consoleCount,
                intent: this.journal.intents.length,
                browseSnap: this.journal.browseSnaps.length,
                intentDropped: this.journal.intents.filter((i) => !i.ok).length,
            },
        });
        return dossierDir;
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        await this.disposeVirtual();
    }
    invariantsDossier() {
        const byContext = {};
        for (const [id, monitor] of this.invariantMonitors) {
            byContext[String(id)] = monitor.getSummary();
        }
        return { root: this.monitorFor(frame_1.CONTEXT_ID_ROOT).getSummary(), byContext };
    }
}
exports.LabChassis = LabChassis;
function acceptClientTelemetry(message) {
    return (0, telemetry_1.isProjectionTelemetryMessage)(message) ? message : null;
}
//# sourceMappingURL=chassis.js.map