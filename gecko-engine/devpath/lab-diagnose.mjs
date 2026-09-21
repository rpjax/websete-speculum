#!/usr/bin/env node
/**
 * Diagnóstico objetivo do lab Gecko — separa:
 *   Gecko→supervisor filho (framesFromSupervisor)
 *   lab→aba WS (framesForwarded, binaryFrames)
 * Uso: node gecko-engine/devpath/lab-diagnose.mjs [url]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';

const LAB = process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077';
const WS = process.env.LAB_WS || `${LAB.replace(/\/$/, '')}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const TOTAL_MS = Number(process.env.TOTAL_MS || 90000);
const NAVIGATE_AT_MS = Number(process.env.NAVIGATE_AT_MS || 8000);

async function health() {
  const r = await fetch(`${LAB}/lab/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

const timeline = [];
let binaryFrames = 0;
let booted = false;
const jsonTypes = [];

const t0 = Date.now();
const sample = async (label) => {
  const h = await health();
  timeline.push({
    label,
    tMs: Date.now() - t0,
    binaryFrames,
    booted,
    ...h,
  });
};

await sample('idle');

await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS);
  const poll = setInterval(() => {
    void sample('poll').catch(() => {});
  }, 3000);

  const done = () => {
    clearInterval(poll);
    clearTimeout(navT);
    clearTimeout(endT);
    try {
      ws.close();
    } catch {
      /* */
    }
    resolve();
  };

  const navT = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'browse.navigate', url: URL }));
    void sample('after-navigate-send').catch(() => {});
  }, NAVIGATE_AT_MS);

  const endT = setTimeout(done, TOTAL_MS);

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
      void sample('after-browse-start').catch(() => {});
    }, 300);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binaryFrames += 1;
      return;
    }
    let msg;
    try {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type) jsonTypes.push(`${msg.type}@${Date.now() - t0}ms`);
    if (msg.type === 'session.booted') booted = true;
  });

  ws.on('error', reject);
});

await sample('final');

const idle = timeline[0];
const fin = timeline[timeline.length - 1];
const report = {
  url: URL,
  totalMs: TOTAL_MS,
  navigateAtMs: NAVIGATE_AT_MS,
  summary: {
    booted,
    wsBinaryFrames: binaryFrames,
    deltaFramesFromSupervisor: fin.framesFromSupervisor - idle.framesFromSupervisor,
    deltaBytesFromSupervisor: fin.bytesFromSupervisor - idle.bytesFromSupervisor,
    finalSupervisor: fin.supervisor,
    finalSessionRunning: fin.sessionRunning,
    finalCaps: fin.caps,
    finalSessions: fin.sessions,
    jsonTypes: jsonTypes.slice(-20),
    verdict:
      fin.supervisor === 'connected' &&
      binaryFrames > 0 &&
      (fin.framesFromSupervisor - idle.framesFromSupervisor) > 0
        ? 'ok'
        : 'fail',
  },
  timeline: timeline.map(({ label, tMs, binaryFrames: b, framesFromSupervisor, bytesFromSupervisor, supervisor, sessionRunning, sessions, booted: bd, caps }) => ({
    label,
    tMs,
    wsBinary: b,
    framesFromSupervisor,
    bytesFromSupervisor,
    supervisor,
    sessionRunning,
    caps,
    streamingSessions: sessions?.filter((s) => s.streaming)?.length ?? 0,
    framesForwarded: sessions?.reduce((a, s) => a + (s.framesForwarded ?? 0), 0) ?? 0,
    bootedReady: sessions?.some((s) => s.bootedReady) ?? false,
    booted: bd,
  })),
};

console.log(JSON.stringify(report, null, 2));

const sup = fin.framesFromSupervisor - idle.framesFromSupervisor;
const fwd = fin.sessions?.reduce((a, s) => a + (s.framesForwarded ?? 0), 0) ?? 0;
if (sup === 0) process.exitCode = 3;
else if (binaryFrames === 0 && sup > 0) process.exitCode = 4;
else if (binaryFrames > 0 && binaryFrames < sup * 0.9) process.exitCode = 5;
else process.exitCode = sup > 5 && binaryFrames <= 3 ? 6 : 0;
