"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExtensionPlanePerfSmokeUnitTests = runExtensionPlanePerfSmokeUnitTests;
const assert_1 = __importDefault(require("assert"));
const core_1 = require("@speculum/page-projection/core");
const socket_1 = require("@speculum/page-projection/core/loopback/socket");
const loopbackDataPlane_1 = require("@speculum/page-projection/virtual/transport/loopbackDataPlane");
const SESSION = 'perf-loopback';
const GENERATION = 1;
const ROUNDS = 200;
const FRAME = new Uint8Array(16 * 1024); // 16 KiB — typical small frame payload size for smoke
/**
 * Direct mock socket (page-ws analogue) vs hop mock (extension plane: postMessage+Port latency simulated).
 * Design unchanged — only measures hop cost of the sealed tunnel shape.
 */
class DirectMockSocket {
    onSend;
    openL = [];
    messageL = [];
    closeL = [];
    errorL = [];
    _readyState = socket_1.LOOPBACK_SOCKET_CONNECTING;
    binaryType = 'arraybuffer';
    constructor(onSend) {
        this.onSend = onSend;
    }
    get readyState() {
        return this._readyState;
    }
    get bufferedAmount() {
        return 0;
    }
    ensureOpen() {
        if (this._readyState !== socket_1.LOOPBACK_SOCKET_CONNECTING)
            return;
        this._readyState = socket_1.LOOPBACK_SOCKET_OPEN;
        for (const fn of this.openL)
            fn({});
    }
    deliver(bytes) {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        for (const fn of this.messageL)
            fn({ data: ab });
    }
    close() {
        if (this._readyState === socket_1.LOOPBACK_SOCKET_CLOSED)
            return;
        this._readyState = socket_1.LOOPBACK_SOCKET_CLOSED;
        for (const fn of this.closeL)
            fn({});
    }
    send(data) {
        let bytes;
        if (data instanceof ArrayBuffer)
            bytes = new Uint8Array(data);
        else
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.onSend(bytes);
    }
    addEventListener(type, listener) {
        if (type === 'open') {
            this.openL.push(listener);
            this.ensureOpen();
        }
        else if (type === 'message')
            this.messageL.push(listener);
        else if (type === 'close')
            this.closeL.push(listener);
        else if (type === 'error')
            this.errorL.push(listener);
    }
    removeEventListener() {
        /* unused */
    }
}
/** Simulates main→content→bg→content→main microtask hops (4 queueMicrotask). */
class HopMockSocket extends DirectMockSocket {
    send(data) {
        let bytes;
        if (data instanceof ArrayBuffer)
            bytes = new Uint8Array(data);
        else
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        // clone like structured clone over Port
        const copy = bytes.slice();
        queueMicrotask(() => {
            queueMicrotask(() => {
                queueMicrotask(() => {
                    queueMicrotask(() => {
                        this.onSend(copy);
                    });
                });
            });
        });
    }
    deliver(bytes) {
        const copy = bytes.slice();
        queueMicrotask(() => {
            queueMicrotask(() => {
                super.deliver(copy);
            });
        });
    }
}
async function establishWith(create) {
    let sock = null;
    const plane = new loopbackDataPlane_1.LoopbackDataPlane({
        createSocket: () => {
            sock = create((bytes, s) => {
                const env = (0, core_1.decodeLoopbackEnvelope)(bytes);
                if (env?.kind === 'hello') {
                    s.deliver((0, core_1.encodeLoopbackHelloAck)(SESSION, GENERATION));
                }
            });
            return sock;
        },
    });
    const t0 = performance.now();
    plane.open('ws://127.0.0.1:9/');
    await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
    const wallMs = performance.now() - t0;
    assert_1.default.ok(plane.isEstablished);
    return { plane, wallMs };
}
async function runExtensionPlanePerfSmokeUnitTests() {
    const direct = await establishWith((onSend) => {
        const s = new DirectMockSocket((b) => onSend(b, s));
        return s;
    });
    const hop = await establishWith((onSend) => {
        const s = new HopMockSocket((b) => onSend(b, s));
        return s;
    });
    // Frame fan-out: measure send→echo RTT (hello already done — use raw sockets via re-open pattern)
    // Instead: time LOOPBACK encode+decode ROUNDS on both paths through DataPlane send after establish.
    // LoopbackDataPlane.send needs established; echo path isn't full duplex for frames here.
    // Measure: encodeLoopbackHello round-trips ROUNDS on hop vs direct deliver.
    const payload = FRAME;
    let directSum = 0;
    {
        let sock = null;
        sock = new DirectMockSocket((b) => {
            /* absorb */
            void b;
        });
        const t0 = performance.now();
        for (let i = 0; i < ROUNDS; i++) {
            sock.send(payload);
        }
        directSum = performance.now() - t0;
    }
    let hopSum = 0;
    {
        let pending = 0;
        await new Promise((resolve) => {
            const sock = new HopMockSocket((_b) => {
                pending += 1;
                if (pending === ROUNDS)
                    resolve();
            });
            sock.addEventListener('open', () => { });
            const t0 = performance.now();
            for (let i = 0; i < ROUNDS; i++) {
                sock.send(payload);
            }
            // wait for hops to flush
            const check = () => {
                if (pending === ROUNDS) {
                    hopSum = performance.now() - t0;
                    resolve();
                }
                else {
                    queueMicrotask(check);
                }
            };
            check();
        });
    }
    const establishRatio = hop.wallMs / Math.max(direct.wallMs, 0.001);
    const sendRatio = hopSum / Math.max(directSum, 0.001);
    console.log(`[unit] extensionPlane perf smoke: establish direct=${direct.wallMs.toFixed(2)}ms hop=${hop.wallMs.toFixed(2)}ms ratio=${establishRatio.toFixed(2)}x; ` +
        `send ${ROUNDS}×16KiB direct=${directSum.toFixed(2)}ms hop=${hopSum.toFixed(2)}ms ratio=${sendRatio.toFixed(2)}x`);
    // Informational gate: hop establish should complete (not hang). Ratio is logged for tuning — not a hard fail.
    assert_1.default.ok(hop.wallMs < 2_000, 'hop establish must finish promptly');
    assert_1.default.ok(sendRatio < 50, `hop send path unexpectedly pathological (${sendRatio.toFixed(1)}x)`);
    direct.plane.close();
    hop.plane.close();
    void core_1.encodeLoopbackHello;
}
//# sourceMappingURL=extensionPlanePerf.unit.js.map