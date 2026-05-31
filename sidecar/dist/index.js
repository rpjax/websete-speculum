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
/**
 * Sidecar entry point.
 *
 * Exposes two servers on the same port:
 *   HTTP GET /health  — Docker/Compose healthcheck (200 OK)
 *   WebSocket /       — one connection per browser session
 *
 * Protocol (per WS connection):
 *   1. .NET sends { type: "create", sessionId, width, height, url? }
 *   2. Sidecar starts Xvfb + Chrome + FFmpeg, replies { type: "ready", sessionId }
 *   3. Sidecar streams binary frame messages (full / skip)
 *   4. .NET sends JSON input/control messages
 *   5. WS close → session disposed
 */
const PORT = parseInt(process.env['SIDECAR_PORT'] ?? '3000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[sidecar] Invalid SIDECAR_PORT: ${process.env['SIDECAR_PORT']}`);
    process.exit(1);
}
// Monotonically incremented display numbers. Starting at 100 avoids :0 (host
// desktop), :1 and common test/CI displays.
let nextDisplay = 100;
// Active sessions — tracked for graceful shutdown.
const activeSessions = new Set();
// ── HTTP server (shared with WebSocket) ───────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(404);
    res.end();
});
// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new ws_1.WebSocketServer({ server: httpServer });
wss.on('connection', (ws) => {
    let session;
    ws.on('message', async (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = (0, Protocol_1.decodeMessage)(text);
        if (!msg)
            return;
        // ── Session creation ──────────────────────────────────────────────────
        if (msg.type === 'create') {
            const { sessionId, width, height, url, scripts = [], jsBridgeEnabled = false } = msg;
            if (session) {
                // A second "create" on the same connection is a protocol error.
                // Notify the caller so it does not hang waiting for "ready".
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
            try {
                const display = await DisplayManager_1.DisplayManager.start(displayNum, width, height);
                session = await Session_1.Session.create(sessionId, ws, display, width, height, url, scripts, jsBridgeEnabled);
                activeSessions.add(session);
                ws.send(JSON.stringify({ type: 'ready', sessionId }));
            }
            catch (err) {
                const message = err.message;
                console.error(`[${sessionId}] Failed to create session:`, message);
                ws.send(JSON.stringify({ type: 'error', sessionId, message }));
                ws.close();
            }
            return;
        }
        // ── Input / control ───────────────────────────────────────────────────
        if (session) {
            // handleMessage is already guarded; errors are logged internally.
            await session.handleMessage(text);
        }
    });
    // Non-async close handler — fire-and-forget disposal with explicit error catch.
    // Using an async handler here would produce unhandled rejections because the
    // 'ws' library ignores the return value of event callbacks.
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
// ── Start listening ───────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
    console.log(`[sidecar] Listening on port ${PORT} (HTTP health + WS)`);
});
httpServer.on('error', (err) => {
    console.error('[sidecar] HTTP server error:', err.message);
    process.exit(1);
});
// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
    console.log(`[sidecar] ${signal} received — shutting down`);
    // Stop accepting new connections.
    wss.close();
    httpServer.close();
    // Dispose all active sessions (kills Xvfb + Chrome + matchbox).
    const disposeAll = [...activeSessions].map(s => s.dispose().catch(err => console.warn('[sidecar] Session dispose error:', err.message)));
    await Promise.all(disposeAll);
    activeSessions.clear();
    console.log('[sidecar] Shutdown complete');
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
