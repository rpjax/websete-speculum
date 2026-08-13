"use strict";
/**
 * Projection lab HTTP + WebSocket server (dev-only).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLabServer = createLabServer;
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const ws_1 = require("ws");
const session_1 = require("./session");
const virtualBrowser_1 = require("./virtualBrowser");
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
function sendFile(res, filePath) {
    if (!node_fs_1.default.existsSync(filePath) || !node_fs_1.default.statSync(filePath).isFile()) {
        res.writeHead(404).end('not found');
        return;
    }
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    node_fs_1.default.createReadStream(filePath).pipe(res);
}
function safeJoin(root, urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '');
    const rel = decoded.replace(/^\/+/, '');
    const full = node_path_1.default.normalize(node_path_1.default.join(root, rel));
    if (!full.startsWith(node_path_1.default.normalize(root)))
        return null;
    return full;
}
async function createLabServer(opts) {
    const { staticDir, fixturesDir } = (0, virtualBrowser_1.labAssetRoots)();
    const sessions = new Map();
    const publicOrigin = `http://${opts.host}:${opts.port}`;
    const publicWsOrigin = `ws://${opts.host}:${opts.port}`;
    const server = node_http_1.default.createServer((req, res) => {
        const url = req.url ?? '/';
        if (url === '/health' || url === '/lab/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
            return;
        }
        if (url === '/' || url.startsWith('/index.html')) {
            sendFile(res, node_path_1.default.join(staticDir, 'client.html'));
            return;
        }
        if (url.startsWith('/lab/client.js') || url === '/client.js') {
            sendFile(res, node_path_1.default.join(staticDir, 'client.js'));
            return;
        }
        if (url.startsWith('/virtual.js')) {
            const candidates = [
                node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'virtual.js'),
                node_path_1.default.join(__dirname, '..', 'virtual.js'),
            ];
            const found = candidates.find((p) => node_fs_1.default.existsSync(p));
            if (!found) {
                res.writeHead(404).end('virtual.js missing — run npm run build:virtual');
                return;
            }
            sendFile(res, found);
            return;
        }
        if (url.startsWith('/fixtures/')) {
            const file = safeJoin(fixturesDir, url.slice('/fixtures/'.length));
            if (file === null) {
                res.writeHead(400).end('bad path');
                return;
            }
            sendFile(res, file);
            return;
        }
        res.writeHead(404).end('not found');
    });
    const wss = new ws_1.WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const reqUrl = req.url ?? '';
        const pathname = reqUrl.split('?')[0] ?? '';
        if (pathname === '/lab/session') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                const session = new session_1.LabSession(ws, {
                    publicOrigin,
                    publicWsOrigin,
                    headless: opts.headless,
                });
                sessions.set(session.id, session);
                ws.on('message', (data, isBinary) => {
                    void session.handleClientMessage(data, isBinary);
                });
                ws.on('close', () => {
                    sessions.delete(session.id);
                    void session.dispose();
                });
            });
            return;
        }
        const virtualMatch = /^\/lab\/virtual\/([^/]+)\/?$/.exec(pathname);
        if (virtualMatch) {
            const sessionId = virtualMatch[1];
            const session = sessions.get(sessionId);
            if (session === undefined) {
                socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                session.attachVirtualData(ws);
            });
            return;
        }
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
    });
    await new Promise((resolve, reject) => {
        server.listen(opts.port, opts.host, () => resolve());
        server.on('error', reject);
    });
    return {
        port: opts.port,
        async close() {
            for (const session of sessions.values()) {
                await session.dispose();
            }
            sessions.clear();
            await new Promise((resolve) => wss.close(() => resolve()));
            await new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        },
    };
}
//# sourceMappingURL=server.js.map