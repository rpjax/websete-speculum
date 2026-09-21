#!/usr/bin/env node
/**
 * Smoke Beleza só via lab (4077) — cold boot + health + snapshot + stop/export.
 * Sem Playwright. Parity debug de fora do Linux.
 *
 * Uso: node gecko-engine/devpath/lab-beleza.mjs [url]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const LAB_WS = process.env.LAB_WS || `${LAB}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);

async function health() {
  const r = await fetch(`${LAB}/lab/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

const timeline = [];
let binaryFrames = 0;
let booted = false;
let dossierDir = '';
let snapshotServed = null;
let fault = null;
let caps = null;
const virtualKinds = [];

const t0 = Date.now();
const sample = async (label) => {
  const h = await health();
  timeline.push({ label, tMs: Date.now() - t0, binaryFrames, booted, ...h });
};

await sample('idle');

await new Promise((resolve, reject) => {
  const ws = new WebSocket(LAB_WS);
  const end = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: true }));
    setTimeout(() => {
      ws.close();
      resolve();
    }, 1500);
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
          telemetry: { enabled: true, clock: true },
        }),
      );
      void sample('after-browse-start');
    }, 300);
  });

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
    if (msg.type === 'session.booted') {
      booted = true;
      dossierDir = msg.dossierDir || '';
      caps = msg.caps ?? { events: msg.capEvents, metrics: msg.capMetrics };
      // Pedir snapshot Virtual após boot.
      ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1 }));
    }
    if (msg.type === 'session.stopped' && msg.dossierDir) {
      dossierDir = msg.dossierDir;
    }
    if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
      fault = msg;
    }
    if (msg.type === 'gecko.snapshotServed') {
      snapshotServed = {
        sequence: msg.sequence,
        generation: msg.generation,
        tableHash: msg.tableHash,
        dumpLen: msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64').length : 0,
      };
    }
    if (msg.type === 'telemetry' && msg.message?.kind) {
      virtualKinds.push(msg.message.kind);
    }
  });

  ws.on('error', (e) => {
    clearTimeout(end);
    reject(e);
  });
});

await sample('final');

const fin = timeline[timeline.length - 1];
const report = {
  url: URL,
  waitMs: WAIT_MS,
  booted,
  fault,
  dossierDir,
  binaryFrames,
  snapshotServed,
  virtualKinds: [...new Set(virtualKinds)],
  caps,
  supervisor: fin.supervisor,
  framesFromSupervisor: fin.framesFromSupervisor,
  telemetryEnvelopesFromSupervisor: fin.telemetryEnvelopesFromSupervisor,
  sessions: fin.sessions,
  timeline: timeline.map(({ label, tMs, binaryFrames: b, supervisor, caps, framesFromSupervisor }) => ({
    label,
    tMs,
    binaryFrames: b,
    supervisor,
    caps,
    framesFromSupervisor,
  })),
};

console.log(JSON.stringify(report, null, 2));

const ok =
  booted &&
  !fault &&
  binaryFrames > 0 &&
  (snapshotServed == null || snapshotServed.dumpLen >= 0);
process.exit(ok ? 0 : 2);
