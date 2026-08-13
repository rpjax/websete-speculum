/**
 * Smoke the projection lab: establish + live apply OK via lab client UI.
 * Run: node scripts/smoke-projection-lab.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { chromium } = require('patchright');

const PORT = 4099;
const HOST = '127.0.0.1';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await wait(200);
  }
  throw new Error('lab health timeout');
}

async function smokeWsEstablishAndLive() {
  const frames = [];
  const controls = [];
  const kinds = new Set();
  const decisions = [];
  let sawEstablishCompleted = false;
  let sawLiveFrameEmitted = false;
  let sawHandoff = false;
  let sawFrameDecision = false;
  let handoff = null;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout waiting for establish+live telemetry'));
    }, 90_000);

    const maybeDone = () => {
      if (
        frames.length >= 1 &&
        sawEstablishCompleted &&
        sawLiveFrameEmitted &&
        sawHandoff &&
        sawFrameDecision
      ) {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'stop' }));
        ws.close();
        resolve();
      }
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          url: `http://${HOST}:${PORT}/fixtures/demo.html`,
          telemetry: {
            enabled: true,
            frameEmitted: true,
            transportDeferred: true,
            aggregate: true,
            establish: true,
            builderStats: true,
            applyResult: true,
            desync: true,
            applyOverrun: true,
            clock: true,
            frameDecision: true,
            parityFingerprint: true,
            encoder: true,
            handoff: true,
            aggregateIntervalMs: 2000,
          },
          frameRateHz: 30,
        }),
      );
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        frames.push(Buffer.from(data));
        maybeDone();
        return;
      }
      try {
        const msg = JSON.parse(String(data));
        controls.push(msg);
        const kind = msg.type === 'telemetry' ? msg.message?.kind : null;
        if (kind) kinds.add(kind);
        if (kind === 'establishCompleted') {
          sawEstablishCompleted = true;
          maybeDone();
        }
        if (kind === 'handoff') {
          sawHandoff = true;
          handoff = msg.message;
          maybeDone();
        }
        if (kind === 'frameDecision') {
          sawFrameDecision = true;
          decisions.push(msg.message);
          maybeDone();
        }
        if (kind === 'frameEmitted' && msg.message?.establish !== true && (msg.message?.sequence ?? 0) > 0) {
          sawLiveFrameEmitted = true;
          maybeDone();
        }
      } catch {
        // ignore
      }
    });
    ws.on('error', reject);
  });

  const first = frames[0];
  if (!first || first.readUInt16LE(0) !== 0x5050) {
    throw new Error(`expected PP magic, got ${first ? first.subarray(0, 4).toString('hex') : 'none'}`);
  }
  if (!controls.some((c) => c.type === 'ready')) {
    throw new Error(`no ready control; got ${JSON.stringify(controls.slice(0, 5))}`);
  }
  if (!sawEstablishCompleted) throw new Error('no establishCompleted telemetry');
  if (!sawLiveFrameEmitted) throw new Error('no live frameEmitted telemetry');
  if (!sawHandoff) throw new Error('no handoff telemetry');
  if (!sawFrameDecision) throw new Error('no frameDecision telemetry');

  const firstDecision = decisions[0];
  const appendFromEmpty = firstDecision?.appendFromEmptyCount ?? -1;
  const listsEmpty = firstDecision?.lastChildListsEmpty;
  console.log(
    `DIAG handoff+decision kinds=${[...kinds].join(',')} appendFromEmptyCount=${appendFromEmpty} lastChildListsEmpty=${listsEmpty} childLists=${firstDecision?.childLists?.length}`,
  );
  if (appendFromEmpty !== 0) {
    throw new Error(`expected appendFromEmptyCount=0 after handoff seed, got ${appendFromEmpty}`);
  }
  if (handoff && handoff.lastChildListsSeeded !== true) {
    throw new Error(`expected lastChildListsSeeded=true, got ${JSON.stringify(handoff)}`);
  }

  return { frames: frames.length, controls: controls.length, kinds: [...kinds], firstDecision };
}

async function smokeTelemetryCapabilityOff() {
  const kinds = new Set();
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const timer = setTimeout(() => {
      try {
        ws.send(JSON.stringify({ type: 'stop' }));
      } catch {
        // ignore
      }
      ws.close();
      resolve();
    }, 10_000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          url: `http://${HOST}:${PORT}/fixtures/static-dom.html`,
          telemetry: {
            enabled: true,
            frameEmitted: true,
            establish: false,
            aggregate: false,
            transportDeferred: false,
            builderStats: false,
            applyResult: false,
            aggregateIntervalMs: 2000,
          },
        }),
      );
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'telemetry' && msg.message?.kind) {
          kinds.add(msg.message.kind);
        }
        if (msg.type === 'ready') {
          // give establish a beat, then stop
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'stop' }));
            ws.close();
          }, 2500);
        }
      } catch {
        // ignore
      }
    });
    ws.on('error', reject);
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  if (kinds.has('establishCompleted') || kinds.has('establishStarted')) {
    throw new Error(`establish capability off but got ${[...kinds].join(',')}`);
  }
  if (!kinds.has('frameEmitted')) {
    throw new Error('expected frameEmitted while establish off');
  }
  return [...kinds];
}

async function smokeClientApplyOk() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#connect');
    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('connected') || s.includes('press Start');
    }, null, { timeout: 30_000 });

    await page.fill('#url', `http://${HOST}:${PORT}/fixtures/demo.html`);
    await page.click('#start');

    await page.waitForFunction(() => {
      const establish = document.getElementById('streamEstablish')?.textContent ?? '';
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      const status = document.getElementById('status')?.textContent ?? '';
      const seq = Number(document.getElementById('streamSeq')?.textContent ?? '-1');
      return apply >= 1 && seq >= 1 && (establish === 'armed' || status.includes('armed'));
    }, null, { timeout: 90_000 });

    await wait(1500);

    const snapshot = await page.evaluate(() => {
      const host = document.getElementById('surfaceHost');
      let doc = null;
      if (host) {
        for (const f of host.querySelectorAll('iframe')) {
          if ((f.style.visibility || '') !== 'hidden') doc = f.contentDocument;
        }
      }
      return {
        establish: document.getElementById('streamEstablish')?.textContent,
        apply: document.getElementById('streamApply')?.textContent,
        frames: document.getElementById('streamFrames')?.textContent,
        seq: document.getElementById('streamSeq')?.textContent,
        dupH1: document.getElementById('streamDupH1')?.textContent,
        appendEmpty: document.getElementById('streamAppendEmpty')?.textContent,
        h1: doc?.querySelector('h1')?.textContent ?? null,
        title: doc?.title ?? null,
        pCount: doc?.querySelectorAll('p').length ?? null,
      };
    });
    if (snapshot.dupH1 === 'YES' || snapshot.h1 === 'Lab fixtureLab fixture') {
      throw new Error(`surface h1 duplicated: h1=${snapshot.h1} dupH1=${snapshot.dupH1}`);
    }
    if (snapshot.h1 !== 'Lab fixture') {
      throw new Error(`expected h1 "Lab fixture", got ${JSON.stringify(snapshot.h1)}`);
    }
    return snapshot;
  } finally {
    await browser.close();
  }
}

async function main() {
  const env = {
    ...process.env,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
  };
  const child = spawn(
    process.execPath,
    [path.join('dist', 'browser', 'mirror', 'projection', 'lab', 'index.js')],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout.on('data', (d) => {
    process.stdout.write(`[lab] ${d}`);
  });

  try {
    await waitHealth(60_000);

    const wsResult = await smokeWsEstablishAndLive();
    console.log(`WS OK — frames=${wsResult.frames} controls=${wsResult.controls}`);

    const offKinds = await smokeTelemetryCapabilityOff();
    console.log(`CAPABILITY OK — kinds with establish=false: ${offKinds.join(',')}`);

    const apply = await smokeClientApplyOk();
    console.log(
      `APPLY OK — establish=${apply.establish} apply=${apply.apply} frames=${apply.frames} seq=${apply.seq} h1=${JSON.stringify(apply.h1)} dupH1=${apply.dupH1} append∅=${apply.appendEmpty}`,
    );

    console.log('SMOKE OK — establish paint path + live apply + capability gate');
  } catch (err) {
    console.error('SMOKE FAIL', err);
    console.error('stderr', stderr);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    await wait(500);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

main();
