'use strict';
/**
 * Isolate Eneba precondition desync — exact op, seq, expected/actual.
 * Run: docker compose exec lab node scripts/diag-eneba-precondition.js
 */
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');

const LAB = process.env.SPECULUM_LAB_WS || 'ws://127.0.0.1:4103/lab/session';
const URL = process.env.ENEBA_URL || 'https://www.eneba.com';
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 25000);

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readNdjsonDesyncs(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev?.kind === 'desynced') out.push(ev);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function main() {
  const desyncs = [];
  const resyncs = [];
  let dossierDir = null;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(LAB);
    const t0 = Date.now();

    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          frameRateHz: 30,
          width: 1280,
          height: 720,
          headed: true,
        }),
      );
    });

    ws.on('message', (raw) => {
      if (Buffer.isBuffer(raw) || raw instanceof ArrayBuffer) return;
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'session.booted' && msg.dossierDir) {
        dossierDir = msg.dossierDir;
      }

      if (msg.type === 'telemetry' && msg.message?.kind === 'desynced') {
        desyncs.push({ tMs: Date.now() - t0, ...msg.message });
      }

      if (msg.type === 'client.requestResync') {
        resyncs.push({ tMs: Date.now() - t0, ...msg });
      }

      if (msg.type === 'session.stopped' && msg.dossierDir) {
        dossierDir = msg.dossierDir;
      }

      if (msg.type === 'session.fault') {
        console.log('SESSION_FAULT', JSON.stringify(msg));
      }
    });

    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: true }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);
    }, WAIT_MS);

    ws.on('close', () => resolve());
  });

  const ndjsonPath = dossierDir ? path.join(dossierDir, 'telemetry', 'events.ndjson') : null;
  const dossierDesyncs = ndjsonPath ? readNdjsonDesyncs(ndjsonPath) : [];

  console.log('\n=== LIVE WS DESYNCS ===');
  for (const d of desyncs) console.log(JSON.stringify(d));

  console.log('\n=== DOSSIER DESYNCS ===', ndjsonPath || '(none)');
  for (const d of dossierDesyncs) console.log(JSON.stringify(d));

  const all = desyncs.length > 0 ? desyncs : dossierDesyncs;
  const first = all[0];
  if (!first) {
    console.log('\nNo desync captured.');
    return;
  }

  console.log('\n=== FIRST FAILURE (exact) ===');
  const summary = {
    errorCode: first.errorCode,
    op: first.op,
    id: first.id,
    sequence: first.sequence,
    generation: first.generation,
    expected: first.expected,
    actual: first.actual,
    message: first.message,
    phase: first.phase,
    contextId: first.contextId,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (first.op === 'preTableHash') {
    console.log(
      '\nMECHANISM: Frame sequence',
      first.sequence,
      'declares preTableHash=',
      first.expected,
      'but Projected client table hash was',
      first.actual,
      'before applying that frame.',
    );
    console.log(
      'Meaning: client table state diverged from producer BEFORE this frame — missed/skipped frame, CSSOM/table apply drift, or out-of-order apply.',
    );
  } else if (first.op === 'check') {
    console.log(
      '\nMECHANISM: CHECK at end of frame seq',
      first.sequence,
      'expected tableHash',
      first.expected,
      'actual',
      first.actual,
    );
  } else if (first.message) {
    console.log('\nMECHANISM: Op', first.op, 'id', first.id, '—', first.message);
  }

  console.log('\nTotal desync events:', all.length);
  console.log('Resync requests (WS):', resyncs.length);
  if (dossierDir) console.log('Dossier:', dossierDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
