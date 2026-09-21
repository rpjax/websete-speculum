#!/usr/bin/env node
/**
 * Captura frames Beleza no lab e aplica fase-1 (tabela) offline até o primeiro malformed.
 * Não precisa do DOM do lab UI — isola o op que quebra o resync.
 *
 * Uso:
 *   node gecko-engine/devpath/lab-beleza-diag-apply.mjs [url]
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
const { applyFrameToTableChecked } = await import(
  pathToFileURL(path.join(PP, 'core/replicatedTableApply.js')).href
);
const { ReplicatedTable } = await import(pathToFileURL(path.join(PP, 'core/replicatedTable.js')).href);
const { CONTEXT_ID_ROOT } = await import(pathToFileURL(path.join(PP, 'core/frame.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const LAB_WS = process.env.LAB_WS || `${LAB}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const BOOT_MS = Number(process.env.BOOT_MS || 25000);
const OUT_DIR = process.env.OUT_DIR || `/tmp/beleza-diag-apply-${Date.now()}`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const frames = [];
const events = [];
let binary = 0;
let bootedAt = null;

function pushEv(kind, extra = {}) {
  events.push({ t: Date.now(), kind, binary, ...extra });
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket(LAB_WS);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: false }));
    } catch {
      /* */
    }
    setTimeout(() => {
      ws.close();
      resolve();
    }, 400);
  };

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          telemetry: { enabled: true, frameEmitted: true, desync: true, applyResult: true },
        }),
      );
    }, 200);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binary += 1;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const file = path.join(OUT_DIR, `f-${String(binary).padStart(4, '0')}.bin`);
      fs.writeFileSync(file, buf);
      frames.push({ n: binary, file, bytes: new Uint8Array(buf) });
      return;
    }
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'session.booted') {
      bootedAt = Date.now();
      pushEv('booted', { sessionId: msg.sessionId, dossier: msg.dossierDir });
      setTimeout(finish, BOOT_MS);
    }
    if (msg.type === 'gecko.navigated') pushEv('navigated', { url: msg.url, contextId: msg.contextId });
    if (msg.type === 'gecko.contextCreated') pushEv('contextCreated', { contextId: msg.contextId });
    if (msg.type === 'telemetry' && msg.message) {
      pushEv('telemetry', { tele: msg.message });
    }
    if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
      pushEv('fault', { msg });
      finish();
    }
  });
  ws.on('error', reject);
});

const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const applyLog = [];
let firstFail = null;

for (const f of frames) {
  const hdr = peekFrameHeader(f.bytes);
  const ctx = hdr?.contextId ?? null;
  if (ctx != null && ctx !== CONTEXT_ID_ROOT && ctx !== 0) {
    applyLog.push({ n: f.n, skip: 'nested', contextId: ctx });
    continue;
  }
  const decoded = decodeFramePart(f.bytes, strings);
  if (!decoded.ok) {
    const fail = { n: f.n, stage: 'decode', reason: decoded.reason, message: decoded.message };
    applyLog.push(fail);
    if (!firstFail) firstFail = fail;
    continue;
  }
  const assembled = assembler.ingest(decoded.part);
  if (assembled === 'missing_part' || assembled === 'malformed') {
    const fail = { n: f.n, stage: 'assemble', reason: assembled };
    applyLog.push(fail);
    if (!firstFail) firstFail = fail;
    continue;
  }
  if (assembled === null) {
    applyLog.push({ n: f.n, stage: 'part', partIndex: decoded.part.partIndex });
    continue;
  }
  const result = applyFrameToTableChecked(table, assembled.resync, assembled.ops, assembled.sequence);
  if (!result.ok) {
    const fail = {
      n: f.n,
      stage: 'table',
      sequence: assembled.sequence,
      resync: assembled.resync,
      generation: assembled.generation,
      opCount: assembled.ops.length,
      reason: result.reason,
      opName: result.opName,
      id: result.id,
      message: result.message,
      failedOpIndex: result.failedOpIndex,
      sampleOps: assembled.ops.slice(0, 8).map((op) => ({
        op: op.op,
        id: 'id' in op ? op.id : undefined,
        kind: 'kind' in op ? op.kind : undefined,
        name: 'name' in op ? op.name : undefined,
        ns: 'ns' in op ? op.ns : undefined,
      })),
    };
    applyLog.push(fail);
    if (!firstFail) firstFail = fail;
    // Resync failure resets table on real client; keep going on a fresh table for later frames.
    if (assembled.resync) table.reset();
    continue;
  }
  applyLog.push({
    n: f.n,
    ok: true,
    sequence: assembled.sequence,
    resync: assembled.resync,
    opCount: assembled.ops.length,
    rows: table.size,
  });
}

const report = {
  url: URL,
  bootMs: BOOT_MS,
  outDir: OUT_DIR,
  frameCount: frames.length,
  events,
  firstFail,
  applyLog,
};

fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ frameCount: frames.length, firstFail, applyTail: applyLog.slice(-8) }, null, 2));
console.error(`wrote ${OUT_DIR}/report.json`);
process.exit(firstFail ? 1 : 0);
