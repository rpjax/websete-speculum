import * as http             from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DisplayManager }            from './DisplayManager';
import { Session }                   from './Session';
import { BrowserStatePayload }       from './BrowserState';
import { CreateMessage, decodeMessage } from './Protocol';

const PORT = parseInt(process.env['SIDECAR_PORT'] ?? '3000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[sidecar] Invalid SIDECAR_PORT: ${process.env['SIDECAR_PORT']}`);
    process.exit(1);
}

let nextDisplay = 100;
const activeSessions = new Set<Session>();

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

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
    let session: Session | undefined;

    ws.on('message', async (raw: Buffer | string) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg  = decodeMessage(text);
        if (!msg) return;

        if (msg.type === 'create') {
            const {
                sessionId, width, height, url, scripts = [],
                jsBridgeEnabled = false, allowedNavigationDomains, browserState,
            } = msg as CreateMessage;

            if (session) {
                console.warn(`[${sessionId}] Duplicate create on existing session — rejecting`);
                ws.send(JSON.stringify({
                    type:    'error',
                    sessionId,
                    message: 'A session already exists on this connection.',
                }));
                return;
            }

            const displayNum = nextDisplay++;
            console.log(`[${sessionId}] Creating session on display :${displayNum}`);

            let display: DisplayManager | undefined;
            try {
                display = await DisplayManager.start(displayNum, width, height);

                session = await Session.create(
                    sessionId, ws, display, width, height, url, scripts,
                    jsBridgeEnabled, allowedNavigationDomains, browserState,
                );
                activeSessions.add(session);

                ws.send(JSON.stringify({ type: 'ready', sessionId }));
            } catch (err) {
                const message = (err as Error).message;
                console.error(`[${sessionId}] Failed to create session:`, message);
                if (display) {
                    display.dispose().catch(dispErr =>
                        console.warn(`[${sessionId}] Display dispose after create failure:`, (dispErr as Error).message),
                    );
                }
                ws.send(JSON.stringify({ type: 'error', sessionId, message }));
                ws.close();
            }
            return;
        }

        if (msg.type === 'exportState') {
            if (!session) return;
            try {
                const state = await session.captureState();
                ws.send(JSON.stringify({ type: 'stateExport', state }));
            } catch (err) {
                const message = (err as Error).message;
                console.warn(`[${session?.sessionId}] State export failed:`, message);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'stateExportError', message }));
                }
            }
            return;
        }

        if (session) {
            if (POINTER_TYPES.has(msg.type)) {
                session.handleMessage(text).catch(err =>
                    console.warn(`[${session!.sessionId}] Input error:`, (err as Error).message),
                );
                return;
            }
            await session.handleMessage(text);
        }
    });

    ws.on('close', () => {
        if (!session) return;
        const s = session;
        session = undefined;
        activeSessions.delete(s);

        s.dispose().catch(err =>
            console.warn('[sidecar] Session dispose error:', (err as Error).message),
        );
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

async function shutdown(signal: string): Promise<void> {
    console.log(`[sidecar] ${signal} received — shutting down`);

    wss.close();
    httpServer.close();

    const disposeAll = [...activeSessions].map(s =>
        s.dispose().catch(err =>
            console.warn('[sidecar] Session dispose error:', (err as Error).message),
        ),
    );
    await Promise.all(disposeAll);
    activeSessions.clear();

    console.log('[sidecar] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
