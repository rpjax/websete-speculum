"use strict";
/**
 * One lab session: client control WS + V4 BrowserSession. Relays frames + telemetry. No Chromium here.
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
exports.LabSession = void 0;
const node_crypto_1 = require("node:crypto");
const telemetry_1 = require("../models/telemetry");
const V4ProjectionBrowserSession_1 = require("../session/V4ProjectionBrowserSession");
const v4LabLaunch_1 = require("../session/v4LabLaunch");
const runTools_1 = require("./runTools");
function peekFrameHeader(buf) {
    if (buf.length < 12)
        return null;
    if (buf.readUInt16LE(0) !== 0x5050)
        return null;
    return {
        generation: buf.readUInt32LE(4),
        sequence: buf.readUInt32LE(8),
    };
}
class LabSession {
    id;
    opts;
    client;
    session = null;
    closed = false;
    injectTelemetry;
    frameRateHz = 60;
    pendingSnapshot = null;
    runCollectors = null;
    benchmarkRunning = false;
    stats = {
        framesFromVirtual: 0,
        bytesFromVirtual: 0,
        lastSequence: null,
        lastGeneration: null,
        telemetryMessages: 0,
    };
    constructor(client, opts) {
        this.id = (0, node_crypto_1.randomUUID)();
        this.client = client;
        this.opts = opts;
        this.sendJson({ type: 'hello', sessionId: this.id });
    }
    /** Kept so older smoke that probes the path still compiles; dataplane is owned by BrowserSession. */
    get virtualDataPath() {
        return `/lab/virtual/${this.id}`;
    }
    attachVirtualData(_socket) {
        _socket.close();
    }
    onProjectionTelemetry(message) {
        this.stats.telemetryMessages += 1;
        this.sendJson({ type: 'telemetry', message });
        this.runCollectors?.observeTelemetry(message);
    }
    async handleClientMessage(raw, isBinary) {
        if (isBinary || this.closed)
            return;
        let msg;
        try {
            msg = JSON.parse(String(raw));
        }
        catch {
            this.sendJson({ type: 'error', message: 'invalid JSON control message' });
            return;
        }
        if (typeof msg !== 'object' || msg === null)
            return;
        const type = msg.type;
        if (type === 'start') {
            const start = msg;
            const url = start.url;
            if (typeof url !== 'string' || url.trim().length === 0) {
                this.sendJson({ type: 'error', message: 'start.url required' });
                return;
            }
            if (start.telemetry !== undefined && typeof start.telemetry === 'object' && start.telemetry !== null) {
                this.injectTelemetry = start.telemetry;
            }
            if (typeof start.frameRateHz === 'number' && Number.isFinite(start.frameRateHz) && start.frameRateHz > 0) {
                this.frameRateHz = start.frameRateHz;
            }
            await this.start(url.trim());
            return;
        }
        if (type === 'clientTelemetry') {
            const message = msg.message;
            if ((0, telemetry_1.isProjectionTelemetryMessage)(message))
                this.onProjectionTelemetry(message);
            return;
        }
        if (type === 'navigate') {
            const url = msg.url;
            if (typeof url !== 'string' || url.trim().length === 0) {
                this.sendJson({ type: 'error', message: 'navigate.url required' });
                return;
            }
            await this.navigate(url.trim());
            return;
        }
        if (type === 'stop') {
            await this.stopBrowser();
            this.sendJson({ type: 'stopped' });
            return;
        }
        if (type === 'runBenchmark') {
            const rb = msg;
            const url = rb.url;
            if (typeof url !== 'string' || url.trim().length === 0) {
                this.sendJson({ type: 'error', message: 'runBenchmark.url required' });
                return;
            }
            const durationMs = typeof rb.durationMs === 'number' && Number.isFinite(rb.durationMs) && rb.durationMs > 0
                ? rb.durationMs
                : 15_000;
            if (typeof rb.frameRateHz === 'number' && Number.isFinite(rb.frameRateHz) && rb.frameRateHz > 0) {
                this.frameRateHz = rb.frameRateHz;
            }
            if (rb.telemetry !== undefined && typeof rb.telemetry === 'object' && rb.telemetry !== null) {
                this.injectTelemetry = rb.telemetry;
            }
            const optsRaw = (rb.options ?? {});
            await this.runBenchmark(url.trim(), durationMs, {
                cpuProfile: optsRaw.cpuProfile !== false,
                invariants: optsRaw.invariants !== false,
                structuralDiff: optsRaw.structuralDiff !== false,
                isomorphism: optsRaw.isomorphism === true,
            });
            return;
        }
        if (type === 'injectRawFrame') {
            const bytesBase64 = msg.bytesBase64;
            if (typeof bytesBase64 !== 'string') {
                this.sendJson({ type: 'error', message: 'injectRawFrame.bytesBase64 required' });
                return;
            }
            const client = this.client;
            if (client !== null && client.readyState === client.OPEN) {
                client.send(Buffer.from(bytesBase64, 'base64'), { binary: true });
            }
            return;
        }
        if (type === 'requestResync') {
            const req = msg;
            this.session?.sendPageProjectionControl?.({
                type: 'requestResync',
                reason: typeof req.reason === 'string' ? req.reason : 'unknown',
                generation: typeof req.generation === 'number' ? req.generation : null,
                sequence: typeof req.sequence === 'number' ? req.sequence : null,
            });
            return;
        }
        if (type === 'requestStructuralDiff') {
            if (this.session === null) {
                this.sendJson({ type: 'structuralDiffResult', status: 'unavailable', reason: 'no virtual browser running' });
                return;
            }
            const virtual = await this.session.snapshotProjectionVirtual?.({ includeTree: true });
            const clientSnap = await this.requestClientSnapshot();
            if (clientSnap === null || clientSnap.tree === null) {
                this.sendJson({
                    type: 'structuralDiffResult',
                    status: 'unavailable',
                    reason: 'client did not reply to requestSnapshot within 5000ms',
                });
                return;
            }
            if (!virtual?.ok || virtual.tree == null) {
                this.sendJson({
                    type: 'structuralDiffResult',
                    status: 'unavailable',
                    reason: virtual?.reason ?? 'virtual snapshot failed',
                });
                return;
            }
            const { diffTrees } = await Promise.resolve().then(() => __importStar(require('./structuralDiff')));
            this.sendJson({
                type: 'structuralDiffResult',
                status: 'ok',
                result: diffTrees(virtual.tree, clientSnap.tree),
            });
            return;
        }
        if (type === 'requestTableLiveOracle') {
            if (this.session === null) {
                this.sendJson({ type: 'tableLiveOracleResult', status: 'unavailable', reason: 'no virtual browser running' });
                return;
            }
            const o2 = await this.session.compareProjectionTableToLiveDom?.();
            if (!o2?.ok || !o2.result) {
                this.sendJson({
                    type: 'tableLiveOracleResult',
                    status: 'unavailable',
                    reason: o2?.reason ?? 'O2 probe failed',
                });
                return;
            }
            this.sendJson({ type: 'tableLiveOracleResult', status: 'ok', result: o2.result });
            return;
        }
        if (type === 'snapshotResult') {
            const tree = msg.tree;
            const tableRaw = msg.table;
            const pending = this.pendingSnapshot;
            if (pending !== null) {
                this.pendingSnapshot = null;
                clearTimeout(pending.timer);
                const table = typeof tableRaw === 'object' &&
                    tableRaw !== null &&
                    typeof tableRaw.rowCount === 'number' &&
                    typeof tableRaw.tableHash === 'string'
                    ? tableRaw
                    : null;
                pending.resolve({ tree: tree ?? null, table });
            }
            return;
        }
        this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
    }
    async requestClientSnapshot(timeoutMs = 5000) {
        if (this.client === null || this.client.readyState !== this.client.OPEN)
            return null;
        if (this.pendingSnapshot !== null)
            return null;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingSnapshot = null;
                resolve(null);
            }, timeoutMs);
            this.pendingSnapshot = { resolve, timer };
            this.sendJson({ type: 'requestSnapshot' });
        });
    }
    async dispose() {
        if (this.closed)
            return;
        this.closed = true;
        await this.stopBrowser();
        this.client = null;
        if (this.pendingSnapshot !== null) {
            clearTimeout(this.pendingSnapshot.timer);
            this.pendingSnapshot.resolve(null);
            this.pendingSnapshot = null;
        }
    }
    browserEvents() {
        return {
            onVideoFrame: () => undefined,
            onAudioFrame: () => undefined,
            onPageProjectionDiff: (diff) => {
                this.onVirtualFrame(Buffer.from(diff.body));
            },
            onPageProjectionTelemetry: (message) => {
                this.onProjectionTelemetry(message);
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
    async start(url) {
        await this.stopBrowser();
        const factory = (0, V4ProjectionBrowserSession_1.createV4ProjectionBrowserSessionFactory)({ headless: this.opts.headless });
        const session = factory.create(this.id, this.browserEvents());
        this.session = session;
        try {
            await session.launch((0, v4LabLaunch_1.v4LabLaunchOptions)({
                frameRateHz: this.frameRateHz,
                projectionTelemetry: (this.injectTelemetry ?? { ...telemetry_1.LAB_TELEMETRY_DEFAULTS }),
                cpuProfiling: true,
            }));
            await session.navigate(url);
            this.sendJson({
                type: 'ready',
                sessionId: this.id,
                url,
                dataPlaneUrl: 'session-owned',
            });
        }
        catch (err) {
            await session.dispose();
            this.session = null;
            this.sendJson({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async navigate(url) {
        if (this.session === null) {
            await this.start(url);
            return;
        }
        try {
            await this.session.navigate(url);
            this.sendJson({ type: 'navigated', url });
        }
        catch (err) {
            this.sendJson({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async runBenchmark(url, durationMs, options) {
        if (this.benchmarkRunning) {
            this.sendJson({ type: 'error', message: 'a benchmark is already running on this session' });
            return;
        }
        this.benchmarkRunning = true;
        this.sendJson({ type: 'benchmarkStarted', url, durationMs, options });
        try {
            await this.start(url);
            const session = this.session;
            if (session === null) {
                this.sendJson({ type: 'error', message: 'benchmark: Virtual failed to start' });
                return;
            }
            const collectors = (0, runTools_1.createRunCollectors)();
            this.runCollectors = collectors;
            const result = await (0, runTools_1.executeLabRun)({
                session,
                observeFrameBytes: collectors.observeFrameBytes,
                observeTelemetry: collectors.observeTelemetry,
                requestClientSnapshot: () => this.requestClientSnapshot(5_000),
            }, {
                url,
                durationMs,
                frameRateHz: this.frameRateHz,
                telemetry: (this.injectTelemetry ?? { ...telemetry_1.LAB_TELEMETRY_DEFAULTS }),
                cpuProfile: options.cpuProfile,
                invariants: options.invariants,
                structuralDiff: options.structuralDiff,
                isomorphism: options.isomorphism,
            }, collectors);
            this.sendJson({
                type: 'benchmarkComplete',
                report: result.report,
                reportDir: result.written.reportDir,
                reportPath: result.written.reportPath,
            });
        }
        catch (err) {
            this.sendJson({
                type: 'error',
                message: `benchmark failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
        finally {
            this.runCollectors = null;
            this.benchmarkRunning = false;
        }
    }
    async stopBrowser() {
        const session = this.session;
        this.session = null;
        if (session === null)
            return;
        await session.dispose();
    }
    onVirtualFrame(buf) {
        this.stats.framesFromVirtual += 1;
        this.stats.bytesFromVirtual += buf.length;
        const header = peekFrameHeader(buf);
        const priorGeneration = this.stats.lastGeneration;
        if (header !== null) {
            this.stats.lastGeneration = header.generation;
            this.stats.lastSequence = header.sequence;
        }
        const client = this.client;
        if (client !== null && client.readyState === client.OPEN) {
            client.send(buf, { binary: true });
        }
        this.runCollectors?.observeFrameBytes(buf);
        const generationChanged = header !== null && this.stats.lastGeneration !== priorGeneration;
        if (this.stats.framesFromVirtual === 1 || this.stats.framesFromVirtual % 15 === 0 || generationChanged) {
            this.sendJson({
                type: 'stats',
                frames: this.stats.framesFromVirtual,
                bytes: this.stats.bytesFromVirtual,
                generation: this.stats.lastGeneration,
                sequence: this.stats.lastSequence,
                telemetryMessages: this.stats.telemetryMessages,
            });
        }
    }
    sendJson(payload) {
        const client = this.client;
        if (client === null || client.readyState !== client.OPEN)
            return;
        client.send(JSON.stringify(payload));
    }
}
exports.LabSession = LabSession;
//# sourceMappingURL=session.js.map