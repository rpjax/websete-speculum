#!/usr/bin/env node
/**
 * Asset H5 absolute diag — Beleza cold → same-S → dossier + verdict V1–V10.
 * Não declara Fixed. Exit ≠0 se V8 false ou unknown em V1–V7.
 *
 *   node gecko-engine/devpath/lab-asset-h5-trace.mjs [url]
 *   WAIT_MS=45000 OUT_DIR=... node …
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import patchright from '../../sidecar/node_modules/patchright/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const LAB = (process.env.SPECULUM_LAB_URL || 'http://127.0.0.1:4077').replace(/\/$/, '');
const URL = process.argv[2] || 'https://www.belezanaweb.com.br/';
const WAIT_MS = Number(process.env.WAIT_MS || 45000);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
const OUT =
  process.env.OUT_DIR ||
  path.join(ROOT, 'gecko-engine/devpath/captures', `asset-h5-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });

const GECKO_TRACE = process.env.GECKO_ASSET_TRACE || '/tmp/speculum-asset-trace.ndjson';

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

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

function isLogo(url) {
  return /logo\.svg/i.test(String(url || ''));
}

function startsImageMime(m) {
  return String(m || '')
    .toLowerCase()
    .split(';')[0]
    .trim()
    .startsWith('image/');
}

function looksSvgOrImageHead(head) {
  const h = String(head || '');
  const low = h.toLowerCase();
  if (low.includes('<svg') || low.includes('<!doctype svg')) return true;
  // Magic via BodyHeadAscii: printable only — PNG/JPEG/GIF/WEBP leave distinctive starts
  if (h.startsWith('\x89PNG') || h.startsWith('PNG') || low.startsWith('‰png')) return true;
  if (h.startsWith('GIF8')) return true;
  if (h.startsWith('RIFF') && h.includes('WEBP')) return true;
  // JPEG SOI is non-printable → BodyHeadAscii shows ".." — not enough alone
  return false;
}

function firstFalse(verdict) {
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10']) {
    if (verdict[id] === false) return id;
    if (
      verdict[id] === 'unknown' &&
      ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'].includes(id)
    ) {
      return id;
    }
  }
  return null;
}

function evaluateVerdict(events, layoutProbe) {
  const logo = events.filter((e) => isLogo(e.url));
  const swIntercept = logo.filter((e) => e.hop === 'sw.intercept');
  const labReq = logo.filter((e) => e.hop === 'lab.request');
  const joins = logo.filter((e) => e.hop === 'gecko.join');
  const emits = logo.filter((e) => e.hop === 'gecko.emit');
  const labRes = logo.filter((e) => e.hop === 'lab.response');
  const swRes = logo.filter((e) => e.hop === 'sw.respond');
  const imgStates = logo.filter((e) => e.hop === 'img.state');
  const imgEarly = imgStates.filter((e) => e.event === 'load' || e.event === 'error');
  const imgSame = imgStates.filter((e) => e.event === 'sameS');

  const firstImg = imgEarly[0] || imgSame[0] || null;
  const firstIntercept = swIntercept[0] || null;
  const firstLabReq = labReq[0] || null;
  const firstJoin = joins[0] || null;
  const completeEmits = emits.filter((e) => e.phase === 'complete');
  const firstComplete = completeEmits[0] || null;
  const firstLabComplete = labRes.find((e) => e.phase === 'complete') || null;
  const firstSwOk = swRes.find((e) => e.status === 200 || e.status === 206) || swRes[0] || null;

  const V1 =
    !firstIntercept
      ? 'unknown'
      : !imgEarly[0]
        ? true
        : Number(firstIntercept.t) <= Number(imgEarly[0].t);

  const V2 = !firstLabReq
    ? 'unknown'
    : Number(firstLabReq.contextId) === 1;

  const V3 = !firstJoin
    ? 'unknown'
    : firstJoin.path !== 'denied_pre';

  let V4 = 'unknown';
  if (firstComplete) {
    const dataLen = Number(firstComplete.dataLen ?? 0);
    const head = String(firstComplete.bodyHead || '');
    V4 = dataLen > 0 && looksSvgOrImageHead(head);
  }

  const mimeOnComplete = firstComplete?.mimeOnComplete || firstComplete?.mime || '';
  const mimeOut = firstLabComplete?.mimeOut || '';
  const V5 = !firstComplete && !firstLabComplete
    ? 'unknown'
    : startsImageMime(mimeOut || mimeOnComplete);

  const V6 = !firstSwOk
    ? 'unknown'
    : Number(firstSwOk.status) === 200 && firstSwOk.looksLikeImage === true;

  const shaG = firstComplete?.bodySha16;
  const shaL = firstLabComplete?.bodySha16;
  const shaS = firstSwOk?.bodySha16;
  const V7 =
    !shaG || !shaL || !shaS
      ? 'unknown'
      : shaG === shaL && shaL === shaS;

  const firstNw = firstImg?.naturalWidth;
  const V8 = firstImg == null ? 'unknown' : Number(firstNw) > 0;

  const logoFromLayout =
    layoutProbe?.logo ??
    (Array.isArray(layoutProbe?.imgsSample)
      ? layoutProbe.imgsSample.find((i) => isLogo(i.src || i.currentSrc || ''))
      : null);
  const sameNw =
    imgSame[0]?.naturalWidth ??
    logoFromLayout?.naturalWidth ??
    null;
  const sameNwN = sameNw == null ? null : Number(sameNw);
  let V9 = 'unknown';
  if (sameNwN != null) {
    if (sameNwN > 0) {
      V9 = true;
    } else if (V4 === true && V6 === true && V7 === true) {
      V9 = false; // sticky decode / memory cache (not missing MIME)
    } else {
      V9 = false;
    }
  }

  const teeKeys = logo
    .filter((e) => e.hop === 'gecko.tee' || e.hop === 'gecko.join' || e.hop === 'lab.request')
    .map((e) => ({
      hop: e.hop,
      contextId: e.contextId,
      url: e.url,
      range: e.range ?? '',
      path: e.path,
      event: e.event,
    }));
  const reqKey = firstLabReq
    ? `${firstLabReq.contextId}\n${firstLabReq.url}\n${firstLabReq.range || ''}`
    : null;
  const emitJoin = joins.find((e) => e.path === 'emit_complete' || e.path === 'wait' || e.path === 'open');
  const emitKey = emitJoin
    ? `${emitJoin.contextId}\n${emitJoin.url}\n${emitJoin.range || ''}`
    : null;
  const V10 =
    !reqKey || !emitKey
      ? 'unknown'
      : reqKey === emitKey;

  return {
    V1,
    V2,
    V3,
    V4,
    V5,
    V6,
    V7,
    V8,
    V9,
    V10,
    evidence: {
      swInterceptCount: swIntercept.length,
      labReqCount: labReq.length,
      joinPaths: joins.map((j) => j.path),
      emitPhases: emits.map((e) => e.phase),
      firstComplete: firstComplete
        ? {
            dataLen: firstComplete.dataLen,
            mimeOnComplete: firstComplete.mimeOnComplete || firstComplete.mime,
            bodySha16: firstComplete.bodySha16,
            bodyHead: firstComplete.bodyHead,
            sniffApplied: firstComplete.sniffApplied,
            looksSvgOrImage: looksSvgOrImageHead(firstComplete.bodyHead),
          }
        : null,
      labResponse: firstLabComplete
        ? {
            mimeIn: firstLabComplete.mimeIn,
            mimeOut: firstLabComplete.mimeOut,
            chunkTotal: firstLabComplete.chunkTotal,
            bodySha16: firstLabComplete.bodySha16,
            bodyHead: firstLabComplete.bodyHead,
          }
        : null,
      swRespond: firstSwOk
        ? {
            status: firstSwOk.status,
            looksLikeImage: firstSwOk.looksLikeImage,
            bodySha16: firstSwOk.bodySha16,
            byteLength: firstSwOk.byteLength,
          }
        : null,
      firstImgState: firstImg || null,
      sameSImg: imgSame[0] || null,
      sameNw: sameNwN,
      teeKeys,
      sha: { gecko: shaG || null, lab: shaL || null, sw: shaS || null },
    },
  };
}

// --- run ---
try {
  fs.unlinkSync(GECKO_TRACE);
} catch {
  /* ok */
}

const { chromium } = patchright;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let sameSResult = null;
const assetConsole = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[gecko-asset]') || t.includes('asset')) assetConsole.push(t.slice(0, 300));
});
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
await page.waitForTimeout(400);
await page.evaluate((url) => {
  const u = document.getElementById('url');
  u.value = url;
  u.dispatchEvent(new Event('input', { bubbles: true }));
}, URL);
await page.click('button:has-text("Start Virtual")');
await page.waitForTimeout(WAIT_MS);
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
const logoEvents = merged.filter((e) => isLogo(e.url));

const tracePath = path.join(OUT, 'trace.ndjson');
fs.writeFileSync(tracePath, merged.map((e) => JSON.stringify(e)).join('\n') + (merged.length ? '\n' : ''));
fs.writeFileSync(
  path.join(OUT, 'logo-first.json'),
  JSON.stringify(logoEvents, null, 2),
);

const layoutProbe = sameSResult?.projected?.layoutProbe ?? null;
const sameSSlim = {
  ok: sameSResult?.ok ?? false,
  error: sameSResult?.error ?? (sameSResult ? null : 'no_lab_sameSResult'),
  sameSequence: sameSResult?.sameSequence ?? null,
  virtualSequence: sameSResult?.virtualSequence ?? null,
  projectedSequence: sameSResult?.projectedSequence ?? null,
  layoutProbe: layoutProbe
    ? {
        headerHeight: layoutProbe.headerHeight ?? layoutProbe.header?.height ?? null,
        brokenImgs: layoutProbe.brokenImgs ?? null,
        logo:
          layoutProbe.imgsSample?.find?.((i) => isLogo(i.src || i.currentSrc || '')) ?? null,
        imgsSample: (layoutProbe.imgsSample || []).slice(0, 4),
      }
    : null,
  assetTraceCount: clientEvents.length,
  geckoTraceCount: geckoEvents.length,
};
fs.writeFileSync(path.join(OUT, 'same-s.json'), JSON.stringify(sameSSlim, null, 2));

const verdict = evaluateVerdict(merged, layoutProbe);
const firstBad = firstFalse(verdict);
verdict.firstFalse = firstBad;
verdict.classification =
  verdict.V4 === true &&
  verdict.V6 === true &&
  verdict.V7 === true &&
  verdict.V8 === false
    ? 'sticky_decode_or_memory_cache'
    : firstBad
      ? `break_at_${firstBad}`
      : 'all_true_or_v9_interpret';

fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(verdict, null, 2));

let labBuildStamp = null;
try {
  labBuildStamp = readJsonSafe(
    path.join(ROOT, 'sidecar/browser/mirror/projection/lab/static/labBuildStamp.json'),
  );
} catch {
  /* */
}

let libxul = null;
try {
  const p = '/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/libxul.so';
  const st = fs.statSync(p);
  const hash = createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
  libxul = { path: p, mtimeMs: st.mtimeMs, sha16: hash };
} catch {
  /* */
}

let commit = null;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* */
}

const manifest = {
  url: URL,
  waitMs: WAIT_MS,
  outDir: OUT,
  labBuildStamp,
  libxul,
  commit,
  geckoTracePath: GECKO_TRACE,
  counts: {
    merged: merged.length,
    logo: logoEvents.length,
    client: clientEvents.length,
    gecko: geckoEvents.length,
  },
  firstFalse: firstBad,
};
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

const summary = {
  ok: firstBad == null && verdict.V8 === true,
  firstFalse: firstBad,
  classification: verdict.classification,
  outDir: OUT,
  verdict: {
    V1: verdict.V1,
    V2: verdict.V2,
    V3: verdict.V3,
    V4: verdict.V4,
    V5: verdict.V5,
    V6: verdict.V6,
    V7: verdict.V7,
    V8: verdict.V8,
    V9: verdict.V9,
    V10: verdict.V10,
  },
  sameS: sameSSlim,
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const unknownEarly = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'].some(
  (k) => verdict[k] === 'unknown',
);
const fail = firstBad != null || unknownEarly || !sameSResult || verdict.V8 === false;
process.exit(fail ? 2 : 0);
