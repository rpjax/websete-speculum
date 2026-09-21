#!/usr/bin/env node
/**
 * Série temporal Virtual: dumps + frameEmitted.tableSize ao longo do tempo.
 * Detecta: Virtual cresce e fio/Projected não (projeção empacada) vs Virtual parado (antibot).
 *
 * Uso: node gecko-engine/devpath/lab-virtual-timeseries.mjs [url]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';
import fs from 'node:fs';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const TOTAL_MS = Number(process.env.TOTAL_MS || 60000);
const SNAP_EVERY_MS = Number(process.env.SNAP_EVERY_MS || 5000);
const OUT = process.env.OUT_DIR || `/tmp/virtual-ts-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });

function u32(buf, o) {
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
}
function u64(buf, o) {
  return (BigInt(u32(buf, o)) | (BigInt(u32(buf, o + 4)) << 32n)).toString();
}
function parseDump(buf) {
  if (!buf || buf.length < 28) return null;
  const sequence = u32(buf, 0);
  const generation = u32(buf, 4);
  const contextId = u32(buf, 8);
  const tableHash = u64(buf, 12);
  const rowCount = u32(buf, 20);
  return { sequence, generation, contextId, tableHash, rowCount, dumpLen: buf.length };
}

const samples = [];
const navigated = [];
const faults = [];
const teleKinds = [];
const frameEmitted = [];
let binary = 0;
let bootedAt = null;
let snapN = 0;

function mark(label, extra = {}) {
  samples.push({
    t: Date.now(),
    elapsedMs: bootedAt ? Date.now() - bootedAt : null,
    label,
    binary,
    frameEmittedCount: frameEmitted.length,
    lastEmitted: frameEmitted.length ? frameEmitted[frameEmitted.length - 1] : null,
    ...extra,
  });
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${LAB}/lab/session`);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(snapTimer);
    clearTimeout(endTimer);
    try {
      ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: true }));
    } catch {
      /* */
    }
    setTimeout(() => {
      ws.close();
      resolve();
    }, 800);
  };

  const snapTimer = setInterval(() => {
    if (!bootedAt) return;
    snapN += 1;
    ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1, label: `ts-${snapN}` }));
    mark(`snap-request-${snapN}`);
  }, SNAP_EVERY_MS);

  const endTimer = setTimeout(finish, TOTAL_MS);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          telemetry: {
            enabled: true,
            clock: true,
            frameEmitted: true,
            desync: true,
            applyResult: true,
          },
        }),
      );
    }, 200);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binary += 1;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      fs.writeFileSync(pathJoin(OUT, `f-${String(binary).padStart(4, '0')}.bin`), buf);
      mark('binary-frame', { bytes: buf.length });
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
      mark('booted', { sessionId: msg.sessionId, dossier: msg.dossierDir });
      // first snap soon
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1, label: 'ts-0' }));
        mark('snap-request-0');
      }, 1500);
    }
    if (msg.type === 'gecko.navigated') {
      navigated.push({ t: Date.now(), elapsedMs: bootedAt ? Date.now() - bootedAt : null, url: msg.url });
      mark('navigated', { url: msg.url });
    }
    if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
      faults.push(msg);
      mark('fault', { msg });
    }
    if (msg.type === 'gecko.snapshotServed') {
      const dump = msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64') : Buffer.alloc(0);
      const parsed = parseDump(dump);
      fs.writeFileSync(pathJoin(OUT, `virtual-dump-${snapN}-${msg.sequence}.bin`), dump);
      mark('virtual-dump', {
        sequence: msg.sequence,
        generation: msg.generation,
        tableHashWire: String(msg.tableHash),
        dump: parsed,
      });
    }
    if (msg.type === 'telemetry' && msg.message) {
      const m = msg.message;
      teleKinds.push(m.kind);
      if (m.kind === 'frameEmitted') {
        frameEmitted.push({
          t: Date.now(),
          elapsedMs: bootedAt ? Date.now() - bootedAt : null,
          sequence: m.sequence,
          generation: m.generation,
          tableSize: m.tableSize,
          identitySize: m.identitySize,
          opCount: m.opCount,
          bytes: m.bytes,
          resync: m.resync,
        });
        mark('frameEmitted', {
          sequence: m.sequence,
          tableSize: m.tableSize,
          identitySize: m.identitySize,
          resync: m.resync,
        });
      }
    }
  });
  ws.on('error', reject);
});

function pathJoin(a, b) {
  return `${a}/${b}`;
}

const dumps = samples.filter((s) => s.label === 'virtual-dump');
const sizes = frameEmitted.map((f) => f.tableSize);
const maxTable = sizes.length ? Math.max(...sizes) : 0;
const minTable = sizes.length ? Math.min(...sizes) : 0;
const lastDump = dumps.length ? dumps[dumps.length - 1] : null;
const firstDump = dumps.length ? dumps[0] : null;

const virtualGrew =
  dumps.length >= 2 &&
  firstDump.dump &&
  lastDump.dump &&
  lastDump.dump.rowCount > firstDump.dump.rowCount + 50;

const emittedGrew = maxTable > minTable + 50;

const report = {
  url: URL,
  totalMs: TOTAL_MS,
  outDir: OUT,
  binaryFrames: binary,
  navigated,
  faults,
  frameEmitted,
  dumps: dumps.map((d) => ({
    elapsedMs: d.elapsedMs,
    sequence: d.sequence,
    rowCount: d.dump?.rowCount,
    tableHash: d.dump?.tableHash,
    generation: d.dump?.generation,
  })),
  analysis: {
    maxTableSizeEmitted: maxTable,
    minTableSizeEmitted: minTable,
    emittedGrew,
    virtualDumpGrew: virtualGrew,
    firstDumpRows: firstDump?.dump?.rowCount ?? null,
    lastDumpRows: lastDump?.dump?.rowCount ?? null,
    storeSized: maxTable >= 5000 || (lastDump?.dump?.rowCount ?? 0) >= 5000,
    hypothesis:
      virtualGrew && binary <= 6
        ? 'VIRTUAL_GREW_WIRE_THIN — projeção/empacotamento suspeito'
        : emittedGrew && !virtualGrew
          ? 'EMITTED_GREW_DUMP_FLAT — checar dump timing'
          : !emittedGrew && !virtualGrew
            ? 'VIRTUAL_STUCK — antibot/shell não avançou no Gecko'
            : 'MIXED_OR_OK',
  },
  sampleTail: samples.slice(-30),
};

fs.writeFileSync(`${OUT}/timeseries.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`wrote ${OUT}/timeseries.json`);
process.exit(report.analysis.hypothesis.startsWith('VIRTUAL_STUCK') ? 2 : report.faults.length ? 3 : 0);
