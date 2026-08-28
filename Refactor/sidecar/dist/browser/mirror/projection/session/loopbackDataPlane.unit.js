"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoopbackDataPlaneUnitTests = runLoopbackDataPlaneUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = require("ws");
const core_1 = require("@speculum/page-projection/core");
const socket_1 = require("@speculum/page-projection/core/loopback/socket");
const loopbackDataPlane_1 = require("@speculum/page-projection/virtual/transport/loopbackDataPlane");
const SESSION = 'unit-virtual-loopback';
const GENERATION = 1;
/** In-process mock socket for establish handshake tests. */
class MockEstablishSocket {
    url;
    onSend;
    openListeners = [];
    messageListeners = [];
    closeListeners = [];
    errorListeners = [];
    _readyState = socket_1.LOOPBACK_SOCKET_CONNECTING;
    binaryType = 'arraybuffer';
    constructor(url, onSend) {
        this.url = url;
        this.onSend = onSend;
    }
    ensureOpen() {
        if (this._readyState !== socket_1.LOOPBACK_SOCKET_CONNECTING)
            return;
        this._readyState = socket_1.LOOPBACK_SOCKET_OPEN;
        for (const fn of this.openListeners)
            fn({});
    }
    get readyState() {
        return this._readyState;
    }
    get bufferedAmount() {
        return 0;
    }
    deliverMessage(bytes) {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        for (const fn of this.messageListeners)
            fn({ data: ab });
    }
    close() {
        if (this._readyState === socket_1.LOOPBACK_SOCKET_CLOSED)
            return;
        this._readyState = socket_1.LOOPBACK_SOCKET_CLOSED;
        for (const fn of this.closeListeners)
            fn({});
    }
    /** Simulate extension open-ok arriving before whenOpen arms its listener. */
    forceOpenMissedEvent() {
        this._readyState = socket_1.LOOPBACK_SOCKET_OPEN;
        // Deliberately do not notify listeners — event already fired with none armed.
    }
    send(data) {
        if (this._readyState !== socket_1.LOOPBACK_SOCKET_OPEN) {
            throw new Error('mock socket not open');
        }
        let bytes;
        if (data instanceof ArrayBuffer)
            bytes = new Uint8Array(data);
        else
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.onSend(bytes);
    }
    addEventListener(type, listener, options) {
        const list = type === 'open'
            ? this.openListeners
            : type === 'message'
                ? this.messageListeners
                : type === 'close'
                    ? this.closeListeners
                    : type === 'error'
                        ? this.errorListeners
                        : null;
        if (!list)
            return;
        list.push(listener);
        if (type === 'open')
            this.ensureOpen();
        if (options?.once) {
            const wrapped = (ev) => {
                listener(ev);
                const idx = list.indexOf(wrapped);
                if (idx >= 0)
                    list.splice(idx, 1);
            };
            list[list.length - 1] = wrapped;
        }
    }
    removeEventListener(type, listener) {
        const list = type === 'open'
            ? this.openListeners
            : type === 'message'
                ? this.messageListeners
                : type === 'close'
                    ? this.closeListeners
                    : type === 'error'
                        ? this.errorListeners
                        : null;
        if (!list)
            return;
        const idx = list.indexOf(listener);
        if (idx >= 0)
            list.splice(idx, 1);
    }
}
async function withMockServer(run) {
    const httpServer = node_http_1.default.createServer((_req, res) => {
        res.writeHead(404).end();
    });
    const wss = new ws_1.WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (_req, socket, head) => {
        wss.handleUpgrade(_req, socket, head, () => {
            /* mock path does not use real ws server */
        });
    });
    await new Promise((resolve, reject) => {
        httpServer.listen(0, '127.0.0.1', () => resolve());
        httpServer.on('error', reject);
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string')
        throw new Error('no listen port');
    const url = `ws://127.0.0.1:${addr.port}/`;
    const onSend = (socket, bytes) => {
        const env = (0, core_1.decodeLoopbackEnvelope)(bytes);
        if (env?.kind === 'hello') {
            socket.deliverMessage((0, core_1.encodeLoopbackHelloAck)(SESSION, GENERATION));
        }
    };
    try {
        await run(url, onSend);
    }
    finally {
        await new Promise((resolve) => wss.close(() => resolve()));
        await new Promise((resolve, reject) => {
            httpServer.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
async function runLoopbackDataPlaneUnitTests() {
    await withMockServer(async (url, reply) => {
        let lastSocket = null;
        const plane = new loopbackDataPlane_1.LoopbackDataPlane({
            createSocket: (socketUrl) => {
                assert_1.default.strictEqual(socketUrl, url);
                lastSocket = new MockEstablishSocket(socketUrl, (bytes) => {
                    if (lastSocket)
                        reply(lastSocket, bytes);
                });
                return lastSocket;
            },
        });
        plane.open(url);
        await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
        assert_1.default.strictEqual(plane.isEstablished, true);
        assert_1.default.strictEqual(plane.status.sessionId, SESSION);
        assert_1.default.strictEqual(plane.status.generation, GENERATION);
        plane.close();
        assert_1.default.strictEqual(plane.isEstablished, false);
    });
    // Extension plane: open-ok can land after isOpen check and before open listener.
    await withMockServer(async (url, reply) => {
        const holder = { sock: null };
        const plane = new loopbackDataPlane_1.LoopbackDataPlane({
            createSocket: (socketUrl) => {
                holder.sock = new MockEstablishSocket(socketUrl, (bytes) => {
                    if (holder.sock)
                        reply(holder.sock, bytes);
                });
                return holder.sock;
            },
        });
        plane.open(url);
        if (!holder.sock)
            throw new Error('expected mock socket');
        holder.sock.forceOpenMissedEvent();
        await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
        assert_1.default.strictEqual(plane.isEstablished, true);
        plane.close();
    });
    console.log('[unit] loopbackDataPlane mock socket ok');
}
//# sourceMappingURL=loopbackDataPlane.unit.js.map