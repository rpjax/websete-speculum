#!/usr/bin/env node
/** WS browse.start + navigate + grava bins (sem Playwright). */
import WebSocket from '../../sidecar/node_modules/ws/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFramePart, PersistentStringTable, peekFrameHeader } from '../../packages/page-projection/dist/core/decode.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const WS = process.env.LAB_WS || 'ws://127.0.0.1:4077/lab/session';
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const TOTAL_MS = Number(process.env.TOTAL_MS || 180000);
const NAV_MS = Number(process.env.NAV_MS || 15000);
const OUT = join(__dir, 'captures', `ws-capture-${Date.now()}`);

mkdirSync(OUT, { recursive: true });
const bins = [];
const persistent = new PersistentStringTable();
const meta = [];

await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          frameRateHz: 60,
        }),
      );
    }, 300);
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'browse.navigate', url: URL }));
    }, NAV_MS);
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary !== true) return;
    bins.push(Buffer.from(data));
    const bytes = new Uint8Array(data);
    const hdr = peekFrameHeader(bytes);
    const dec = decodeFramePart(bytes, persistent);
    meta.push({
      n: bins.length,
      len: data.length,
      hdr,
      decodeOk: dec.ok,
      decodeReason: dec.ok ? undefined : dec.reason,
    });
  });
  ws.on('error', reject);
  setTimeout(() => {
    ws.close();
    resolve();
  }, TOTAL_MS);
});

for (let i = 0; i < bins.length; i++) {
  const row = meta[i];
  const name = row?.hdr
    ? `f-${String(i + 1).padStart(4, '0')}-ctx${row.hdr.contextId}-seq${row.hdr.sequence}.bin`
    : `f-${String(i + 1).padStart(4, '0')}-raw.bin`;
  writeFileSync(join(OUT, name), bins[i]);
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ url: URL, totalMs: TOTAL_MS, navMs: NAV_MS, meta }, null, 2));

const pp = meta.filter((m) => m.hdr && m.hdr.contextId >= 1 && m.decodeOk);
console.log(JSON.stringify({ OUT, total: bins.length, ppDecodeOk: pp.length, meta }, null, 2));
