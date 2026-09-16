#!/usr/bin/env node
/**
 * Abre URL no lab, espera, captura frames e extrai texto PROBE_JSON / resumo Beleza.
 * Uso: node gecko-engine/devpath/lab-arm-capture.mjs <url> [waitMs]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PP = path.join(ROOT, 'packages/page-projection/dist');
const { decodeFramePart, FramePartAssembler, PersistentStringTable, peekFrameHeader } = await import(
  pathToFileURL(path.join(PP, 'core/decode.js')).href
);
const { OpCode, NodeKind } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2];
const WAIT_MS = Number(process.argv[3] || process.env.WAIT_MS || 45000);
const OUT = process.env.OUT_DIR || `/tmp/arm-capture-${Date.now()}`;
if (!URL) {
  console.error('uso: lab-arm-capture.mjs <url> [waitMs]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

function u32(buf, o) {
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
}
function u64(buf, o) {
  return (BigInt(u32(buf, o)) | (BigInt(u32(buf, o + 4)) << 32n)).toString();
}
function parseDump(buf) {
  if (!buf || buf.length < 28) return null;
  return {
    sequence: u32(buf, 0),
    generation: u32(buf, 4),
    contextId: u32(buf, 8),
    tableHash: u64(buf, 12),
    rowCount: u32(buf, 20),
  };
}

const bins = [];
const frameEmitted = [];
const dumps = [];
const navigated = [];
const texts = [];
let binary = 0;
let bootedAt = null;

await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${LAB}/lab/session`);
  const end = setTimeout(() => {
    try {
      ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1, label: 'end' }));
    } catch {
      /* */
    }
    setTimeout(() => {
      try {
        ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: false }));
      } catch {
        /* */
      }
      setTimeout(() => {
        ws.close();
        resolve();
      }, 400);
    }, 1200);
  }, WAIT_MS);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          telemetry: { enabled: true, frameEmitted: true },
        }),
      );
    }, 200);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binary += 1;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      fs.writeFileSync(path.join(OUT, `f-${String(binary).padStart(4, '0')}.bin`), buf);
      bins.push(new Uint8Array(buf));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'session.booted') {
      bootedAt = Date.now();
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1, label: 'mid' }));
      }, Math.min(8000, Math.floor(WAIT_MS / 2)));
    }
    if (msg.type === 'gecko.navigated') navigated.push(msg.url);
    if (msg.type === 'gecko.snapshotServed') {
      const dump = msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64') : Buffer.alloc(0);
      dumps.push({
        elapsedMs: bootedAt ? Date.now() - bootedAt : null,
        ...parseDump(dump),
        tableHashHdr: String(msg.tableHash),
      });
    }
    if (msg.type === 'telemetry' && msg.message?.kind === 'frameEmitted') {
      frameEmitted.push({
        elapsedMs: bootedAt ? Date.now() - bootedAt : null,
        sequence: msg.message.sequence,
        tableSize: msg.message.tableSize,
        resync: msg.message.resync,
        bytes: msg.message.bytes,
      });
    }
  });
  ws.on('error', reject);
  ws.on('close', () => {
    clearTimeout(end);
    resolve();
  });
});

const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
for (const bytes of bins) {
  const hdr = peekFrameHeader(bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
  const decoded = decodeFramePart(bytes, strings);
  if (!decoded.ok) continue;
  const assembled = assembler.ingest(decoded.part);
  if (!assembled || typeof assembled === 'string') continue;
  for (const op of assembled.ops) {
    if (op.op === OpCode.NodeNew && (op.kind === NodeKind.Text || op.kind === NodeKind.Comment)) {
      const v = (op.value || '').trim();
      if (v) texts.push(v.slice(0, 4000));
    }
  }
}

const probeLine = texts.find((t) => t.startsWith('PROBE_JSON '));
let probe = null;
if (probeLine) {
  try {
    probe = JSON.parse(probeLine.slice('PROBE_JSON '.length));
  } catch (e) {
    probe = { parseError: String(e), raw: probeLine.slice(0, 200) };
  }
}

const tableSizes = frameEmitted.map((f) => f.tableSize);
const report = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  binaryFrames: binary,
  navigated,
  frameEmitted,
  dumps,
  maxTableSize: tableSizes.length ? Math.max(...tableSizes) : 0,
  lastDumpRows: dumps.length ? dumps[dumps.length - 1]?.rowCount ?? null : null,
  probe,
  textMarkers: texts.filter((t) => /PROBE_JSON|Powered and protected|akam|Beleza|challenge/i.test(t)).slice(0, 10),
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
