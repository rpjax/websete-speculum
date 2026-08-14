"use strict";
/**
 * One lab session: client control WS + Virtual Chromium + Virtual data-plane WS.
 * Relays Frame bytes + Telemetry (JSON) Virtual → Client. No .NET / gRPC.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabSession = void 0;
const node_crypto_1 = require("node:crypto");
const plane_1 = require("../plane");
const telemetry_1 = require("../models/telemetry");
const nodeDataPlane_1 = require("./nodeDataPlane");
const virtualBrowser_1 = require("./virtualBrowser");
const cpuProfile_1 = require("./cpuProfile");
const frameInvariantMonitor_1 = require("./frameInvariantMonitor");
const metricsAggregator_1 = require("./metricsAggregator");
const virtualSnapshot_1 = require("./virtualSnapshot");
const structuralDiff_1 = require("./structuralDiff");
const runReport_1 = require("./runReport");
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
    virtualData = new nodeDataPlane_1.NodeDataPlane();
    browser = null;
    closed = false;
    injectTelemetry;
    frameRateHz = 60;
    pendingSnapshot = null;
    activeBenchmark = null;
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
        this.virtualData.setHandler((channel, payload) => {
            if (channel === plane_1.PlaneChannel.Frame) {
                this.onVirtualFrame(Buffer.from(payload));
                return;
            }
            if (channel === plane_1.PlaneChannel.Telemetry) {
                this.onVirtualTelemetry(payload);
                return;
            }
            // Control: reserved.
        });
        this.sendJson({ type: 'hello', sessionId: this.id });
    }
    get virtualDataPath() {
        return `/lab/virtual/${this.id}`;
    }
    /** Lab sink: push telemetry to the client WSS. */
    onProjectionTelemetry(message) {
        this.stats.telemetryMessages += 1;
        this.sendJson({ type: 'telemetry', message });
        this.activeBenchmark?.metrics.observeTelemetry(message);
        this.activeBenchmark?.invariantMonitor?.observeTelemetry(message);
    }
    attachVirtualData(socket) {
        if (this.closed) {
            socket.close();
            return;
        }
        this.virtualData.attach(socket);
        this.sendJson({ type: 'virtualDataOpen' });
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
            await this.start(url.trim(), { relaunch: true });
            return;
        }
        if (type === 'clientTelemetry') {
            const message = msg.message;
            if ((0, telemetry_1.isProjectionTelemetryMessage)(message)) {
                this.onProjectionTelemetry(message);
            }
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
            const options = {
                cpuProfile: optsRaw.cpuProfile !== false,
                invariants: optsRaw.invariants !== false,
                structuralDiff: optsRaw.structuralDiff !== false,
            };
            await this.runBenchmark(url.trim(), durationMs, options);
            return;
        }
        if (type === 'injectRawFrame') {
            // Lab-only test harness hook (frame-protocol-production-completeness Stage 2 gate) —
            // sends caller-supplied bytes to the client verbatim, bypassing Virtual entirely, so a
            // test can hand-craft a deliberately-corrupted frame (wrong preTableHash / bad CHECK) and
            // observe the real client (`client/applyDom.ts`) abort it before touching the DOM. Not
            // part of the wire protocol or any production path — purely drives the already-running
            // client with test-controlled bytes, the same way `requestSnapshot` reads it out.
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
            // Stage 4 (frame-protocol-production-completeness) §5.8 — relays the client's out-of-band
            // resync request onto the Virtual control channel (`PlaneChannel.Control`, reserved since
            // E-03, previously unused). Pure relay: no validation beyond "these are JSON-serializable" —
            // `generation`/`sequence` are diagnostic-only on the Virtual side too (`bootstrap.ts`), never
            // load-bearing for what `emitResyncFrame` actually re-describes.
            const req = msg;
            const payload = JSON.stringify({
                type: 'requestResync',
                reason: typeof req.reason === 'string' ? req.reason : 'unknown',
                generation: typeof req.generation === 'number' ? req.generation : null,
                sequence: typeof req.sequence === 'number' ? req.sequence : null,
            });
            this.virtualData.send(plane_1.PlaneChannel.Control, new TextEncoder().encode(payload));
            return;
        }
        if (type === 'requestStructuralDiff') {
            // Stage 4 test-only entry point: the same virtual-vs-client structural diff
            // `runBenchmark` already performs at the end of a full run (`captureVirtualSnapshot` +
            // `requestClientSnapshot` + `diffTrees`, lab/structuralDiff.ts), available standalone so a
            // smoke test can ask "did the projection actually heal" right after a resync, without
            // spinning up an entire benchmark run just to get one diff.
            if (this.browser === null) {
                this.sendJson({ type: 'structuralDiffResult', status: 'unavailable', reason: 'no virtual browser running' });
                return;
            }
            const virtualTree = await (0, virtualSnapshot_1.captureVirtualSnapshot)(this.browser.page);
            const clientTree = await this.requestClientSnapshot();
            if (clientTree === null) {
                this.sendJson({
                    type: 'structuralDiffResult',
                    status: 'unavailable',
                    reason: 'client did not reply to requestSnapshot within 5000ms',
                });
                return;
            }
            this.sendJson({ type: 'structuralDiffResult', status: 'ok', result: (0, structuralDiff_1.diffTrees)(virtualTree, clientTree) });
            return;
        }
        if (type === 'snapshotResult') {
            const tree = msg.tree;
            const pending = this.pendingSnapshot;
            if (pending !== null) {
                this.pendingSnapshot = null;
                clearTimeout(pending.timer);
                pending.resolve(tree ?? null);
            }
            return;
        }
        this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
    }
    /**
     * Structural diff's client-side half (lab/structuralDiff.ts, component 4) — asks the
     * already-connected lab client to snapshot its surface iframe over the existing control WS,
     * bounded so a client that never answers (closed tab, no client attached) fails the
     * *benchmark step*, not the whole run.
     */
    async requestClientSnapshot(timeoutMs = 5000) {
        if (this.client === null || this.client.readyState !== this.client.OPEN)
            return null;
        if (this.pendingSnapshot !== null)
            return null; // one in flight at a time — benchmark orchestration is serial
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
        this.virtualData.close();
        this.client = null;
        if (this.pendingSnapshot !== null) {
            clearTimeout(this.pendingSnapshot.timer);
            this.pendingSnapshot.resolve(null);
            this.pendingSnapshot = null;
        }
    }
    onVirtualTelemetry(payload) {
        let parsed;
        try {
            parsed = JSON.parse(new TextDecoder().decode(payload));
        }
        catch {
            return;
        }
        if (!(0, telemetry_1.isProjectionTelemetryMessage)(parsed))
            return;
        this.onProjectionTelemetry(parsed);
    }
    async start(url, opts) {
        if (this.browser !== null && !opts?.relaunch) {
            await this.navigate(url);
            return;
        }
        if (this.browser !== null) {
            await this.stopBrowser();
        }
        const dataPlaneUrl = `${this.opts.publicWsOrigin}${this.virtualDataPath}`;
        try {
            this.browser = await (0, virtualBrowser_1.launchVirtualBrowser)({
                dataPlaneUrl,
                startUrl: url,
                headless: this.opts.headless,
                frameRateHz: this.frameRateHz,
                telemetry: this.injectTelemetry ?? { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
            });
            this.sendJson({
                type: 'ready',
                sessionId: this.id,
                url,
                dataPlaneUrl,
            });
        }
        catch (err) {
            this.sendJson({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async navigate(url) {
        if (this.browser === null) {
            await this.start(url, { relaunch: true });
            return;
        }
        try {
            await this.browser.navigate(url);
            this.sendJson({ type: 'navigated', url });
        }
        catch (err) {
            this.sendJson({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Benchmark orchestration (plan component 5): (re)start → start CPU profile + attach the
     * invariant monitor (if enabled) → wait `durationMs` → stop CPU profile → structural
     * snapshot/diff (if enabled) → assemble + write report → reply `benchmarkComplete`. Every
     * step is independently optional per `options` and independently failure-tolerant — a
     * missing client snapshot degrades that one field to `unavailable`, it does not abort the run.
     */
    async runBenchmark(url, durationMs, options) {
        if (this.benchmarkRunning) {
            this.sendJson({ type: 'error', message: 'a benchmark is already running on this session' });
            return;
        }
        this.benchmarkRunning = true;
        this.sendJson({ type: 'benchmarkStarted', url, durationMs, options });
        try {
            await this.start(url, { relaunch: true });
            const browser = this.browser;
            if (browser === null) {
                this.sendJson({ type: 'error', message: 'benchmark: Virtual failed to start' });
                return;
            }
            const metrics = new metricsAggregator_1.MetricsAggregator();
            const invariantMonitor = options.invariants ? new frameInvariantMonitor_1.FrameInvariantMonitor() : null;
            this.activeBenchmark = { metrics, invariantMonitor };
            let cdp = null;
            if (options.cpuProfile) {
                cdp = await browser.cdp();
                await (0, cpuProfile_1.startCpuProfile)(cdp);
            }
            const startedAt = Date.now();
            await new Promise((resolve) => setTimeout(resolve, durationMs));
            const wallMs = Date.now() - startedAt;
            const cpuProfileResult = cdp !== null ? await (0, cpuProfile_1.stopCpuProfile)(cdp, 20) : null;
            let structuralDiff = null;
            if (options.structuralDiff) {
                if (this.browser === null) {
                    structuralDiff = { status: 'unavailable', reason: 'Virtual stopped before the structural snapshot ran' };
                }
                else {
                    const virtualTree = await (0, virtualSnapshot_1.captureVirtualSnapshot)(this.browser.page);
                    const clientTree = await this.requestClientSnapshot(5_000);
                    structuralDiff =
                        clientTree === null
                            ? { status: 'unavailable', reason: 'client did not reply to requestSnapshot within 5000ms' }
                            : { status: 'ok', result: (0, structuralDiff_1.diffTrees)(virtualTree, clientTree) };
                }
            }
            const report = {
                meta: {
                    timestamp: new Date(startedAt).toISOString(),
                    url,
                    requestedDurationMs: durationMs,
                    frameRateHz: this.frameRateHz,
                    options,
                },
                metrics: metrics.getSummary(wallMs),
                cpuProfile: cpuProfileResult ? { summary: cpuProfileResult.summary, profileFile: 'profile.cpuprofile' } : null,
                invariants: invariantMonitor?.getSummary() ?? null,
                structuralDiff,
            };
            const written = await (0, runReport_1.writeRunReport)((0, runReport_1.defaultLabRunsDir)(), report, cpuProfileResult?.raw ?? null);
            this.sendJson({ type: 'benchmarkComplete', report, reportDir: written.reportDir, reportPath: written.reportPath });
        }
        catch (err) {
            this.sendJson({
                type: 'error',
                message: `benchmark failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
        finally {
            this.activeBenchmark = null;
            this.benchmarkRunning = false;
        }
    }
    async stopBrowser() {
        const handle = this.browser;
        this.browser = null;
        if (handle === null)
            return;
        await handle.close();
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
        this.activeBenchmark?.metrics.observeWireBytes(buf.length);
        this.activeBenchmark?.invariantMonitor?.observeFrameBytes(buf);
        // §1.2/§4.1 EPOCH_RESET (Stage 3) must be observable the moment it happens, not only on the
        // periodic every-15th-frame cadence below — a fixture with few/no mutations after a hard
        // navigation (e.g. an establish-only page) could otherwise never accumulate 15 more frames,
        // leaving the lab UI (and this session's own telemetry) reporting the *previous* generation
        // indefinitely (found via the smoke suite's EPOCH_RESET gate, 2026-08-14).
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