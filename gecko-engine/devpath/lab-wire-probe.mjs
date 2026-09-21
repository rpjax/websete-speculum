#!/usr/bin/env node
/**
 * Lab wire probe — só WS/HTTP do lab (4077). Sem Playwright.
 * Conta frames PP + telemetria Virtual ({type:telemetry}) e Projected (client.telemetry uplink).
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const LAB_WS = process.env.LAB_WS || `${LAB}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 40000);

const desyncs = [];
const applyOk = [];
const applyFail = [];
const virtualTel = [];
const faults = [];
const snapshots = [];
let binaryFrames = 0;
let booted = false;
let caps = null;
const jsonTypes = [];

await new Promise((resolve, reject) => {
  const ws = new WebSocket(LAB_WS);
  const t = setTimeout(() => {
    ws.close();
    resolve();
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
          frameRateHz: 60,
          telemetry: { enabled: true, clock: true },
        }),
      );
    }, 500);
  });

  const noteProjected = (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'desynced' || m.kind === 'desync') desyncs.push(m);
    if (m.kind === 'applyResult') {
      if (m.ok) applyOk.push(m);
      else applyFail.push(m);
    }
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binaryFrames += 1;
      return;
    }
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type) jsonTypes.push(msg.type);
    if (msg.type === 'session.booted') {
      booted = true;
      caps = msg.caps ?? { events: msg.capEvents, metrics: msg.capMetrics };
    }
    if (msg.type === 'session.fault') faults.push(msg);
    if (msg.type === 'gecko.fault') faults.push(msg);
    if (msg.type === 'gecko.snapshotServed') snapshots.push({ sequence: msg.sequence, generation: msg.generation });
    if (msg.type === 'telemetry' && msg.message) {
      virtualTel.push(msg.message);
      noteProjected(msg.message);
    }
    if (msg.type === 'client.telemetry' && msg.message) {
      noteProjected(msg.message);
    }
  });

  ws.on('error', reject);
  ws.on('close', () => {
    clearTimeout(t);
    resolve();
  });
});

let health = null;
try {
  health = await fetch(`${LAB}/lab/health`).then((r) => r.json());
} catch {
  /* */
}

const report = {
  url: URL,
  waitMs: WAIT_MS,
  booted,
  caps,
  healthCaps: health?.caps ?? null,
  jsonTypes: [...new Set(jsonTypes)],
  binaryFrames,
  virtualTelemetry: virtualTel.length,
  frameEmitted: virtualTel.filter((m) => m?.kind === 'frameEmitted').length,
  applyOk: applyOk.length,
  applyFail: applyFail.length,
  desyncs,
  faults,
  snapshots: snapshots.length,
  lastApplyOk: applyOk.slice(-3),
  lastApplyFail: applyFail.slice(-3),
};

console.log(JSON.stringify(report, null, 2));

const fail =
  faults.length > 0 ||
  desyncs.length > 0 ||
  !booted ||
  binaryFrames === 0;
process.exit(fail ? 2 : 0);
