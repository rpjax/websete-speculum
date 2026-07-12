"use strict";
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
const http = __importStar(require("http"));
const ws_1 = require("ws");
const DisplayManager_1 = require("./DisplayManager");
const Session_1 = require("./Session");
const Protocol_1 = require("./Protocol");
const PORT = parseInt(process.env['SIDECAR_PORT'] ?? '3000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[sidecar] Invalid SIDECAR_PORT: ${process.env['SIDECAR_PORT']}`);
    process.exit(1);
}
let nextDisplay = 100;
const activeSessions = new Set();
const POINTER_TYPES = new Set(['mousemove', 'mousedown', 'mouseup', 'wheel']);
const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(404);
    res.end();
});
const wss = new ws_1.WebSocketServer({ server: httpServer });
wss.on('connection', (ws) => {
    let session;
    ws.on('message', async (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = (0, Protocol_1.decodeMessage)(text);
        if (!msg)
            return;
        if (msg.type === 'create') {
            const { sessionId, width, height, url, scripts = [], jsBridgeEnabled = false, allowedNavigationDomains, browserState, } = msg;
            if (session) {
                console.warn(`[${sessionId}] Duplicate create on existing session — rejecting`);
                ws.send(JSON.stringify({
                    type: 'error',
                    sessionId,
                    message: 'A session already exists on this connection.',
                }));
                return;
            }
            const displayNum = nextDisplay++;
            console.log(`[${sessionId}] Creating session on display :${displayNum}`);
            let display;
            try {
                display = await DisplayManager_1.DisplayManager.start(displayNum, width, height);
                session = await Session_1.Session.create(sessionId, ws, display, width, height, url, scripts, jsBridgeEnabled, allowedNavigationDomains, browserState);
                activeSessions.add(session);
                ws.send(JSON.stringify({ type: 'ready', sessionId }));
            }
            catch (err) {
                const message = err.message;
                console.error(`[${sessionId}] Failed to create session:`, message);
                if (display) {
                    display.dispose().catch(dispErr => console.warn(`[${sessionId}] Display dispose after create failure:`, dispErr.message));
                }
                ws.send(JSON.stringify({ type: 'error', sessionId, message }));
                ws.close();
            }
            return;
        }
        if (msg.type === 'exportState') {
            if (!session)
                return;
            try {
                const state = await session.captureState();
                ws.send(JSON.stringify({ type: 'stateExport', state }));
            }
            catch (err) {
                const message = err.message;
                console.warn(`[${session?.sessionId}] State export failed:`, message);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'stateExportError', message }));
                }
            }
            return;
        }
        if (session) {
            if (POINTER_TYPES.has(msg.type)) {
                session.handleMessage(text).catch(err => console.warn(`[${session.sessionId}] Input error:`, err.message));
                return;
            }
            await session.handleMessage(text);
        }
    });
    ws.on('close', () => {
        if (!session)
            return;
        const s = session;
        session = undefined;
        activeSessions.delete(s);
        s.dispose().catch(err => console.warn('[sidecar] Session dispose error:', err.message));
    });
    ws.on('error', (err) => {
        console.error('[sidecar] WS error:', err.message);
    });
});
httpServer.listen(PORT, () => {
    console.log(`[sidecar] Listening on port ${PORT} (HTTP health + WS)`);
});
httpServer.on('error', (err) => {
    console.error('[sidecar] HTTP server error:', err.message);
    process.exit(1);
});
async function shutdown(signal) {
    console.log(`[sidecar] ${signal} received — shutting down`);
    wss.close();
    httpServer.close();
    const disposeAll = [...activeSessions].map(s => s.dispose().catch(err => console.warn('[sidecar] Session dispose error:', err.message)));
    await Promise.all(disposeAll);
    activeSessions.clear();
    console.log('[sidecar] Shutdown complete');
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
