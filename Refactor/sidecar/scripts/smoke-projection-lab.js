/**
 * Smoke the projection lab: cold-start-as-ordinary-frame + live apply OK via lab client UI.
 * No "establish" phase anymore (frame-protocol.md §4.7) — the first frame is just an
 * ordinary frame carrying the whole initial document as NODE_NEW/INSERT ops.
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

async function smokeWsFirstFrameAndLive() {
  const frames = [];
  const controls = [];
  const kinds = new Set();
  const frameEmittedMsgs = [];
  let sawFirstFrameEmitted = false;
  let sawLiveFrameEmitted = false;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout waiting for first-frame+live telemetry'));
    }, 90_000);

    // Stays connected past the first couple of frames for a sturdier live-mutation signal than
    // a bare sequence>1 (2 frames).
    const MIN_LIVE_SEQUENCE = 15;

    const maybeDone = () => {
      if (frames.length >= 2 && sawFirstFrameEmitted && sawLiveFrameEmitted) {
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
            applyResult: true,
            desync: true,
            applyOverrun: true,
            clock: true,
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
        if (kind === 'frameEmitted') {
          frameEmittedMsgs.push(msg.message);
          if ((msg.message?.sequence ?? 0) === 1) sawFirstFrameEmitted = true;
          if ((msg.message?.sequence ?? 0) >= MIN_LIVE_SEQUENCE) sawLiveFrameEmitted = true;
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
  if (!sawFirstFrameEmitted) throw new Error('no sequence=1 frameEmitted telemetry (cold-start-as-frame)');
  if (!sawLiveFrameEmitted) throw new Error('no sustained live frameEmitted telemetry (live mutation)');

  const firstFrameEmitted = frameEmittedMsgs.find((m) => m.sequence === 1);
  console.log(
    `DIAG first frame opCount=${firstFrameEmitted?.opCount} bytes=${firstFrameEmitted?.bytes} buildMs=${firstFrameEmitted?.buildMs?.toFixed?.(3)} tableSize=${firstFrameEmitted?.tableSize}`,
  );
  if (!firstFrameEmitted || (firstFrameEmitted.opCount ?? 0) <= 0) {
    throw new Error(`expected first frame to carry ops (cold start), got ${JSON.stringify(firstFrameEmitted)}`);
  }

  return { frames: frames.length, controls: controls.length, kinds: [...kinds], firstFrameEmitted };
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
            aggregate: false,
            transportDeferred: false,
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

  if (kinds.has('aggregate')) {
    throw new Error(`aggregate capability off but got ${[...kinds].join(',')}`);
  }
  if (!kinds.has('frameEmitted')) {
    throw new Error('expected frameEmitted while aggregate off');
  }
  return [...kinds];
}

async function smokeClientApplyOk() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // frame-protocol.md §1.5/§6 hash-parity gate: the real client (client/applyDom.ts,
    // ReplicatedTable) runs inside this page and performs real two-phase apply (Stage 2 of
    // frame-protocol-production-completeness) — Phase 1 verifies `preTableHash` and any `CHECK`
    // against its own table before Phase 2 ever touches the DOM. A `desynced` telemetry message
    // with `errorCode: 'precondition'` means the client's table diverged from the producer's —
    // the same signal `tableHashMismatch` used to carry pre-Stage-2, now folded into the single
    // `onDesync` abort path. Observed from outside the page via Playwright's own WebSocket frame
    // events, not by instrumenting the client.
    const preconditionDesyncs = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload !== 'string') return;
        try {
          const msg = JSON.parse(frame.payload);
          if (
            msg?.type === 'telemetry' &&
            msg.message?.kind === 'desynced' &&
            msg.message?.errorCode === 'precondition'
          ) {
            preconditionDesyncs.push(msg.message);
          }
        } catch {
          // ignore
        }
      });
    });

    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#connect');
    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('connected') || s.includes('press Start');
    }, null, { timeout: 30_000 });

    await page.fill('#url', `http://${HOST}:${PORT}/fixtures/demo.html`);
    await page.click('#start');

    await page.waitForFunction(() => {
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      const seq = Number(document.getElementById('streamSeq')?.textContent ?? '-1');
      return apply >= 1 && seq >= 1;
    }, null, { timeout: 90_000 });

    // Longer settle than the original 1500ms — enough sustained live ticks (demo.html mutates
    // on an interval) for the hash-parity gate above to have real signal, not just 1-2 frames.
    await wait(4000);

    if (preconditionDesyncs.length > 0) {
      throw new Error(
        `client Phase 1 (preTableHash/CHECK) diverged from the producer (frame-protocol.md §6 two-phase apply): ${JSON.stringify(preconditionDesyncs.slice(0, 3))}`,
      );
    }

    const snapshot = await page.evaluate(() => {
      const host = document.getElementById('surfaceHost');
      const iframe = host?.querySelector('iframe');
      const doc = iframe?.contentDocument ?? null;
      return {
        apply: document.getElementById('streamApply')?.textContent,
        frames: document.getElementById('streamFrames')?.textContent,
        seq: document.getElementById('streamSeq')?.textContent,
        ops: document.getElementById('streamOps')?.textContent,
        h1: doc?.querySelector('h1')?.textContent ?? null,
        title: doc?.title ?? null,
        pCount: doc?.querySelectorAll('p').length ?? null,
      };
    });
    if (snapshot.h1 !== 'Lab fixture') {
      throw new Error(`expected h1 "Lab fixture", got ${JSON.stringify(snapshot.h1)}`);
    }
    console.log(
      `DIAG two-phase apply — 0 precondition desyncs across the whole run (frame-protocol.md §6 hash parity)`,
    );
    return snapshot;
  } finally {
    await browser.close();
  }
}

/** One wire part, hand-built (mirrors virtual/frame/binaryWriter.ts's `assemblePart` exactly). */
function buildCorruptFrameBytes({ generation, sequence, preTableHash }) {
  const header = Buffer.alloc(24); // magic u16 + version u8 + flags u8 + gen u32 + seq u32 + partIdx u16 + partCount u16 + preTableHash u64
  header.writeUInt16LE(0x5050, 0);
  header.writeUInt8(1, 2); // version
  header.writeUInt8(0, 3); // flags — not resync; preTableHash IS checked (frame-protocol.md §2)
  header.writeUInt32LE(generation, 4);
  header.writeUInt32LE(sequence, 8);
  header.writeUInt16LE(0, 12); // partIndex
  header.writeUInt16LE(1, 14); // partCount
  header.writeBigUInt64LE(preTableHash, 16);
  const stringTable = Buffer.from([0, 0, 0, 0]); // strCount = 0
  const opsBody = Buffer.from([0, 0, 0, 0]); // opCount = 0 — the preTableHash mismatch alone must abort the frame
  return Buffer.concat([header, stringTable, opsBody]);
}

/**
 * frame-protocol.md §6/§P3 Stage 2 GATE, browser-level half (the table-level half is
 * `unit.ts`'s `testApplyFrameToTableCheckedRejectsCorruptedCheck`/`...DoesNotRollBackPriorOps`):
 * "a deliberately-corrupted frame … touches zero DOM nodes and produces a precondition failure."
 * Runs the real client (`client/applyDom.ts`, `LabProjectionClient`) inside a real page, freezes
 * Virtual so no legitimate frame can race the injected one, hand-crafts a frame with a
 * `preTableHash` that cannot possibly match the client's real table, sends it straight to the
 * client over the same control WS the page already has open (`injectRawFrame`, lab-only test
 * hook — never a production/wire-protocol path), and asserts both halves of the contract: the
 * client reports `onDesync('precondition')`, and the projected DOM is byte-identical before and
 * after — proving phase 2 (`applyOp` -> real DOM mutation) never ran for this frame.
 */
async function smokeCorruptedFrameAbortsBeforeDom() {
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
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      return apply >= 2;
    }, null, { timeout: 90_000 });

    // Freeze Virtual — the client's own control WS (this page's connection to the lab session)
    // stays open, so the client keeps running and can still receive the injected frame below.
    await page.click('#stop');
    await wait(500);

    const before = await page.evaluate(() => {
      const hooks = window.__speculumLabTestHooks;
      const host = document.getElementById('surfaceHost');
      const doc = host?.querySelector('iframe')?.contentDocument ?? null;
      return {
        lastAcceptedSequence: hooks?.projection?.lastAcceptedSequence ?? 0,
        html: doc?.documentElement?.outerHTML ?? null,
        h1: doc?.querySelector('h1')?.textContent ?? null,
        nodeCount: doc?.getElementsByTagName('*').length ?? 0,
      };
    });
    if (before.html === null) throw new Error('no surface document to snapshot before injection');

    const desyncSeen = page.evaluate(
      () =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          window.__speculumLabTestHooks.onDesync = (reason) => {
            clearTimeout(timer);
            resolve(reason);
          };
        }),
    );

    const corruptFrame = buildCorruptFrameBytes({
      generation: 1,
      sequence: before.lastAcceptedSequence + 1,
      preTableHash: 0xffffffffffffffffn,
    });
    await page.evaluate((bytesBase64) => {
      window.__speculumLabTestHooks.sendControl({ type: 'injectRawFrame', bytesBase64 });
    }, corruptFrame.toString('base64'));

    const desyncReason = await desyncSeen;
    if (desyncReason !== 'precondition') {
      throw new Error(`expected the corrupted frame to abort with reason 'precondition', got ${JSON.stringify(desyncReason)}`);
    }

    const after = await page.evaluate(() => {
      const host = document.getElementById('surfaceHost');
      const doc = host?.querySelector('iframe')?.contentDocument ?? null;
      return {
        html: doc?.documentElement?.outerHTML ?? null,
        h1: doc?.querySelector('h1')?.textContent ?? null,
        nodeCount: doc?.getElementsByTagName('*').length ?? 0,
      };
    });

    if (after.html !== before.html || after.h1 !== before.h1 || after.nodeCount !== before.nodeCount) {
      throw new Error(
        `corrupted frame mutated the projected DOM (§P3 "abort before touching the surface" violated): before=${JSON.stringify({ h1: before.h1, nodeCount: before.nodeCount })} after=${JSON.stringify({ h1: after.h1, nodeCount: after.nodeCount })}`,
      );
    }

    console.log(
      `DIAG corrupted-frame gate — precondition desync fired, DOM byte-identical (nodeCount=${after.nodeCount}) before/after (frame-protocol.md §6/§P3)`,
    );
    return { desyncReason, nodeCount: after.nodeCount };
  } finally {
    await browser.close();
  }
}

/** One wire part with a single hostile op, hand-built the same way `buildCorruptFrameBytes` is. */
function buildHostileInsertFrameBytes({ generation, sequence }) {
  const header = Buffer.alloc(24);
  header.writeUInt16LE(0x5050, 0);
  header.writeUInt8(1, 2); // version
  header.writeUInt8(0, 3); // flags — not resync
  header.writeUInt32LE(generation, 4);
  header.writeUInt32LE(sequence, 8);
  header.writeUInt16LE(0, 12); // partIndex
  header.writeUInt16LE(1, 14); // partCount
  header.writeBigUInt64LE(0n, 16); // preTableHash — irrelevant, decode itself must reject this first
  const stringTable = Buffer.from([0, 0, 0, 0]); // strCount = 0
  const opCount = Buffer.from([1, 0, 0, 0]); // opCount = 1
  // INSERT (opcode 0x40): parent u32, before u32, count u16 — declares 60,000 children, far past
  // MAX_CHILDREN_PER_OP (8,192, models/limits.ts). No id bytes follow: `decode.ts`'s
  // `checkChildCount` must throw right after reading `count`, before `new Array(count)` is ever
  // allocated — that is the whole point of "checked before any allocation" (§8).
  const op = Buffer.alloc(1 + 4 + 4 + 2);
  op.writeUInt8(0x40, 0);
  op.writeUInt32LE(1, 1); // parent = Document
  op.writeUInt32LE(0, 5); // before = end
  op.writeUInt16LE(60_000, 9);
  return Buffer.concat([header, stringTable, opCount, op]);
}

/**
 * frame-protocol.md §8 Stage 3 GATE: "a hostile/oversized synthetic frame (huge count, huge
 * string length) is rejected before any allocation proportional to the attacker-controlled
 * value." Reuses `injectRawFrame` exactly like `smokeCorruptedFrameAbortsBeforeDom` — a
 * `MAX_CHILDREN_PER_OP`-violating `INSERT` must be reported as `malformed` (decode-level
 * corruption, not a table precondition) and must never touch the projected DOM.
 */
async function smokeHostileFrameRejectedBeforeAllocation() {
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
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      return apply >= 2;
    }, null, { timeout: 90_000 });

    // Freeze Virtual — same reasoning as smokeCorruptedFrameAbortsBeforeDom: no legitimate frame
    // races the injected hostile one.
    await page.click('#stop');
    await wait(500);

    const before = await page.evaluate(() => {
      const hooks = window.__speculumLabTestHooks;
      const doc = document.getElementById('surfaceHost')?.querySelector('iframe')?.contentDocument ?? null;
      return {
        lastAcceptedSequence: hooks?.projection?.lastAcceptedSequence ?? 0,
        nodeCount: doc?.getElementsByTagName('*').length ?? 0,
        h1: doc?.querySelector('h1')?.textContent ?? null,
      };
    });
    if (before.h1 === null) throw new Error('no surface document to snapshot before injection');

    const desyncSeen = page.evaluate(
      () =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          window.__speculumLabTestHooks.onDesync = (reason) => {
            clearTimeout(timer);
            resolve(reason);
          };
        }),
    );

    const hostileFrame = buildHostileInsertFrameBytes({ generation: 1, sequence: before.lastAcceptedSequence + 1 });
    await page.evaluate((bytesBase64) => {
      window.__speculumLabTestHooks.sendControl({ type: 'injectRawFrame', bytesBase64 });
    }, hostileFrame.toString('base64'));

    const desyncReason = await desyncSeen;
    if (desyncReason !== 'malformed') {
      throw new Error(
        `expected a MAX_CHILDREN_PER_OP violation to be rejected as 'malformed', got ${JSON.stringify(desyncReason)}`,
      );
    }

    const after = await page.evaluate(() => {
      const doc = document.getElementById('surfaceHost')?.querySelector('iframe')?.contentDocument ?? null;
      return {
        nodeCount: doc?.getElementsByTagName('*').length ?? 0,
        h1: doc?.querySelector('h1')?.textContent ?? null,
      };
    });
    if (after.nodeCount !== before.nodeCount || after.h1 !== before.h1) {
      throw new Error(
        `hostile frame must be rejected at decode, before any table/DOM effect: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      );
    }

    console.log(
      `DIAG hostile-frame gate — MAX_CHILDREN_PER_OP violation rejected 'malformed' pre-allocation, DOM untouched (nodeCount=${after.nodeCount})`,
    );
    return { desyncReason, nodeCount: after.nodeCount };
  } finally {
    await browser.close();
  }
}

/**
 * frame-protocol.md §1.2/§4.1 Stage 3 GATE — a hard navigation within the same lab session
 * (`navigate` control message -> `virtualBrowser.ts`'s `navigate()` bumps `generation` and
 * re-injects the producer script) must announce itself via a leading `EPOCH_RESET` that the
 * already-running client (`labProjectionClient.ts`) accepts and rebuilds from — never a raw
 * `generation_mismatch` desync, and the projected surface must end up showing the *new* page,
 * not a stale or half-torn-down one.
 */
async function smokeEpochResetOnHardNavigation() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#connect');
    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('connected') || s.includes('press Start');
    }, null, { timeout: 30_000 });

    await page.evaluate(() => {
      window.__speculumLabTestDesyncs = [];
      window.__speculumLabTestHooks.onDesync = (reason) => {
        window.__speculumLabTestDesyncs.push(reason);
      };
    });

    await page.fill('#url', `http://${HOST}:${PORT}/fixtures/demo.html`);
    await page.click('#start');
    await page.waitForFunction(() => {
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      return apply >= 1;
    }, null, { timeout: 90_000 });

    const before = await page.evaluate(() => {
      const doc = document.getElementById('surfaceHost')?.querySelector('iframe')?.contentDocument ?? null;
      return {
        generation: document.getElementById('streamGen')?.textContent ?? null,
        h1: doc?.querySelector('h1')?.textContent ?? null,
      };
    });
    if (before.h1 !== 'Lab fixture') {
      throw new Error(`expected demo.html's h1 before navigating, got ${JSON.stringify(before.h1)}`);
    }

    await page.evaluate((url) => {
      window.__speculumLabTestHooks.sendControl({ type: 'navigate', url });
    }, `http://${HOST}:${PORT}/fixtures/static-dom.html`);

    await page.waitForFunction(() => {
      const doc = document.getElementById('surfaceHost')?.querySelector('iframe')?.contentDocument ?? null;
      return doc?.querySelector('h1')?.textContent === 'Static DOM';
    }, null, { timeout: 30_000 });

    // Give the client a moment past the rebuild for any stray desync telemetry to arrive before
    // asserting on the accumulated list below.
    await wait(500);

    const after = await page.evaluate(() => {
      const doc = document.getElementById('surfaceHost')?.querySelector('iframe')?.contentDocument ?? null;
      return {
        generation: document.getElementById('streamGen')?.textContent ?? null,
        h1: doc?.querySelector('h1')?.textContent ?? null,
        title: doc?.title ?? null,
        nodeCount: doc?.getElementsByTagName('*').length ?? 0,
        desyncs: window.__speculumLabTestDesyncs ?? [],
      };
    });

    if (after.generation !== '2') {
      throw new Error(`expected generation to bump 1->2 across the hard navigation, got ${JSON.stringify(after.generation)}`);
    }
    if (after.h1 !== 'Static DOM' || after.title !== 'Static DOM fixture') {
      throw new Error(`projected surface was not rebuilt to the new page after EPOCH_RESET: ${JSON.stringify(after)}`);
    }
    if (after.desyncs.length > 0) {
      throw new Error(`EPOCH_RESET must be a clean announced generation bump, not a desync: ${JSON.stringify(after.desyncs)}`);
    }

    console.log(
      `DIAG EPOCH_RESET hard navigation — generation 1->2, surface rebuilt (h1=${JSON.stringify(after.h1)}, nodeCount=${after.nodeCount}), 0 desyncs`,
    );
    return after;
  } finally {
    await browser.close();
  }
}

/**
 * frame-protocol.md §1.6/OPEN-2 Stage 3 GATE: "a long-soak run against stress-churn.html …
 * shows detached-row count staying bounded instead of growing forever." Runs the real producer
 * (no client attached — the gate is about the *producer's own* table/identity-map growth,
 * `virtual/frame/tableFrameBuilder.ts`'s `emitNodeDropSweep`) against a fixture whose steady
 * state continuously detaches rows (stress-churn.html's own `MAX_ROWS`-capped shift/remove), and
 * watches `frameEmitted` telemetry's `tableSize` (`this.domNodes.size`, `frameEmitter.ts`) across
 * several `NODE_DROP_AGE_SEQUENCES` sweep cycles. Without the sweep, `tableSize` would climb
 * roughly linearly with total churn processed; with it, growth must level off well below that.
 */
async function smokeNodeDropGcBounded() {
  const FRAME_RATE_HZ = 30; // NODE_DROP_AGE_SEQUENCES=120 -> ~4s/sweep-eligibility-cycle at this rate
  const RUN_MS = 20_000; // ~5 sweep-eligibility cycles

  const samples = [];
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const stopTimer = setTimeout(() => {
      try {
        ws.send(JSON.stringify({ type: 'stop' }));
      } catch {
        // ignore
      }
      ws.close();
    }, RUN_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          url: `http://${HOST}:${PORT}/fixtures/stress-churn.html`,
          telemetry: {
            enabled: true,
            frameEmitted: true,
            aggregate: false,
            transportDeferred: false,
            applyResult: false,
            aggregateIntervalMs: 60_000,
          },
          frameRateHz: FRAME_RATE_HZ,
        }),
      );
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'telemetry' && msg.message?.kind === 'frameEmitted') {
          samples.push({ sequence: msg.message.sequence, tableSize: msg.message.tableSize });
        }
      } catch {
        // ignore
      }
    });
    ws.on('error', reject);
    ws.on('close', () => {
      clearTimeout(stopTimer);
      resolve();
    });
  });

  if (samples.length < 30) {
    throw new Error(`too few frameEmitted samples to judge the GC bound (got ${samples.length})`);
  }

  // Compare the middle third (table already past its initial ramp-up) against the final third —
  // unbounded growth (no working GC) would show the final window tracking total churn processed
  // (~25 rows/tick * ~600 ticks over 20s at 30Hz ~= 15,000+ by the end); a working age-threshold
  // sweep keeps the *net* growth between the two windows small instead.
  const third = Math.floor(samples.length / 3);
  const middle = samples.slice(third, 2 * third);
  const last = samples.slice(2 * third);
  const avg = (arr) => arr.reduce((sum, s) => sum + s.tableSize, 0) / arr.length;
  const middleAvg = avg(middle);
  const lastAvg = avg(last);
  const peak = Math.max(...samples.map((s) => s.tableSize));

  console.log(
    `DIAG NODE_DROP GC soak — samples=${samples.length} middleAvgTableSize=${middleAvg.toFixed(0)} lastAvgTableSize=${lastAvg.toFixed(0)} peakTableSize=${peak}`,
  );

  if (lastAvg > middleAvg * 1.5 + 100) {
    throw new Error(
      `producer table size kept growing across the soak instead of stabilizing (no effective GC bound): middleAvg=${middleAvg.toFixed(0)} lastAvg=${lastAvg.toFixed(0)} (frame-protocol.md §1.6/OPEN-2)`,
    );
  }
  if (peak > 5000) {
    throw new Error(
      `producer table size grew far beyond a bounded GC backlog (peak=${peak}) — NODE_DROP sweep is not keeping up (§8 MAX_NODE_DROPS_PER_SWEEP)`,
    );
  }

  return { samples: samples.length, middleAvg, lastAvg, peak };
}

/** One wire part with a sequence miles past anything the client could legitimately be at yet. */
function buildSequenceGapFrameBytes({ generation, sequence }) {
  const header = Buffer.alloc(24);
  header.writeUInt16LE(0x5050, 0);
  header.writeUInt8(1, 2); // version
  header.writeUInt8(0, 3); // flags — not resync; an ordinary (hostile) frame
  header.writeUInt32LE(generation, 4);
  header.writeUInt32LE(sequence, 8);
  header.writeUInt16LE(0, 12); // partIndex
  header.writeUInt16LE(1, 14); // partCount
  header.writeBigUInt64LE(0n, 16); // preTableHash — irrelevant, the sequence-gap check aborts first
  const stringTable = Buffer.from([0, 0, 0, 0]); // strCount = 0
  const opsBody = Buffer.from([0, 0, 0, 0]); // opCount = 0
  return Buffer.concat([header, stringTable, opsBody]);
}

async function waitForCondition(predicate, timeoutMs, message) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(100);
  }
  throw new Error(message);
}

/**
 * Stage 4 (frame-protocol-production-completeness) GATE — client-initiated resync recovery +
 * double-buffer swap, end to end. Unlike `smokeCorruptedFrameAbortsBeforeDom`/
 * `smokeHostileFrameRejectedBeforeAllocation`, Virtual must stay *alive* here: `emitResyncFrame`
 * only ever runs from Virtual's own `PlaneChannel.Control` handler (`bootstrap.ts`), driven by
 * its own still-ticking `FrameEmitter` (`requestResync`, frameEmitter.ts) — a frozen/stopped
 * Virtual could never answer. Uses `static-dom.html` (no live mutation) specifically so the
 * structural-diff proof at the end can't be flaky against a fixture that's still changing text
 * between the two snapshot round-trips it takes.
 *
 * Forces a deterministic client-side desync via `injectRawFrame` (a hand-crafted frame whose
 * `sequence` is a million past what the client could legitimately have received next — never
 * racy against real traffic, unlike picking `lastAcceptedSequence + 1` on a live producer), then
 * asserts the *whole* recovery chain, not just that a resync-flagged frame showed up:
 *   (a) the client requests a resync (`resyncRequested` telemetry over the control WS),
 *   (b) the live producer answers and the client applies it into its standby buffer,
 *   (c) the client re-arms (`resyncCompleted` telemetry, `status` back to "armed"),
 *   (d) a fresh virtual-vs-client structural diff (`lab/structuralDiff.ts`, the same producer
 *       `runBenchmark`'s own gate already uses, exposed standalone via
 *       `requestStructuralDiff`/`structuralDiffResult`) is byte-identical — the actual proof the
 *       surface healed.
 */
async function smokeResyncRecovery() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    const requested = [];
    const completed = [];
    const failed = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload !== 'string') return;
        try {
          const msg = JSON.parse(frame.payload);
          if (msg?.type !== 'telemetry') return;
          const kind = msg.message?.kind;
          if (kind === 'resyncRequested') requested.push(msg.message);
          else if (kind === 'resyncCompleted') completed.push(msg.message);
          else if (kind === 'resyncFailed') failed.push(msg.message);
        } catch {
          // ignore
        }
      });
    });

    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#connect');
    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('connected') || s.includes('press Start');
    }, null, { timeout: 30_000 });

    await page.fill('#url', `http://${HOST}:${PORT}/fixtures/static-dom.html`);
    await page.click('#start');
    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      const apply = Number(document.getElementById('streamApply')?.textContent ?? '0');
      return apply >= 1 && s.includes('armed');
    }, null, { timeout: 90_000 });

    const before = await page.evaluate(() => ({
      lastAcceptedSequence: window.__speculumLabTestHooks?.projection?.lastAcceptedSequence ?? 0,
    }));

    const desyncSeen = page.evaluate(
      () =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          window.__speculumLabTestHooks.onDesync = (reason) => {
            clearTimeout(timer);
            resolve(reason);
          };
        }),
    );

    const gapFrame = buildSequenceGapFrameBytes({
      generation: 1,
      sequence: before.lastAcceptedSequence + 1_000_000,
    });
    await page.evaluate((bytesBase64) => {
      window.__speculumLabTestHooks.sendControl({ type: 'injectRawFrame', bytesBase64 });
    }, gapFrame.toString('base64'));

    const desyncReason = await desyncSeen;
    if (desyncReason !== 'sequence_gap') {
      throw new Error(`expected the far-future sequence to desync as 'sequence_gap', got ${JSON.stringify(desyncReason)}`);
    }

    await waitForCondition(() => requested.length > 0, 10_000, '(a) resyncRequested telemetry never arrived');

    await page.waitForFunction(() => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('armed');
    }, null, { timeout: 15_000 });
    await waitForCondition(() => completed.length > 0, 15_000, '(b)/(c) resyncCompleted telemetry never arrived');

    if (failed.length > 0) {
      throw new Error(`resync attempt(s) failed before recovering: ${JSON.stringify(failed)}`);
    }

    const diffResult = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const timer = setTimeout(
            () => resolve({ status: 'unavailable', reason: 'no structuralDiffResult within 10s' }),
            10_000,
          );
          window.__speculumLabTestHooks.onControlMessage = (msg) => {
            if (msg.type !== 'structuralDiffResult') return;
            clearTimeout(timer);
            window.__speculumLabTestHooks.onControlMessage = undefined;
            resolve(msg);
          };
          window.__speculumLabTestHooks.sendControl({ type: 'requestStructuralDiff' });
        }),
    );

    if (diffResult.status !== 'ok') {
      throw new Error(`(d) structural diff unavailable post-recovery: ${diffResult.reason}`);
    }
    if (!diffResult.result.identical) {
      throw new Error(
        `(d) post-recovery surface diverges from Virtual (${diffResult.result.divergenceCount} divergence(s)): ${JSON.stringify(diffResult.result.divergences.slice(0, 5))}`,
      );
    }

    console.log(
      `DIAG resync recovery — desync=${desyncReason} requested=${requested.length} completed=${completed.length} failed=${failed.length} structuralDiff=identical`,
    );
    return { desyncReason, requested: requested.length, completed: completed.length, diffResult };
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

    const wsResult = await smokeWsFirstFrameAndLive();
    console.log(`WS OK — frames=${wsResult.frames} controls=${wsResult.controls}`);

    const offKinds = await smokeTelemetryCapabilityOff();
    console.log(`CAPABILITY OK — kinds with aggregate=false: ${offKinds.join(',')}`);

    const apply = await smokeClientApplyOk();
    console.log(
      `APPLY OK — apply=${apply.apply} frames=${apply.frames} seq=${apply.seq} ops=${apply.ops} h1=${JSON.stringify(apply.h1)}`,
    );

    const corrupted = await smokeCorruptedFrameAbortsBeforeDom();
    console.log(`CORRUPTED-FRAME GATE OK — reason=${corrupted.desyncReason} nodeCount=${corrupted.nodeCount}`);

    const hostile = await smokeHostileFrameRejectedBeforeAllocation();
    console.log(`HOSTILE-FRAME GATE OK — reason=${hostile.desyncReason} nodeCount=${hostile.nodeCount}`);

    const epochReset = await smokeEpochResetOnHardNavigation();
    console.log(`EPOCH_RESET GATE OK — generation=${epochReset.generation} h1=${JSON.stringify(epochReset.h1)}`);

    const gc = await smokeNodeDropGcBounded();
    console.log(`NODE_DROP GC GATE OK — samples=${gc.samples} middleAvg=${gc.middleAvg.toFixed(0)} lastAvg=${gc.lastAvg.toFixed(0)} peak=${gc.peak}`);

    const resync = await smokeResyncRecovery();
    console.log(`RESYNC RECOVERY GATE OK — desync=${resync.desyncReason} requested=${resync.requested} completed=${resync.completed}`);

    console.log('SMOKE OK — cold-start-as-frame path + live apply + capability gate + two-phase abort gate + Stage 3 (EPOCH_RESET/NODE_DROP/limits) gates + Stage 4 (resync recovery) gate');
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
