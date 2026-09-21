#!/usr/bin/env node
/**
 * Oráculo objetivo Virtual × Projected (lab Gecko).
 * Não usa HUD verde. Estado: dump Virtual + DOM Projected + decode do fio.
 *
 * Uso: node gecko-engine/devpath/lab-vproj-oracle.mjs [url]
 */
import WebSocket from '../../sidecar/node_modules/ws/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

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
const { OpCode, NodeKind } = await import(pathToFileURL(path.join(PP, 'core/opcodes.js')).href);

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 35000);
const OUT = process.env.OUT_DIR || `/tmp/vproj-oracle-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = patchright;

const bins = [];
const virtualSnaps = [];
const projectedSnaps = [];
const tele = [];
const navigated = [];
let booted = null;

function summarizeOps(ops) {
  const counts = {};
  const names = [];
  for (const op of ops) {
    const k = op.op;
    counts[k] = (counts[k] || 0) + 1;
    if (op.op === OpCode.NodeNew && op.kind === NodeKind.Element && op.name) {
      names.push(op.name);
    }
  }
  const topNames = {};
  for (const n of names) topNames[n] = (topNames[n] || 0) + 1;
  return {
    opCount: ops.length,
    byOpcode: counts,
    elementNamesTop: Object.entries(topNames)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15),
  };
}

// --- 1) Playwright: lab UI + Projected DOM ---
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleHits = { cspScriptNone: 0, cspInline: 0, extensionTypeError: 0, other: 0 };
page.on('console', (msg) => {
  const t = msg.text();
  if (/script-src 'none'/i.test(t) && /Loading the script/i.test(t)) consoleHits.cspScriptNone += 1;
  else if (/script-src 'none'/i.test(t) && /inline/i.test(t)) consoleHits.cspInline += 1;
  else if (/chrome-extension:\/\//i.test(t) || /removeAttribute|removeStyle/i.test(t))
    consoleHits.extensionTypeError += 1;
  else if (msg.type() === 'error') consoleHits.other += 1;
});

await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Intercept WS binary + client.telemetry for wire truth from the same session as HUD.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload) return;
  if (params.response?.opcode === 2) {
    const raw = Buffer.from(payload, 'base64');
    const n = bins.length + 1;
    const file = path.join(OUT, `f-${String(n).padStart(4, '0')}.bin`);
    fs.writeFileSync(file, raw);
    bins.push({ n, bytes: new Uint8Array(raw), file });
  }
});

await page.click('#connect');
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 90000,
});
await page.waitForTimeout(400);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(WAIT_MS);

// Force Virtual + lab snapshot buttons if present
const snapBtn = page.locator('button:has-text("Snapshot")');
if (await snapBtn.isVisible().catch(() => false)) {
  await snapBtn.click().catch(() => {});
  await page.waitForTimeout(1500);
}

const projected = await page.evaluate(() => {
  const iframe = document.querySelector('[data-pp-surface-stage] iframe, #surface iframe, iframe');
  const doc = iframe?.contentDocument;
  const html = doc?.documentElement?.outerHTML ?? '';
  const body = doc?.body;
  const metaCsp = [...(doc?.querySelectorAll('meta[http-equiv="Content-Security-Policy"]') ?? [])].map(
    (m) => m.getAttribute('content'),
  );
  const textSample = (body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const imgs = body ? body.querySelectorAll('img').length : 0;
  const scripts = body ? body.querySelectorAll('script').length : 0;
  const styles = doc ? doc.querySelectorAll('style,link[rel=stylesheet]').length : 0;
  return {
    iframePresent: !!iframe,
    srcdocLen: iframe?.srcdoc?.length ?? 0,
    htmlLen: html.length,
    bodyHtmlLen: body?.innerHTML?.length ?? 0,
    bodyChildren: body?.childElementCount ?? 0,
    textSample,
    imgs,
    scripts,
    styles,
    metaCsp,
    title: doc?.title ?? null,
    readyState: doc?.readyState ?? null,
    hud: {
      frames: document.getElementById('streamFrames')?.textContent,
      apply: document.getElementById('streamApply')?.textContent,
      desync: document.getElementById('streamDesync')?.textContent,
      seq: document.getElementById('streamSeq')?.textContent,
      gen: document.getElementById('streamGen')?.textContent,
      build: document.body.innerText.match(/build #\d+/)?.[0] ?? null,
    },
  };
});

await browser.close();

// --- 2) Parallel WS session for Virtual dump at end (same URL, fresh) if no virtual from UI ---
// UI session already closed with browser. New short WS for Virtual-only dump+wire stats.
await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${LAB}/lab/session`);
  const t = setTimeout(() => {
    try {
      ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: false }));
    } catch {
      /* */
    }
    setTimeout(() => {
      ws.close();
      resolve();
    }, 500);
  }, Math.min(WAIT_MS, 25000));

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'browse.start',
          url: URL,
          width: 1400,
          height: 900,
          telemetry: { enabled: true, frameEmitted: true },
        }),
      );
    }, 200);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary === true) return;
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'session.booted') {
      booted = { sessionId: msg.sessionId, dossier: msg.dossierDir };
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'requestSnapshot', contextId: 1 }));
        ws.send(JSON.stringify({ type: 'client.snapshot', contextId: 1 }));
      }, Math.min(WAIT_MS, 20000) - 1500);
    }
    if (msg.type === 'gecko.navigated') navigated.push({ url: msg.url, contextId: msg.contextId });
    if (msg.type === 'gecko.snapshotServed') {
      const dumpLen = msg.dumpBytes ? Buffer.from(msg.dumpBytes, 'base64').length : 0;
      virtualSnaps.push({
        sequence: msg.sequence,
        generation: msg.generation,
        tableHash: msg.tableHash,
        dumpLen,
        rowCount: msg.rowCount ?? null,
      });
    }
    if (msg.type === 'client.snapshotResult' || msg.type === 'snapshotResult') {
      projectedSnaps.push(msg);
    }
    if (msg.type === 'telemetry' && msg.message) tele.push(msg.message);
  });
  ws.on('error', reject);
});

// --- 3) Decode Playwright-captured wire (same session as blank HUD) ---
const strings = new PersistentStringTable();
const assembler = new FramePartAssembler();
const table = new ReplicatedTable();
const frameSummaries = [];
let firstFail = null;
let lastOk = null;

for (const f of bins) {
  const hdr = peekFrameHeader(f.bytes);
  if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) {
    frameSummaries.push({ n: f.n, skip: 'nested', contextId: hdr.contextId });
    continue;
  }
  const decoded = decodeFramePart(f.bytes, strings);
  if (!decoded.ok) {
    firstFail ??= { n: f.n, stage: 'decode', ...decoded };
    continue;
  }
  const assembled = assembler.ingest(decoded.part);
  if (assembled === null) continue;
  if (typeof assembled === 'string') {
    firstFail ??= { n: f.n, stage: 'assemble', reason: assembled };
    continue;
  }
  const opSum = summarizeOps(assembled.ops);
  const result = applyFrameToTableChecked(table, assembled.resync, assembled.ops, assembled.sequence);
  const row = {
    n: f.n,
    sequence: assembled.sequence,
    generation: assembled.generation,
    resync: assembled.resync,
    bytes: f.bytes.byteLength,
    ...opSum,
    tableRowsAfter: result.ok ? table.size : null,
    applyOk: result.ok,
    applyFail: result.ok
      ? null
      : { reason: result.reason, opName: result.opName, id: result.id, message: result.message },
  };
  frameSummaries.push(row);
  if (!result.ok) firstFail ??= row;
  else lastOk = row;
}

const frameEmitted = tele.filter((m) => m.kind === 'frameEmitted');

const report = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  /** Verdict fields — machine readable */
  verdict: {
    blankProjected:
      projected.bodyHtmlLen < 500 ||
      (projected.textSample.length < 20 && projected.bodyChildren < 3),
    wireThin: bins.length > 0 && bins.length <= 6,
    protocolGreenHud:
      Number(projected.hud.apply || 0) > 0 && Number(projected.hud.desync || 0) === 0,
    tableApplyOk: !firstFail && bins.length > 0,
    cspIsProjectedK5Design:
      (projected.metaCsp || []).some((c) => c && c.includes("script-src 'none'")) ||
      consoleHits.cspScriptNone > 0,
  },
  projectedDom: projected,
  consoleHits,
  wireFromUiSession: {
    frameCount: bins.length,
    firstFail,
    lastOk,
    frameSummaries,
    finalTableRows: firstFail ? null : table.size,
  },
  virtualSession: {
    booted,
    navigated,
    snapshots: virtualSnaps,
    frameEmitted: frameEmitted.map((m) => ({
      sequence: m.sequence,
      generation: m.generation,
      tableSize: m.tableSize,
      identitySize: m.identitySize,
      opCount: m.opCount,
      bytes: m.bytes,
      resync: m.resync,
    })),
  },
  projectedSnapsFromWs: projectedSnaps,
  designNote_csp:
    "Projected K5 CSP is script-src 'none' by design (page JS must not run on Projected). Lab/ProjectionClient runs in parent page, not under that CSP. Console CSP lines are projected <script> nodes being blocked — expected noise, not evidence that our client is CSP-broken. Extension TypeErrors on about:srcdoc are browser-extension noise.",
};

fs.writeFileSync(path.join(OUT, 'oracle.json'), JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.error(`wrote ${OUT}/oracle.json`);

const broken =
  report.verdict.blankProjected ||
  report.verdict.wireThin ||
  !!firstFail ||
  virtualSnaps.length === 0;
process.exit(broken ? 2 : 0);
