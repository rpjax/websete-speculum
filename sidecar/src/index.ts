import * as http from 'http';
import { WebSocketServer } from 'ws';
import { WsSessionHost } from './transport/WsSessionHost';

const PORT = parseInt(process.env['SIDECAR_PORT'] ?? '3000', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[sidecar] Invalid SIDECAR_PORT: ${process.env['SIDECAR_PORT']}`);
    process.exit(1);
}

const sessionHost = new WsSessionHost();

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
sessionHost.attach(wss);

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

    await sessionHost.shutdown();

    console.log('[sidecar] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
