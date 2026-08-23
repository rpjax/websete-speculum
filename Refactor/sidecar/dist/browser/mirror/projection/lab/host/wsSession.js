"use strict";
/**
 * Lab WS connection — Browse + Run over protocol v1.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportExitCode = exports.listLabBlueprintSummaries = exports.listLabBlueprints = exports.WsLabConnection = void 0;
exports.labFixturesManifestPath = labFixturesManifestPath;
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const chassis_1 = require("./chassis");
const protocol_1 = require("./protocol");
const loadBlueprint_1 = require("../runner/loadBlueprint");
const execute_1 = require("../runner/execute");
const assetRoots_1 = require("../assetRoots");
const types_1 = require("../dossier/types");
Object.defineProperty(exports, "reportExitCode", { enumerable: true, get: function () { return types_1.reportExitCode; } });
class WsLabConnection {
    id;
    client;
    opts;
    chassis;
    closed = false;
    runInFlight = false;
    debugProbeTimer = null;
    pendingSnapshot = null;
    pendingTamper = null;
    pendingInject = null;
    constructor(client, opts) {
        this.opts = opts;
        this.chassis = new chassis_1.LabChassis({ headless: opts.headless });
        this.id = this.chassis.connectionId;
        this.client = client;
        this.bindChassisRelays(this.chassis);
        this.send({ type: 'session.hello', sessionId: this.id, protocolVersion: protocol_1.LAB_PROTOCOL_VERSION });
    }
    bindChassisRelays(chassis) {
        chassis.setFrameRelay((buf) => {
            const c = this.client;
            if (c !== null && c.readyState === c.OPEN)
                c.send(buf, { binary: true });
        });
        chassis.setTelemetryRelay((message) => this.send({ type: 'telemetry', message }));
        chassis.setConsoleRelay((ev) => {
            this.send({ type: 'console', level: ev.level, text: ev.text, t: ev.t });
        });
        chassis.setFaultRelay((fault) => {
            this.send({
                type: 'session.fault',
                sessionId: chassis.sessionId ?? this.id,
                message: fault.message,
                errorCode: fault.errorCode,
                phase: fault.phase,
                dossierDir: chassis.dossierHandle?.dir,
            });
            // Persist full browse probes on crash without requiring Stop.
            if (fault.source !== 'process') {
                this.stopDebugProbe();
                void (async () => {
                    const sid = chassis.sessionId ?? this.id;
                    const dossierDir = (await chassis.exportDossier([], chassis.sessionWallMs())) ?? undefined;
                    await chassis.disposeVirtual();
                    this.send({
                        type: 'session.stopped',
                        sessionId: sid,
                        reason: `crash:${fault.errorCode}`,
                        dossierDir,
                    });
                })();
            }
        });
        chassis.setDebugRelay((payload) => {
            this.send({ type: 'debug.probe', payload });
        });
        chassis.setClientSnapshotProvider((contextId) => this.requestClientSnapshot(contextId));
    }
    startDebugProbe() {
        this.stopDebugProbe();
        this.debugProbeTimer = setInterval(() => {
            if (this.closed)
                return;
            this.chassis.pushDebugProbe();
        }, 2000);
    }
    stopDebugProbe() {
        if (this.debugProbeTimer) {
            clearInterval(this.debugProbeTimer);
            this.debugProbeTimer = null;
        }
    }
    send(msg) {
        const c = this.client;
        if (c === null || c.readyState !== c.OPEN)
            return;
        c.send(JSON.stringify(msg));
    }
    resolveUrl(raw) {
        if (/^https?:\/\//i.test(raw))
            return raw;
        const path = raw.replace(/^\/+/, '');
        const rel = path.startsWith('fixtures/') ? path : `fixtures/${path}`;
        return `${this.opts.publicOrigin}/${rel}`;
    }
    async requestClientSnapshot(contextId, timeoutMs = 5000) {
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
            this.send({ type: 'requestSnapshot', contextId });
        });
    }
    async requestTamper(timeoutMs = 2000) {
        if (this.client === null || this.client.readyState !== this.client.OPEN)
            return null;
        if (this.pendingTamper !== null)
            return null;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingTamper = null;
                resolve(null);
            }, timeoutMs);
            this.pendingTamper = { resolve, timer };
            this.send({ type: 'lab.tamper', kind: 'ghostRule' });
        });
    }
    async injectClientFrame(bytes, timeoutMs = 2000) {
        if (this.client === null || this.client.readyState !== this.client.OPEN)
            return null;
        if (this.pendingInject !== null)
            return null;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingInject = null;
                resolve(null);
            }, timeoutMs);
            this.pendingInject = { resolve, timer };
            this.send({ type: 'lab.injectFrame', bytes: Buffer.from(bytes).toString('base64') });
        });
    }
    async handleClientMessage(raw, isBinary) {
        if (isBinary || this.closed)
            return;
        let parsed;
        try {
            parsed = JSON.parse(String(raw));
        }
        catch {
            this.send({ type: 'error', message: 'invalid JSON control message', code: 'invalid_json' });
            return;
        }
        const msg = (0, protocol_1.parseClientMessage)(parsed);
        if ('error' in msg) {
            this.send({ type: 'error', message: msg.error, code: msg.code });
            return;
        }
        switch (msg.type) {
            case 'hello':
                if (msg.protocolVersion !== undefined && msg.protocolVersion !== protocol_1.LAB_PROTOCOL_VERSION) {
                    this.send({ type: 'error', message: 'protocol version mismatch', code: 'protocol_mismatch' });
                }
                return;
            case 'browse.start': {
                if (typeof msg.url !== 'string' || !msg.url.trim()) {
                    this.send({ type: 'error', message: 'browse.start.url required', code: 'bad_request' });
                    return;
                }
                try {
                    await this.chassis.disposeVirtual();
                    const record = await this.chassis.boot({
                        mode: 'browse',
                        url: this.resolveUrl(msg.url.trim()),
                        frameRateHz: msg.frameRateHz,
                        telemetry: msg.telemetry ?? telemetry_1.LAB_TELEMETRY_DEFAULTS,
                        cpuProfiling: msg.cpuProfiling === true,
                        width: typeof msg.width === 'number' ? msg.width : undefined,
                        height: typeof msg.height === 'number' ? msg.height : undefined,
                        device: msg.device,
                    });
                    this.startDebugProbe();
                    this.send({
                        type: 'session.booted',
                        sessionId: record.sessionId,
                        mode: 'browse',
                        url: record.url ?? msg.url,
                        dossierDir: record.dossierDir,
                    });
                }
                catch (err) {
                    this.stopDebugProbe();
                    this.send({
                        type: 'session.fault',
                        sessionId: this.chassis.sessionId ?? this.id,
                        message: err instanceof Error ? err.message : String(err),
                        errorCode: 'browse_boot_failed',
                        phase: 'boot',
                        dossierDir: this.chassis.dossierHandle?.dir,
                    });
                }
                return;
            }
            case 'browse.navigate': {
                if (typeof msg.url !== 'string' || !msg.url.trim()) {
                    this.send({ type: 'error', message: 'browse.navigate.url required', code: 'bad_request' });
                    return;
                }
                try {
                    await this.chassis.navigate(this.resolveUrl(msg.url.trim()));
                }
                catch (err) {
                    this.send({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                        code: 'navigate_failed',
                    });
                }
                return;
            }
            case 'browse.stop': {
                const sid = this.chassis.sessionId ?? this.id;
                let dossierDir;
                this.stopDebugProbe();
                const wallMs = this.chassis.sessionWallMs();
                // Close Virtual first so a hung browse snap / CDP evaluate cannot block Stop.
                // Stored snaps validate from journal (no live dump). Export writes files after close.
                if (msg.exportDossier && this.chassis.browseSnapCount > 0) {
                    try {
                        const validated = await this.chassis.validateBrowseSnaps();
                        this.send({
                            type: 'validate.result',
                            allPass: validated.allPass,
                            snapCount: validated.snapCount,
                            pass: validated.pass,
                            fail: validated.fail,
                            skipped: validated.skipped,
                        });
                    }
                    catch (err) {
                        this.send({
                            type: 'error',
                            message: err instanceof Error ? err.message : String(err),
                            code: 'validate_failed',
                        });
                    }
                }
                await this.chassis.disposeVirtual();
                if (msg.exportDossier) {
                    dossierDir = (await this.chassis.exportDossier([], wallMs)) ?? undefined;
                }
                this.send({ type: 'session.stopped', sessionId: sid, reason: 'browse.stop', dossierDir });
                return;
            }
            case 'surface.clear':
                // Client clears locally; ack not required
                return;
            case 'run.start': {
                if (this.runInFlight) {
                    this.send({ type: 'error', message: 'a run is already in flight', code: 'run_busy' });
                    return;
                }
                this.runInFlight = true;
                try {
                    const priorSessionId = this.chassis.sessionId ?? this.id;
                    await this.chassis.disposeVirtual();
                    this.send({
                        type: 'session.stopped',
                        sessionId: priorSessionId,
                        reason: 'runColdBoot',
                    });
                    // fresh chassis for cold run
                    this.stopDebugProbe();
                    this.chassis = new chassis_1.LabChassis({ headless: this.opts.headless });
                    this.bindChassisRelays(this.chassis);
                    const bp = (0, loadBlueprint_1.loadBlueprint)(msg.blueprintId);
                    const overrides = (msg.overrides ?? {});
                    const result = await (0, execute_1.executeBlueprint)(bp, {
                        chassis: this.chassis,
                        resolveUrl: (u) => this.resolveUrl(u),
                        requestClientSnapshot: (contextId) => this.requestClientSnapshot(contextId),
                        requestTamper: () => this.requestTamper(),
                        injectClientFrame: (bytes) => this.injectClientFrame(bytes),
                        overrides,
                        onProgress: (p) => {
                            this.send({
                                type: 'run.progress',
                                sessionId: this.chassis.sessionId ?? this.id,
                                actionId: p.actionId,
                                queue: p.queue,
                                status: p.status,
                                detail: p.detail,
                            });
                        },
                    });
                    const summary = {
                        pass: result.verdicts.filter((v) => v.status === 'pass').length,
                        fail: result.verdicts.filter((v) => v.status === 'fail').length,
                        skipped: result.verdicts.filter((v) => v.status === 'skipped').length,
                    };
                    this.send({
                        type: 'run.complete',
                        sessionId: this.chassis.sessionId ?? this.id,
                        dossierDir: result.dossierDir ?? '',
                        verdictsSummary: summary,
                    });
                    await this.chassis.disposeVirtual();
                    this.send({
                        type: 'session.stopped',
                        sessionId: this.chassis.sessionId ?? this.id,
                        reason: 'runComplete',
                        dossierDir: result.dossierDir ?? undefined,
                    });
                }
                catch (err) {
                    this.send({
                        type: 'session.fault',
                        sessionId: this.chassis.sessionId ?? this.id,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                finally {
                    this.runInFlight = false;
                }
                return;
            }
            case 'run.abort':
                this.send({ type: 'error', message: 'run.abort not implemented', code: 'not_implemented' });
                return;
            case 'client.telemetry': {
                const m = (0, chassis_1.acceptClientTelemetry)(msg.message);
                if (m)
                    this.chassis.observeTelemetry(m);
                return;
            }
            case 'client.requestResync': {
                void this.chassis.browser?.requestResync?.({
                    reason: typeof msg.reason === 'string' ? msg.reason : 'client',
                    contextId: typeof msg.contextId === 'number' && msg.contextId > 0 ? msg.contextId : 1,
                });
                return;
            }
            case 'client.intent': {
                const session = this.chassis.browser;
                const push = session?.pushInput?.bind(session);
                if (!push) {
                    this.send({ type: 'error', message: 'pushInput unavailable', code: 'input_unavailable' });
                    return;
                }
                const intentRaw = msg.intent;
                if (!intentRaw || typeof intentRaw !== 'object') {
                    this.send({ type: 'error', message: 'client.intent missing intent', code: 'invalid_intent' });
                    return;
                }
                const intent = intentRaw;
                try {
                    const out = await push(intent);
                    if (out
                        && typeof out === 'object'
                        && out.status === 'dropped') {
                        const reason = out.reason ?? 'dropped';
                        await this.chassis.journalIntent(intent, { ok: false, error: reason });
                        this.send({
                            type: 'error',
                            message: `intent dropped: ${reason}`,
                            code: 'input_dropped',
                        });
                        return;
                    }
                    await this.chassis.journalIntent(intent, { ok: true });
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    await this.chassis.journalIntent(intent, { ok: false, error: message });
                    this.send({
                        type: 'error',
                        message,
                        code: 'input_dispatch_failed',
                    });
                }
                return;
            }
            case 'client.snapshot': {
                try {
                    const record = await this.chassis.captureBrowseSnap(typeof msg.label === 'string' ? msg.label : undefined);
                    this.send({
                        type: 'snap.stored',
                        id: record.id,
                        sequence: record.iso?.sequence ?? null,
                        generation: record.iso?.generation ?? null,
                        allPass: record.allPass,
                        label: record.label,
                        snapCount: this.chassis.browseSnapCount,
                    });
                }
                catch (err) {
                    this.send({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                        code: 'snapshot_failed',
                    });
                }
                return;
            }
            case 'client.validateSnaps': {
                try {
                    const validated = await this.chassis.validateBrowseSnaps();
                    this.send({
                        type: 'validate.result',
                        allPass: validated.allPass,
                        snapCount: validated.snapCount,
                        pass: validated.pass,
                        fail: validated.fail,
                        skipped: validated.skipped,
                        dossierPath: this.chassis.dossierHandle?.dir,
                    });
                }
                catch (err) {
                    this.send({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                        code: 'validate_failed',
                    });
                }
                return;
            }
            case 'client.snapshotResult': {
                const pending = this.pendingSnapshot;
                if (pending !== null) {
                    this.pendingSnapshot = null;
                    clearTimeout(pending.timer);
                    const tableRaw = msg.table;
                    const table = typeof tableRaw === 'object' &&
                        tableRaw !== null &&
                        typeof tableRaw.rowCount === 'number' &&
                        typeof tableRaw.tableHash === 'string'
                        ? tableRaw
                        : null;
                    pending.resolve({
                        contextId: typeof msg.contextId === 'number' ? msg.contextId : 1,
                        tree: msg.tree ?? null,
                        table,
                        sequence: msg.sequence ?? null,
                        generation: typeof msg.generation === 'number' ? msg.generation : null,
                        desynced: msg.desynced === true,
                        applyError: typeof msg.applyError === 'string' ? msg.applyError : null,
                        armed: msg.armed === true,
                        resyncInFlight: msg.resyncInFlight === true,
                        cascade: typeof msg.cascade === 'object' && msg.cascade !== null
                            ? msg.cascade
                            : null,
                        formProps: Array.isArray(msg.formProps)
                            ? msg.formProps
                            : null,
                    });
                }
                return;
            }
            case 'client.tamperResult': {
                const pending = this.pendingTamper;
                if (pending !== null) {
                    this.pendingTamper = null;
                    clearTimeout(pending.timer);
                    pending.resolve({
                        ok: msg.ok === true,
                        reason: typeof msg.reason === 'string' ? msg.reason : undefined,
                    });
                }
                return;
            }
            case 'client.injectResult': {
                const pending = this.pendingInject;
                if (pending !== null) {
                    this.pendingInject = null;
                    clearTimeout(pending.timer);
                    pending.resolve({
                        sequence: typeof msg.sequence === 'number' ? msg.sequence : null,
                        generation: typeof msg.generation === 'number' ? msg.generation : null,
                        desynced: msg.desynced === true,
                        applyError: typeof msg.applyError === 'string' ? msg.applyError : null,
                        tableHash: typeof msg.tableHash === 'string' ? msg.tableHash : null,
                    });
                }
                return;
            }
            case 'client.resize': {
                if (typeof msg.width !== 'number' || typeof msg.height !== 'number') {
                    this.send({
                        type: 'session.resized',
                        applied: false,
                        width: 0,
                        height: 0,
                        errorCode: 'bad_request',
                        message: 'client.resize width/height required',
                    });
                    return;
                }
                try {
                    const result = await this.chassis.resize({
                        width: msg.width,
                        height: msg.height,
                        device: msg.device,
                    });
                    this.send({
                        type: 'session.resized',
                        applied: result.ok,
                        width: result.width,
                        height: result.height,
                        errorCode: result.errorCode,
                        message: result.message,
                    });
                }
                catch (err) {
                    this.send({
                        type: 'session.resized',
                        applied: false,
                        width: msg.width,
                        height: msg.height,
                        errorCode: 'resize_failed',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                return;
            }
            default:
                this.send({ type: 'error', message: 'unhandled type', code: 'unknown_type' });
        }
    }
    async dispose() {
        if (this.closed)
            return;
        this.closed = true;
        this.stopDebugProbe();
        if (this.pendingSnapshot) {
            clearTimeout(this.pendingSnapshot.timer);
            this.pendingSnapshot.resolve(null);
            this.pendingSnapshot = null;
        }
        if (this.pendingTamper) {
            clearTimeout(this.pendingTamper.timer);
            this.pendingTamper.resolve(null);
            this.pendingTamper = null;
        }
        if (this.pendingInject) {
            clearTimeout(this.pendingInject.timer);
            this.pendingInject.resolve(null);
            this.pendingInject = null;
        }
        await this.chassis.dispose();
        this.client = null;
    }
}
exports.WsLabConnection = WsLabConnection;
var loadBlueprint_2 = require("../runner/loadBlueprint");
Object.defineProperty(exports, "listLabBlueprints", { enumerable: true, get: function () { return loadBlueprint_2.listBlueprintIds; } });
Object.defineProperty(exports, "listLabBlueprintSummaries", { enumerable: true, get: function () { return loadBlueprint_2.listBlueprintSummaries; } });
function labFixturesManifestPath() {
    const { fixturesDir } = (0, assetRoots_1.labAssetRoots)();
    return `${fixturesDir.replace(/\\/g, '/')}/manifest.json`;
}
//# sourceMappingURL=wsSession.js.map