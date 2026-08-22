"use strict";
/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaneChannel = exports.NodeDataPlane = void 0;
const plane_1 = require("@speculum/page-projection/core/plane");
Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function () { return plane_1.PlaneChannel; } });
const DEFAULT_WATERMARK = 256 * 1024;
/**
 * Adapts an already-accepted Node WebSocket (server side).
 */
class NodeDataPlane {
    socket = null;
    watermark;
    handler = null;
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
            if (!isBinary || this.handler === null)
                return;
            const buf = Buffer.isBuffer(data)
                ? data
                : Buffer.from(data);
            const env = (0, plane_1.decodePlaneEnvelope)(Uint8Array.from(buf));
            if (env === null)
                return;
            this.handler(env.channel, env.payload);
        });
        socket.on('close', () => {
            if (this.socket === socket)
                this.socket = null;
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
    detach(closeSocket) {
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