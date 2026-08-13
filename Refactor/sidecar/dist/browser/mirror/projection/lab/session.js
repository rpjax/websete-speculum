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
        this.sendJson({ type: 'error', message: `unknown control type: ${String(type)}` });
    }
    async dispose() {
        if (this.closed)
            return;
        this.closed = true;
        await this.stopBrowser();
        this.virtualData.close();
        this.client = null;
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
        if (header !== null) {
            this.stats.lastGeneration = header.generation;
            this.stats.lastSequence = header.sequence;
        }
        const client = this.client;
        if (client !== null && client.readyState === client.OPEN) {
            client.send(buf, { binary: true });
        }
        if (this.stats.framesFromVirtual === 1 || this.stats.framesFromVirtual % 15 === 0) {
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