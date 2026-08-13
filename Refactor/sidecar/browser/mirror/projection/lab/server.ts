/**
 * Projection lab HTTP + WebSocket server (dev-only).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { LabSession } from './session';
import { labAssetRoots } from './virtualBrowser';

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
  const { staticDir, fixturesDir } = labAssetRoots();
  const sessions = new Map<string, LabSession>();

  const publicOrigin = `http://${opts.host}:${opts.port}`;
  const publicWsOrigin = `ws://${opts.host}:${opts.port}`;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/health' || url === '/lab/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }
    if (url === '/' || url.startsWith('/index.html')) {
      sendFile(res, path.join(staticDir, 'client.html'));
      return;
    }
    if (url.startsWith('/lab/client.js') || url === '/client.js') {
      sendFile(res, path.join(staticDir, 'client.js'));
      return;
    }
    if (url.startsWith('/virtual.js')) {
      const candidates = [
        path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'virtual.js'),
        path.join(__dirname, '..', 'virtual.js'),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
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

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const reqUrl = req.url ?? '';
    const pathname = reqUrl.split('?')[0] ?? '';

    if (pathname === '/lab/session') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = new LabSession(ws, {
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
      const sessionId = virtualMatch[1]!;
      const session = sessions.get(sessionId);
      if (session === undefined) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        session.attachVirtualData(ws);
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
      for (const session of sessions.values()) {
        await session.dispose();
      }
      sessions.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
