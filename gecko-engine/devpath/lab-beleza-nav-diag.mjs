#!/usr/bin/env node
/**
 * Diagnóstico Beleza: boot URL vs navigate explícito.
 * Uso: node gecko-engine/devpath/lab-beleza-nav-diag.mjs [url]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const LAB_WS = process.env.LAB_WS || `${LAB}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const BOOT_WAIT_MS = Number(process.env.BOOT_WAIT_MS || 25000);
const AFTER_NAV_MS = Number(process.env.AFTER_NAV_MS || 45000);

const events = [];
let binary = 0;
let booted = false;
const teleKinds = [];
const snapshots = [];

function note(label, extra = {}) {
  events.push({ t: Date.now(), label, binary, ...extra });
  console.error(`[${label}] binary=${binary}`, extra.message || '');
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket(LAB_WS);
  let phase = 'boot';
  let navTimer;
  let endTimer;

  const finish = () => {
    clearTimeout(navTimer);
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

  ws.on('open', () => {
    note('ws-open');
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      note('browse.start', { url: URL });
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          telemetry: { enabled: true, clock: true },
        }),
      );
    }, 200);

    navTimer = setTimeout(() => {
      phase = 'after-explicit-nav';
      const before = binary;
      note('explicit-browse.navigate', { url: URL, binaryBefore: before });
      ws.send(JSON.stringify({ type: 'browse.navigate', url: URL }));
      ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1 }));
    }, BOOT_WAIT_MS);

    endTimer = setTimeout(finish, BOOT_WAIT_MS + AFTER_NAV_MS);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binary += 1;
      if (binary === 1 || binary % 10 === 0) {
        note(`frame#${binary}`, { phase });
      }
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
      note('session.booted', { caps: msg.caps, dossier: msg.dossierDir });
      ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1 }));
    }
    if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
      note(msg.type, { message: JSON.stringify(msg) });
    }
    if (msg.type === 'gecko.snapshotServed') {
      snapshots.push({
        phase,
        sequence: msg.sequence,
        generation: msg.generation,
        tableHash: msg.tableHash,
        dumpLen: msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64').length : 0,
      });
      note('snapshotServed', {
        message: `seq=${msg.sequence} hash=${msg.tableHash} dump=${snapshots.at(-1).dumpLen}`,
      });
    }
    if (msg.type === 'telemetry' && msg.message?.kind) {
      teleKinds.push(msg.message.kind);
      if (msg.message.kind !== 'frameEmitted' || teleKinds.filter((k) => k === 'frameEmitted').length <= 3) {
        note(`telemetry:${msg.message.kind}`, {
          message: JSON.stringify({
            seq: msg.message.sequence,
            gen: msg.message.generation,
            buildMs: msg.message.buildMs,
            bytes: msg.message.bytes,
            force: msg.message.force,
            ok: msg.message.ok,
          }),
        });
      }
    }
  });

  ws.on('error', reject);
});

let health = null;
try {
  health = await fetch(`${LAB}/lab/health`).then((r) => r.json());
} catch {
  /* */
}

const report = {
  url: URL,
  bootWaitMs: BOOT_WAIT_MS,
  afterNavMs: AFTER_NAV_MS,
  booted,
  binaryFrames: binary,
  teleKinds: [...new Set(teleKinds)],
  frameEmitted: teleKinds.filter((k) => k === 'frameEmitted').length,
  snapshots,
  events,
  health,
  verdict: {
    bootGotFrames: events.some((e) => e.label.startsWith('frame#') && e.phase === 'boot'),
    navHelped:
      binary >
      (events.find((e) => e.label === 'explicit-browse.navigate')?.binaryBefore ?? 0),
  },
};

console.log(JSON.stringify(report, null, 2));
process.exit(booted && binary > 0 ? 0 : 2);
