#!/usr/bin/env node
/**
 * Aferição objetiva Beleza / URL: marcas de tempo fixas, snapshot Virtual +
 * contadores de fio + gecko.navigated. Sem chute.
 *
 * Uso:
 *   node gecko-engine/devpath/lab-beleza-aferir.mjs [url]
 *   EXPLICIT_NAV=0 BOOT_MS=25000 node ...   # só cold
 *   EXPLICIT_NAV=1 AFTER_NAV_MS=45000 ...   # cold + navigate explícito
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';
import fs from 'node:fs';

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const LAB_WS = process.env.LAB_WS || `${LAB}/lab/session`;
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const BOOT_MS = Number(process.env.BOOT_MS || 25000);
const AFTER_NAV_MS = Number(process.env.AFTER_NAV_MS || 45000);
const EXPLICIT_NAV = process.env.EXPLICIT_NAV !== '0';
const COLD_MARKS_MS = (process.env.COLD_MARKS || '5000,15000,25000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const POST_MARKS_MS = (process.env.POST_MARKS || '5000,20000,45000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

const t0wall = Date.now();
const samples = [];
const navigated = [];
const contextCreated = [];
const faults = [];
const teleKinds = [];
let binary = 0;
let bootedAt = null;
let lastVirtualSnap = null;
let lastProjected = null;
let phase = 'preboot';

function now() {
  return Date.now();
}

function baseSample(mark) {
  return {
    t: now(),
    elapsedMs: bootedAt ? now() - bootedAt : now() - t0wall,
    mark,
    phase,
    frames: binary,
    navigatedCount: navigated.length,
    navigatedUrls: navigated.map((n) => n.url),
    contextCreated: contextCreated.length,
    v: lastVirtualSnap
      ? {
          sequence: lastVirtualSnap.sequence,
          generation: lastVirtualSnap.generation,
          tableHash: lastVirtualSnap.tableHash,
          dumpLen: lastVirtualSnap.dumpLen,
        }
      : null,
    p: lastProjected,
    teleTop: summarizeTele(),
  };
}

function summarizeTele() {
  const counts = {};
  for (const k of teleKinds) counts[k] = (counts[k] || 0) + 1;
  return counts;
}

function requestSnaps(ws) {
  ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1 }));
  ws.send(JSON.stringify({ type: 'requestSnapshot', contextId: 1 }));
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket(LAB_WS);
  const timers = [];
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    for (const t of timers) clearTimeout(t);
    samples.push(baseSample('end'));
    try {
      ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: true }));
    } catch {
      /* */
    }
    setTimeout(() => {
      ws.close();
      resolve();
    }, 1000);
  };

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      phase = 'cold';
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
            applyResult: true,
            desync: true,
          },
        }),
      );
    }, 200);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) {
      binary += 1;
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
      bootedAt = now();
      phase = 'cold';
      samples.push({ ...baseSample('T0-booted'), dossier: msg.dossierDir, caps: msg.caps });
      requestSnaps(ws);

      for (const ms of COLD_MARKS_MS) {
        timers.push(
          setTimeout(() => {
            if (phase !== 'cold') return;
            requestSnaps(ws);
            setTimeout(() => samples.push(baseSample(`cold+${ms}ms`)), 400);
          }, ms),
        );
      }

      if (EXPLICIT_NAV) {
        timers.push(
          setTimeout(() => {
            phase = 'post-nav';
            const before = binary;
            samples.push({ ...baseSample('explicit-nav'), binaryBefore: before });
            ws.send(JSON.stringify({ type: 'browse.navigate', url: URL }));
            requestSnaps(ws);
            for (const ms of POST_MARKS_MS) {
              timers.push(
                setTimeout(() => {
                  requestSnaps(ws);
                  setTimeout(() => samples.push(baseSample(`post+${ms}ms`)), 400);
                }, ms),
              );
            }
            timers.push(setTimeout(finish, Math.max(...POST_MARKS_MS, 1000) + 1500));
          }, BOOT_MS),
        );
      } else {
        timers.push(setTimeout(finish, Math.max(...COLD_MARKS_MS, BOOT_MS) + 1500));
      }
    }

    if (msg.type === 'gecko.contextCreated') {
      contextCreated.push({ t: now(), contextId: msg.contextId, bc: msg.browsingContextId });
    }
    if (msg.type === 'gecko.navigated') {
      navigated.push({ t: now(), contextId: msg.contextId, url: msg.url, frames: binary });
      console.error(`[navigated] ${msg.url} frames=${binary}`);
    }
    if (msg.type === 'session.fault' || msg.type === 'gecko.fault') {
      faults.push(msg);
      console.error(`[fault]`, JSON.stringify(msg));
      samples.push(baseSample('fault'));
      finish();
      return;
    }
    if (msg.type === 'gecko.snapshotServed') {
      lastVirtualSnap = {
        sequence: msg.sequence,
        generation: msg.generation,
        tableHash: msg.tableHash,
        dumpLen: msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64').length : 0,
      };
    }
    if (msg.type === 'client.snapshotResult' || msg.type === 'snapshotResult') {
      const html = typeof msg.html === 'string' ? msg.html : msg.outerHTML || '';
      const styles =
        typeof msg.styles === 'number'
          ? msg.styles
          : (html.match(/<style[\s>]/gi) || []).length +
            (html.match(/rel=["']?stylesheet/gi) || []).length;
      lastProjected = {
        armed: msg.armed ?? null,
        sequence: msg.sequence ?? null,
        generation: msg.generation ?? null,
        htmlLen: msg.htmlLen ?? html.length,
        styles,
        hasSecIfCpt: /sec-if-cpt/i.test(html),
        desynced: msg.desynced ?? null,
      };
    }
    if (msg.type === 'telemetry' && msg.message?.kind) {
      teleKinds.push(msg.message.kind);
    }
    if (msg.type === 'requestSnapshot') {
      // host pedindo projected — client lab responde; script puro não tem DOM.
    }
  });

  ws.on('error', reject);
});

const firstV = samples.map((s) => s.v?.dumpLen ?? 0);
const lastV = firstV.length ? firstV[firstV.length - 1] : 0;
const coldFrames = samples.filter((s) => String(s.mark).startsWith('cold+')).map((s) => s.frames);
const framesAtColdEnd = coldFrames.length ? coldFrames[coldFrames.length - 1] : 0;
const vAtCold = samples.filter((s) => String(s.mark).startsWith('cold+')).map((s) => s.v?.dumpLen ?? 0);
const vGrewCold = vAtCold.length >= 2 && vAtCold[vAtCold.length - 1] > vAtCold[0] + 100;

const report = {
  url: URL,
  bootMs: BOOT_MS,
  explicitNav: EXPLICIT_NAV,
  booted: bootedAt != null,
  contextCreated,
  navigated,
  faults,
  samples,
  verdict: {
    coldSilent: framesAtColdEnd === 0,
    coldGotNavigated: navigated.some((n) => (bootedAt == null ? true : n.t >= bootedAt && n.t <= bootedAt + BOOT_MS)),
    coldNavigatedUrls: navigated
      .filter((n) => bootedAt != null && n.t >= bootedAt && n.t <= bootedAt + BOOT_MS)
      .map((n) => n.url),
    vGrewDuringCold: vGrewCold,
    framesAtColdEnd,
    framesAtEnd: binary,
    lastVDumpLen: lastV,
  },
};

const outPath = process.env.AFERIR_OUT || `/tmp/beleza-aferir-${Date.now()}.json`;
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`wrote ${outPath}`);
process.exit(bootedAt != null ? 0 : 2);
