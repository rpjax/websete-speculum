"use strict";
/**
 * In-process WebSocket data plane for V4 PageProjection BrowserSession.
 * Chromium LoopbackFrameTransport connects here; lab/UI never attach this socket themselves.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectionDataPlaneHost = void 0;
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = require("ws");
const nodeDataPlane_1 = require("../lab/nodeDataPlane");
const plane_1 = require("../plane");
class ProjectionDataPlaneHost {
    dataPlane = new nodeDataPlane_1.NodeDataPlane();
    httpServer = null;
    wss = null;
    url = '';
    get listenUrl() {
        return this.url;
    }
    async listen() {
        if (this.url)
            return this.url;
        const httpServer = node_http_1.default.createServer((_req, res) => {
            res.writeHead(404).end();
        });
        this.httpServer = httpServer;
        const wss = new ws_1.WebSocketServer({ noServer: true });
        this.wss = wss;
        httpServer.on('upgrade', (req, socket, head) => {
            wss.handleUpgrade(req, socket, head, (ws) => {
                this.dataPlane.attach(ws);
            });
        });
        await new Promise((resolve, reject) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
            httpServer.on('error', reject);
        });
        const addr = httpServer.address();
        if (!addr || typeof addr === 'string')
            throw new Error('ProjectionDataPlaneHost: no listen address');
        this.url = `ws://127.0.0.1:${addr.port}/`;
        return this.url;
    }
    sendControl(message) {
        this.dataPlane.send(plane_1.PlaneChannel.Control, new TextEncoder().encode(JSON.stringify(message)));
    }
    async close() {
        this.dataPlane.close();
        const wss = this.wss;
        this.wss = null;
        if (wss)
            await new Promise((resolve) => wss.close(() => resolve()));
        const httpServer = this.httpServer;
        this.httpServer = null;
        if (httpServer) {
            await new Promise((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
        }
        this.url = '';
    }
}
exports.ProjectionDataPlaneHost = ProjectionDataPlaneHost;
//# sourceMappingURL=projectionDataPlaneHost.js.map