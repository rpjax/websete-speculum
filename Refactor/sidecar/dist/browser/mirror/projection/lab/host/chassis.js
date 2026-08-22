"use strict";
/**
 * Lab chassis — Virtual lifecycle, sinks, dossier bind. Caller of BrowserSession only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabChassis = exports.CssomOpWindow = void 0;
exports.acceptClientTelemetry = acceptClientTelemetry;
const node_crypto_1 = require("node:crypto");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const V4ProjectionBrowserSession_1 = require("../../session/V4ProjectionBrowserSession");
const v4LabLaunch_1 = require("../../session/v4LabLaunch");
const virtualSnapshot_1 = require("../probes/virtualSnapshot");
const cpuProfile_1 = require("../probes/cpuProfile");
const write_1 = require("../dossier/write");
const frameInvariantMonitor_1 = require("../probes/frameInvariantMonitor");
const metricsAggregator_1 = require("../probes/metricsAggregator");
const nodeTableApply_1 = require("../probes/nodeTableApply");
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
    /** When true, Virtual frames still update collectors but are not sent to the DOM client. */
    suppressVirtualRelay = false;
    journal = { acts: [], snaps: [], opWindows: {}, injects: [], timeline: [] };
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
            onPageProjectionDiff: (diff) => {
                this.observeFrameBytes(Buffer.from(diff.body));
            },
            onPageProjectionTelemetry: (message) => {
                this.observeTelemetry(message);
            },
            onConsole: () => undefined,
            onLocationChanged: () => undefined,
            onMainFrameNavigationBlocked: () => undefined,
            onEditableFocusChanged: () => undefined,
            onCameraPermissionRequested: async () => 'deny',
            onMicrophonePermissionRequested: async () => 'deny',
            onCrash: () => undefined,
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
        this.idlePolls = 0;
        this.resyncPolls = 0;
        this.sheetsAbortedSum = 0;
        this.journal = { acts: [], snaps: [], opWindows: {}, injects: [], timeline: [] };
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
        const factory = (0, V4ProjectionBrowserSession_1.createV4ProjectionBrowserSessionFactory)({
            headless: this.opts.headless,
            probes: {
                captureVirtualSnapshot: virtualSnapshot_1.captureVirtualSnapshot,
                startCpuProfile: cpuProfile_1.startCpuProfile,
                stopCpuProfile: cpuProfile_1.stopCpuProfile,
            },
        });
        this.session = factory.create(sessionId, this.browserEvents());
        await this.session.launch((0, v4LabLaunch_1.v4LabLaunchOptions)({
            frameRateHz: this.frameRateHz,
            projectionTelemetry: this.telemetry,
            cpuProfiling: this.cpuProfiling,
        }));
        await this.session.navigate(opts.url);
        record.url = opts.url;
        record.status = opts.mode === 'run' ? 'running' : 'live';
        await (0, write_1.writeJson)(this.dossier, 'session.json', record, 'session');
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
    async disposeVirtual() {
        if (this.session) {
            await this.session.dispose();
            this.session = null;
        }
        if (this.record) {
            this.record.status = 'stopped';
        }
    }
    async exportDossier(verdicts = [], wallMs = 0) {
        if (!this.dossier || !this.record)
            return null;
        this.record.status = 'stopped';
        await (0, write_1.writeJson)(this.dossier, 'wire/invariants.json', this.invariantsDossier(), 'wire.invariants');
        await (0, write_1.writeJson)(this.dossier, 'journal/contexts.json', this.contextIndex.toJSON(), 'journal.contexts');
        await (0, write_1.writeJson)(this.dossier, 'journal/acts.json', this.journal.acts, 'journal.acts');
        await (0, write_1.writeJson)(this.dossier, 'journal/timeline.json', this.journal.timeline, 'journal.timeline');
        if (this.journal.injects.length > 0) {
            await (0, write_1.writeJson)(this.dossier, 'journal/injects.json', this.journal.injects, 'journal.injects');
        }
        if (this.journal.iso) {
            await (0, write_1.writeJson)(this.dossier, 'probes/iso.json', this.journal.iso, 'probes.iso');
        }
        const { dossierDir } = await (0, write_1.finalizeDossier)(this.dossier, {
            session: this.record,
            verdicts,
            meta: {
                wallMs,
                url: this.record.url,
                blueprintId: this.record.blueprintId,
                frameRateHz: this.record.frameRateHz,
                options: { cpuProfiling: this.cpuProfiling },
            },
            counts: { ...this.eventCounts },
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