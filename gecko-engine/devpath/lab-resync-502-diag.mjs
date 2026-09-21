#!/usr/bin/env node
/**
 * Diag: RESYNC reasons + SW 502 join chain (Beleza cold).
 * Não declara Fixed.
 *
 *   SPECULUM_ASSET_TRACE=1 node gecko-engine/devpath/lab-resync-502-diag.mjs [url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 50000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
const OUT =
  process.env.OUT_DIR ||
  path.join(ROOT, 'gecko-engine/devpath/captures', `resync-502-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });
const GECKO_TRACE = process.env.GECKO_ASSET_TRACE || '/tmp/speculum-asset-trace.ndjson';

function parseNdjson(text) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      /* skip */
    }
  }
  return events;
}

function urlKey(u) {
  return String(u || '').split('?')[0];
}

function classifyHex(hex) {
  const x = String(hex || '').toLowerCase();
  if (!x) return 'empty';
  if (x.startsWith('1f8b')) return 'gzip';
  if (x.startsWith('3c7376') || x.startsWith('3c3f78')) return 'svg_or_xml';
  if (x.startsWith('89504e47')) return 'png';
  if (x.startsWith('ffd8ff')) return 'jpeg';
  if (x.startsWith('474946')) return 'gif';
  if (x.includes('66747970') && (x.includes('61766966') || x.includes('61766973'))) return 'avif';
  if (x.startsWith('52494646') && x.includes('57454250')) return 'webp';
  if (/^[89a-f]/.test(x)) return 'likely_compressed_or_binary';
  return 'unknown';
}

let sameSResult = null;
const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response?.payloadData;
  if (!payload || params.response?.opcode !== 1) return;
  let msg;
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  if (msg.type === 'lab.sameSResult') {
    sameSResult = msg;
    fs.writeFileSync(path.join(OUT, 'same-s-raw.json'), JSON.stringify(msg));
  }
});

await page.goto(`${LAB}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('#connect');
await page.waitForFunction(() => !(document.getElementById('browseStart')?.disabled ?? true), null, {
  timeout: 90000,
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  globalThis.__SPECULUM_ASSET_TRACE = true;
  globalThis.__speculumEnableAssetTraceAll?.();
});
// Force SW update so 502 instrumentation is live.
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.update();
});
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  globalThis.__SPECULUM_ASSET_TRACE = true;
  globalThis.__speculumEnableAssetTraceAll?.();
});
await page.waitForTimeout(WAIT_MS);

const hud = await page.evaluate(() => {
  const text = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const activity = [...document.querySelectorAll('#activity > div')].map((d) => d.textContent || '');
  const resyncLines = activity.filter((t) => /resync requested/i.test(t));
  const desyncLines = activity.filter((t) => /\bdesync\b/i.test(t));
  const reasons = {};
  for (const line of resyncLines) {
    const m = /reason=([^\s]+)/i.exec(line);
    const r = m?.[1] || 'unknown';
    reasons[r] = (reasons[r] || 0) + 1;
  }
  return {
    frames: text('streamFrames'),
    generation: text('streamGeneration'),
    sequence: text('streamSequence'),
    applyOk: text('streamApplyOk'),
    desync: text('streamDesync'),
    resync: text('streamResync'),
    ovr: text('streamOvr') || text('streamOverflow'),
    resyncReasons: reasons,
    resyncLines: resyncLines.slice(0, 40),
    desyncLines: desyncLines.slice(0, 20),
    activitySample: activity.slice(0, 60),
  };
});

await page.locator('#browseSnap').evaluate((el) => el.click());
const deadline = Date.now() + 25000;
while (!sameSResult && Date.now() < deadline) {
  await page.waitForTimeout(250);
}
await browser.close();

const clientEvents = Array.isArray(sameSResult?.projected?.assetTrace)
  ? sameSResult.projected.assetTrace
  : [];
let geckoEvents = [];
try {
  geckoEvents = parseNdjson(fs.readFileSync(GECKO_TRACE, 'utf8'));
  fs.copyFileSync(GECKO_TRACE, path.join(OUT, 'gecko-asset-trace.ndjson'));
} catch {
  geckoEvents = [];
}
const merged = [...clientEvents, ...geckoEvents].sort((a, b) => Number(a.t) - Number(b.t));
fs.writeFileSync(
  path.join(OUT, 'trace.ndjson'),
  merged.map((e) => JSON.stringify(e)).join('\n') + (merged.length ? '\n' : ''),
);

const sw502 = merged.filter((e) => e.hop === 'sw.respond' && Number(e.status) === 502);
const sw404 = merged.filter((e) => e.hop === 'sw.respond' && Number(e.status) === 404);
const why502 = {};
for (const e of sw502) {
  const w = e.why || 'unknown';
  why502[w] = (why502[w] || 0) + 1;
}

const rows = [];
for (const e of sw502.slice(0, 40)) {
  const k = urlKey(e.url);
  const related = merged.filter((x) => urlKey(x.url) === k || (x.url && k && String(x.url).startsWith(k.slice(0, 80))));
  const join = related.filter((x) => x.hop === 'gecko.join').at(-1);
  const emit = related.filter((x) => x.hop === 'gecko.emit' && x.phase === 'complete').at(-1);
  const teeStop = related.find((x) => x.hop === 'gecko.tee' && x.event === 'tap_stop_ok');
  const teeEnsure = related.find((x) => x.hop === 'gecko.tee' && x.event === 'ensure');
  rows.push({
    url: String(e.url || '').slice(0, 220),
    swWhy: e.why || null,
    dest: e.dest || null,
    contentType: e.contentType || null,
    inputByteLength: e.inputByteLength ?? null,
    inputHeadHex: e.inputHeadHex || null,
    inputMagic: classifyHex(e.inputHeadHex || ''),
    joinPath: join?.path ?? null,
    teeComplete: teeStop ? true : !!teeEnsure,
    emitLen: emit?.dataLen ?? null,
    emitMime: emit?.mimeOnComplete || emit?.mime || null,
    emitHex: (emit?.bodyHeadHex || '').slice(0, 32) || null,
    emitMagic: classifyHex(emit?.bodyHeadHex || ''),
  });
}

// URL family mismatch: DOM asks f_svg/f_png, tee only has f_avif same basename
function basename(u) {
  try {
    return decodeURIComponent(urlKey(u).split('/').pop() || '');
  } catch {
    return urlKey(u).split('/').pop() || '';
  }
}
const mismatchSamples = [];
for (const r of rows) {
  const base = basename(r.url);
  if (!base) continue;
  const teeSameBase = geckoEvents.filter(
    (e) =>
      e.hop === 'gecko.tee' &&
      e.event === 'ensure' &&
      basename(e.url) === base &&
      urlKey(e.url) !== urlKey(r.url),
  );
  if (teeSameBase.length) {
    mismatchSamples.push({
      requested: r.url.slice(0, 180),
      teeOtherTransforms: teeSameBase.slice(0, 3).map((e) => String(e.url).slice(0, 180)),
    });
  }
}

const rootCause = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  hud,
  resync: {
    count: Number(hud.resync || 0),
    desyncHud: hud.desync,
    reasons: hud.resyncReasons,
    hypothesis:
      Object.keys(hud.resyncReasons || {}).length === 0
        ? 'no_resync_lines_in_activity'
        : Object.entries(hud.resyncReasons).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
  },
  assets502: {
    count: sw502.length,
    whyBuckets: why502,
    status404: sw404.length,
    rows,
    urlTransformMismatchSamples: mismatchSamples.slice(0, 12),
  },
  nextFixHints: [],
};

if (rootCause.resync.hypothesis && rootCause.resync.hypothesis !== 'no_resync_lines_in_activity') {
  rootCause.nextFixHints.push({
    id: 'resync',
    cause: rootCause.resync.hypothesis,
    fixHint: `ProjectionClient desync/resync por reason=${rootCause.resync.hypothesis} — corrigir esse caminho (não maquiar contador).`,
  });
}
if ((why502.sniff_reject || 0) > 0) {
  rootCause.nextFixHints.push({
    id: '502_sniff',
    cause: 'sw_sniff_reject',
    fixHint: 'Corpo chegou mas looksLikeImageBody rejeitou — ver inputMagic/CT nas rows.',
  });
}
if ((why502.empty_body || 0) > 0) {
  rootCause.nextFixHints.push({
    id: '502_empty',
    cause: 'sw_empty_body',
    fixHint: 'Join devolveu bytes vazios com CT image/* — race tee incompleto ou open vazio.',
  });
}
if (mismatchSamples.length) {
  rootCause.nextFixHints.push({
    id: 'url_transform_mismatch',
    cause: 'dom_url_vs_virtual_tee_different_cloudinary_transform',
    fixHint:
      'Projected pede f_svg/f_png; Virtual teeou f_avif (mesmo basename). Plano de ativos: mesma URL do DOM ou Accept alinhado.',
  });
}

fs.writeFileSync(path.join(OUT, 'root-cause.json'), JSON.stringify(rootCause, null, 2));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rootCause, null, 2));
console.log(JSON.stringify(rootCause, null, 2));
process.exit(0);
