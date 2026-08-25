/**
 * Projection lab HTTP + WebSocket server (dev-only).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { labAssetRoots } from '../assetRoots';
import { WsLabConnection, listLabBlueprintSummaries } from './wsSession';
import { tryServeLabVirtualAsset } from './labVirtualAssets';

export type LabServerOptions = {
  host: string;
  port: number;
  headless: boolean;
};

export type LabServer = {
  close(): Promise<void>;
  readonly port: number;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '');
  const rel = decoded.replace(/^\/+/, '');
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(path.normalize(root))) return null;
  return full;
}

export async function createLabServer(opts: LabServerOptions): Promise<LabServer> {
  const { staticDir, fixturesDir, labRoot } = labAssetRoots();
  const sessions = new Map<string, WsLabConnection>();
  const publicOrigin = `http://${opts.host}:${opts.port}`;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? url;

    void (async () => {
      if (await tryServeLabVirtualAsset(req, res, pathname, url, sessions)) return;

      if (pathname === '/health' || pathname === '/lab/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessions: sessions.size, protocolVersion: 1 }));
        return;
      }
      if (pathname === '/lab/fixtures' || pathname === '/lab/fixtures/') {
        const manifest = path.join(fixturesDir, 'manifest.json');
        sendFile(res, manifest);
        return;
      }
      if (pathname === '/lab/blueprints' || pathname === '/lab/blueprints/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ blueprints: listLabBlueprintSummaries() }));
        return;
      }
      if (pathname === '/' || pathname.startsWith('/index.html')) {
        sendFile(res, path.join(staticDir, 'client.html'));
        return;
      }
      if (pathname.startsWith('/lab/client.js') || pathname === '/client.js') {
        sendFile(res, path.join(staticDir, 'client.js'));
        return;
      }
      if (pathname.startsWith('/virtual.js') || pathname.startsWith('/__speculum/virtual.js')) {
        const candidates = [
          path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'virtual.js'),
          path.join(labRoot, '..', 'virtual.js'),
          path.join(__dirname, '..', '..', 'virtual.js'),
        ];
        const found = candidates.find((p) => fs.existsSync(p));
        if (!found) {
          res.writeHead(404).end('virtual.js missing — run npm run build:virtual');
          return;
        }
        sendFile(res, found);
        return;
      }
      if (pathname.startsWith('/fixtures/')) {
        const file = safeJoin(fixturesDir, pathname.slice('/fixtures/'.length));
        if (file === null) {
          res.writeHead(400).end('bad path');
          return;
        }
        sendFile(res, file);
        return;
      }
      res.writeHead(404).end('not found');
    })().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500).end(err instanceof Error ? err.message : String(err));
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    if (pathname === '/lab/session') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = new WsLabConnection(ws, {
          publicOrigin,
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
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port, opts.host, () => resolve());
    server.on('error', reject);
  });

  return {
    port: opts.port,
    async close(): Promise<void> {
      for (const session of sessions.values()) await session.dispose();
      sessions.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
