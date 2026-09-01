/**
 * Second-origin fixture server for CSSOM matrix class 9 (real cross-origin SecurityError).
 * Default port 4078 — distinct from main lab host (4077).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { labAssetRoots } from './assetRoots';

export type CrossOriginFixtureServer = {
  origin: string;
  port: number;
  close(): Promise<void>;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/** Routes that serve with CORS enabled (rules readable cross-origin). */
const CORS_ROUTES = new Set([
  '/cssom-matrix/xo-cors.css',
  '/fixtures/cssom-matrix/xo-cors.css',
]);

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

function resolveFixtureFile(
  fixturesDir: string,
  pathname: string,
): { file: string; contentType: string } | null {
  const clean = pathname.split('?')[0] ?? pathname;
  let rel = clean.replace(/^\/+/, '');
  if (rel.startsWith('fixtures/')) rel = rel.slice('fixtures/'.length);
  if (!rel.startsWith('cssom-matrix/') && !rel.startsWith('input-xo/')) return null;
  const full = path.normalize(path.join(fixturesDir, rel));
  if (!full.startsWith(path.normalize(fixturesDir))) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  const ext = path.extname(full).toLowerCase();
  return { file: full, contentType: MIME[ext] ?? 'application/octet-stream' };
}

export async function createCrossOriginFixtureServer(
  host = '127.0.0.1',
  preferredPort?: number,
): Promise<CrossOriginFixtureServer> {
  const { fixturesDir } = labAssetRoots();
  const port = preferredPort ?? envInt('SPECULUM_LAB_XO_PORT', 4078);

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? url;
    const resolved = resolveFixtureFile(fixturesDir, pathname);
    if (resolved === null) {
      res.writeHead(404).end('not found');
      return;
    }
    const headers: Record<string, string> = {
      'Content-Type': resolved.contentType,
      'Cache-Control': 'no-store',
    };
    const corsPath = pathname.startsWith('/fixtures/') ? pathname.slice('/fixtures'.length) : pathname;
    if (CORS_ROUTES.has(pathname) || CORS_ROUTES.has(corsPath)) {
      headers['Access-Control-Allow-Origin'] = '*';
    }
    res.writeHead(200, headers);
    fs.createReadStream(resolved.file).pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve());
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;

  return {
    origin: `http://${host}:${boundPort}`,
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function labConfigJson(crossOriginOrigin: string): Record<string, string> {
  return { crossOriginOrigin };
}
