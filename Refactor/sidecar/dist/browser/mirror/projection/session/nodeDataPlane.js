"use strict";
/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaneChannel = exports.NodeDataPlane = void 0;
exports.drainInvokeDiagTraces = drainInvokeDiagTraces;
const plane_1 = require("@speculum/page-projection/core/plane");
Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function () { return plane_1.PlaneChannel; } });
const core_1 = require("@speculum/page-projection/core");
const DEFAULT_WATERMARK = 256 * 1024;
const DIAG = process.env.SPECULUM_DIAG_LOOPBACK === '1';
const diagTraces = [];
function drainInvokeDiagTraces() {
    return diagTraces.splice(0, diagTraces.length);
}
/**
 * Adapts an already-accepted Node WebSocket (server side).
 */
class NodeDataPlane {
    socket = null;
    watermark;
    handler = null;
    nextCorrelationId = 1;
    pending = new Map();
    constructor(opts = {}) {
        this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
    }
    get isOpen() {
        return this.socket?.readyState === 1; // OPEN
    }
    /** Attach a server-accepted socket (replaces any previous). */
    attach(socket) {
        this.detach(false);
        this.socket = socket;
        socket.binaryType = 'nodebuffer';
        socket.on('message', (data, isBinary) => {
            if (!isBinary)
                return;
            const buf = Buffer.isBuffer(data)
                ? data
                : Buffer.from(data);
            const bytes = Uint8Array.from(buf);
            const env = (0, core_1.decodeLoopbackEnvelope)(bytes);
            if (env?.kind === 'invoke-started' || env?.kind === 'invoke-heartbeat') {
                const pending = this.pending.get(env.correlationId);
                if (pending) {
                    if (env.kind === 'invoke-started')
                        pending.started = true;
                    if (env.kind === 'invoke-heartbeat')
                        pending.heartbeats += 1;
                }
                this.resetPendingTimer(env.correlationId);
                return;
            }
            if (env?.kind === 'invoke-result') {
                const pending = this.pending.get(env.correlationId);
                if (!pending)
                    return;
                this.pending.delete(env.correlationId);
                clearTimeout(pending.timer);
                const result = {
                    ok: env.ok,
                    value: env.value,
                    error: env.error,
                };
                this.recordDiag(pending, env.correlationId, result);
                pending.resolve(result);
                return;
            }
            if (this.handler === null)
                return;
            const mapped = (0, core_1.decodeLoopbackToPlane)(bytes);
            if (mapped === null)
                return;
            this.handler(mapped.channel, mapped.payload);
        });
        socket.on('close', () => {
            if (this.socket === socket)
                this.socket = null;
            this.failAllPending('data plane closed');
        });
    }
    open(_url) {
        throw new Error('NodeDataPlane.open: use attach(socket) on the server side');
    }
    close() {
        this.detach(true);
    }
    setHandler(handler) {
        this.handler = handler;
    }
    setInvokeHandler(_handler) {
        // Sidecar does not accept Virtual→sidecar invoke in v0.
    }
    async invoke(name, args = {}, opts) {
        const socket = this.socket;
        if (socket === null || socket.readyState !== 1) {
            return { ok: false, error: { message: 'data plane not open', name: 'not_open' } };
        }
        if (socket.bufferedAmount > this.watermark) {
            return { ok: false, error: { message: 'data plane deferred', name: 'deferred' } };
        }
        const correlationId = this.nextCorrelationId >>> 0;
        this.nextCorrelationId = (this.nextCorrelationId + 1) >>> 0;
        if (this.nextCorrelationId === 0)
            this.nextCorrelationId = 1;
        const timeoutMs = opts?.timeoutMs ?? core_1.LOOPBACK_INVOKE_IDLE_MS;
        const resultPromise = new Promise((resolve) => {
            const timer = setTimeout(() => {
                const pending = this.pending.get(correlationId);
                this.pending.delete(correlationId);
                const result = {
                    ok: false,
                    error: { message: `invoke idle timeout (${timeoutMs}ms)`, name: 'timeout' },
                };
                if (pending)
                    this.recordDiag(pending, correlationId, result);
                resolve(result);
            }, timeoutMs);
            this.pending.set(correlationId, {
                resolve,
                timer,
                timeoutMs,
                name,
                t0: performance.now(),
                started: false,
                heartbeats: 0,
            });
        });
        try {
            socket.send(Buffer.from((0, core_1.encodeLoopbackInvoke)(correlationId, name, args)), { binary: true });
        }
        catch (err) {
            const pending = this.pending.get(correlationId);
            if (pending) {
                this.pending.delete(correlationId);
                clearTimeout(pending.timer);
            }
            return {
                ok: false,
                error: {
                    message: err instanceof Error ? err.message : String(err),
                    name: 'send_failed',
                },
            };
        }
        return resultPromise;
    }
    send(channel, payload) {
        const socket = this.socket;
        if (socket === null || socket.readyState !== 1) {
            return 'deferred';
        }
        if (socket.bufferedAmount > this.watermark) {
            return 'deferred';
        }
        socket.send(Buffer.from((0, plane_1.encodePlaneEnvelope)(channel, payload)), { binary: true });
        return 'accepted';
    }
    recordDiag(pending, correlationId, result) {
        if (!DIAG)
            return;
        diagTraces.push({
            name: pending.name,
            correlationId,
            wallMs: performance.now() - pending.t0,
            timeoutMs: pending.timeoutMs,
            started: pending.started,
            heartbeats: pending.heartbeats,
            ok: result.ok,
            errorMessage: result.error?.message,
            errorName: result.error?.name,
        });
    }
    resetPendingTimer(correlationId) {
        const pending = this.pending.get(correlationId);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => {
            this.pending.delete(correlationId);
            const result = {
                ok: false,
                error: {
                    message: `invoke idle timeout (${pending.timeoutMs}ms)`,
                    name: 'timeout',
                },
            };
            this.recordDiag(pending, correlationId, result);
            pending.resolve(result);
        }, pending.timeoutMs);
    }
    failAllPending(message) {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            const result = { ok: false, error: { message, name: 'closed' } };
            this.recordDiag(pending, id, result);
            pending.resolve(result);
            this.pending.delete(id);
        }
    }
    detach(closeSocket) {
        this.failAllPending('data plane detached');
        const socket = this.socket;
        this.socket = null;
        if (socket === null || !closeSocket)
            return;
        try {
            socket.close();
        }
        catch {
            // ignore
        }
    }
}
exports.NodeDataPlane = NodeDataPlane;
//# sourceMappingURL=nodeDataPlane.js.map