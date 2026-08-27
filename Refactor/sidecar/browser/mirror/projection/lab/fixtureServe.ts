/**
 * Lab fixture HTTP — CSP header + meta for locale-popup repro (Binance-class).
 */

import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

/** Matches csp-nav-locale-*.html meta + unit runSingleTabLocaleCspPlaneUnitTests. */
export const CSP_NAV_LOCALE_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.binance.com; img-src 'self' https: data: blob:";

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

export function fixtureServeHeaders(filePath: string): Record<string, string> {
  const ext = path.extname(filePath).toLowerCase();
  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
  };
  const base = path.basename(filePath);
  if (base.startsWith('csp-nav-locale-')) {
    headers['Content-Security-Policy'] = CSP_NAV_LOCALE_POLICY;
    headers['Cache-Control'] = 'no-store';
  }
  return headers;
}

export function pipeFixtureFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, fixtureServeHeaders(filePath));
  fs.createReadStream(filePath).pipe(res);
}
