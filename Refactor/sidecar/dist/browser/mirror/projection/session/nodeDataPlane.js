"use strict";
/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 * LB-08…19: handshake, canonical socket, symmetric establish.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaneChannel = exports.NodeDataPlane = void 0;
exports.drainInvokeDiagTraces = drainInvokeDiagTraces;
const plane_1 = require("@speculum/page-projection/core/plane");
Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function () { return plane_1.PlaneChannel; } });
const core_1 = require("@speculum/page-projection/core");
const cspDiag_1 = require("./csp/cspDiag");
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
    sessionId = '';
    expectedGeneration = 1;
    state = 'closed';
    lastError;
    shuttingDown = false;
    establishedWaiters = [];
    constructor(opts = {}) {
        this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
    }
    /** TCP OPEN only — do not use as product gate (LB-10). */
    get isOpen() {
        return this.socket?.readyState === 1;
    }
    get isEstablished() {
        return this.state === 'established' && this.isOpen;
    }
    get status() {
        return {
            state: this.state,
            generation: this.expectedGeneration,
            sessionId: this.sessionId,
            lastError: this.lastError,
        };
    }
    setExpectedSession(opts) {
        this.sessionId = opts.sessionId;
        this.expectedGeneration = opts.generation >>> 0;
    }
    waitEstablished(opts) {
        const generation = opts.generation >>> 0;
        if (this.isEstablished && this.expectedGeneration === generation) {
            return Promise.resolve();
        }
        const timeoutMs = opts.timeoutMs ?? core_1.LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.removeEstablishedWaiter(entry);
                reject(Object.assign(new Error('data plane not established'), {
                    errorCode: 'data_plane_not_established',
                    phase: 'establish',
                }));
            }, timeoutMs);
            const entry = { generation, resolve, reject, timer };
            this.establishedWaiters.push(entry);
        });
    }
    attach(socket) {
        this.detach(true, core_1.LOOPBACK_GENERATION_SUPERSEDED_CODE);
        this.state = 'connecting';
        this.socket = socket;
        (0, cspDiag_1.cspDiagLog)('data plane attach', { readyState: socket.readyState, generation: this.expectedGeneration });
        socket.binaryType = 'nodebuffer';
        socket.on('message', (data, isBinary) => {
            if (!isBinary)
                return;
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const bytes = Uint8Array.from(buf);
            const env = (0, core_1.decodeLoopbackEnvelope)(bytes);
            if (env?.kind === 'hello') {
                this.handleHello(socket, env);
                return;
            }
            if (this.state !== 'established') {
                return;
            }
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
            if (this.socket === socket) {
                this.socket = null;
                this.state = 'closed';
                (0, cspDiag_1.cspDiagLog)('data plane socket close');
                this.failAllPending('data plane closed');
                // LB-18: waitEstablished waits for hello-ack or timeout — intermediate closes
                // during doc churn (202→200, content Port reconnect) must not abort the waiter.
                if (this.shuttingDown) {
                    this.failEstablishedWaiters(new Error('data plane closed'));
                }
            }
        });
    }
    open(_url) {
        throw new Error('NodeDataPlane.open: use attach(socket) on the server side');
    }
    close() {
        this.shuttingDown = true;
        this.detach(true);
        this.state = 'closed';
    }
    setHandler(handler) {
        this.handler = handler;
    }
    setInvokeHandler(_handler) {
        // Sidecar does not accept Virtual→sidecar invoke in v0.
    }
    async invoke(name, args = {}, opts) {
        if (!this.isEstablished) {
            return {
                ok: false,
                error: { message: 'data plane not established', name: 'not_established' },
            };
        }
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
        if (!this.isEstablished) {
            return 'deferred';
        }
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
    handleHello(socket, env) {
        const reject = (reason) => {
            try {
                socket.send(Buffer.from((0, core_1.encodeLoopbackHelloReject)(env.sessionId, env.generation, reason)), { binary: true });
            }
            catch {
                /* ignore */
            }
            try {
                socket.close();
            }
            catch {
                /* ignore */
            }
            if (this.socket === socket) {
                this.socket = null;
                this.state = 'failed';
                this.lastError = { code: reason, message: reason };
            }
        };
        if (this.shuttingDown) {
            reject('server_shutting_down');
            return;
        }
        if (!this.sessionId || env.sessionId !== this.sessionId) {
            (0, cspDiag_1.cspDiagLog)('data plane hello reject', {
                reason: 'session_mismatch',
                got: env.sessionId,
                expected: this.sessionId,
            });
            reject('session_mismatch');
            return;
        }
        if (env.generation !== this.expectedGeneration) {
            (0, cspDiag_1.cspDiagLog)('data plane hello reject', {
                reason: 'generation_mismatch',
                got: env.generation,
                expected: this.expectedGeneration,
            });
            reject('generation_mismatch');
            return;
        }
        if (this.state === 'established' && this.socket !== null && this.socket !== socket) {
            reject('already_established');
            return;
        }
        if (env.role !== 'virtual-root') {
            reject('protocol_unsupported');
            return;
        }
        try {
            socket.send(Buffer.from((0, core_1.encodeLoopbackHelloAck)(this.sessionId, this.expectedGeneration)), { binary: true });
        }
        catch {
            reject('protocol_unsupported');
            return;
        }
        this.socket = socket;
        this.state = 'established';
        (0, cspDiag_1.cspDiagLog)('data plane established', {
            sessionId: this.sessionId,
            generation: this.expectedGeneration,
        });
        this.resolveEstablishedWaiters(this.expectedGeneration);
    }
    resolveEstablishedWaiters(generation) {
        const keep = [];
        for (const w of this.establishedWaiters) {
            if (w.generation === generation) {
                clearTimeout(w.timer);
                w.resolve();
            }
            else {
                keep.push(w);
            }
        }
        this.establishedWaiters.length = 0;
        this.establishedWaiters.push(...keep);
    }
    failEstablishedWaiters(err) {
        for (const w of this.establishedWaiters.splice(0)) {
            clearTimeout(w.timer);
            w.reject(err);
        }
    }
    removeEstablishedWaiter(entry) {
        const idx = this.establishedWaiters.indexOf(entry);
        if (idx >= 0)
            this.establishedWaiters.splice(idx, 1);
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
    detach(closeSocket, closeCode) {
        this.failAllPending('data plane detached');
        const socket = this.socket;
        this.socket = null;
        if (closeSocket) {
            this.state = 'closed';
        }
        if (socket === null || !closeSocket)
            return;
        try {
            if (closeCode === core_1.LOOPBACK_GENERATION_SUPERSEDED_CODE) {
                socket.close(core_1.LOOPBACK_GENERATION_SUPERSEDED_CODE, core_1.LOOPBACK_GENERATION_SUPERSEDED_REASON);
            }
            else {
                socket.close();
            }
        }
        catch {
            /* ignore */
        }
    }
}
exports.NodeDataPlane = NodeDataPlane;
//# sourceMappingURL=nodeDataPlane.js.map