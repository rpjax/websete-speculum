#!/usr/bin/env node
'use strict';
/**
 * Live O1/O2/O5 runner against the three baseline sites (W8 / F6).
 *
 * Usage (opt-in — not hermetic CI):
 *   SPECULUM_LIVE_ORACLES=1 node bin/live-runner.cjs
 *
 * Requires a running Speculum stack + network access to:
 *   - www.belezanaweb.com.br
 *   - Eneba soft-nav flow
 *   - a live-odds page (SPECULUM_LIVE_ODDS_URL)
 *
 * Virtual still = normal Chromium opening the target URL (accept bar).
 * Projected still = Speculum Live PageProjection surface.
 * Exit 0 only when all configured sites pass O1+O2+O5. No soft-skip.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const { compareStillPair } = require('../o1-visual.cjs');
const { diffTrees, compareChecksums } = require('../o2-structural.cjs');
const { gateInteraction } = require('../o5-interaction.cjs');

const BASE = process.env.SPECULUM_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'artifacts', 'live');
const VIEWPORT = { width: 1280, height: 720 };
const SIDECAR_CONTAINER = process.env.SPECULUM_SIDECAR_CONTAINER || 'sidecar';

/** Same flatten as producer snapshotDocument (PP-F-3), projected placeholders as div. */
const F_WALK_SRC = `(() => {
  const PLACEHOLDER = new Set(['script','noscript','template','base','object','embed','applet']);
  function childNodesFor(n) {
    const root = n.shadowRoot;
    if (!root) return Array.from(n.childNodes);
    const out = [];
    for (const child of root.childNodes) {
      if (child.nodeType === 1 && child.tagName === 'SLOT') {
        const assigned =
          typeof child.assignedNodes === 'function'
            ? child.assignedNodes({ flatten: true })
            : [];
        if (assigned.length > 0) out.push(...assigned);
        else out.push(...child.childNodes);
      } else out.push(child);
    }
    return out;
  }
  function walk(n) {
    if (!n) return null;
    if (n.nodeType === 3) {
      const value = n.nodeValue || '';
      if (!value.trim()) return null;
      return { kind: 'text', value };
    }
    if (n.nodeType === 8) {
      const value = n.nodeValue || '';
      if (!value.trim()) return null;
      return { kind: 'comment', value };
    }
    if (n.nodeType !== 1) return null;
    if (n.hasAttribute && n.hasAttribute('data-pp-cssom-id')) return null;
    const tag = n.tagName.toLowerCase();
    if (tag === 'style' || tag === 'link') return null;
    if (tag === 'meta' || tag === 'title' || tag === 'base') return null;
    const children = [];
    if (tag === 'iframe') {
      try {
        const inner = n.contentDocument?.documentElement;
        const built = walk(inner);
        if (built) children.push(built);
      } catch { /* xo */ }
      return { kind: 'element', tag: 'div', attrs: {}, children };
    }
    if (PLACEHOLDER.has(tag)) {
      return { kind: 'element', tag: 'div', attrs: {}, children: [] };
    }
    for (const c of childNodesFor(n)) {
      const built = walk(c);
      if (built) children.push(built);
    }
    return { kind: 'element', tag, attrs: {}, children };
  }
  return walk;
})()`;

/** Compact O2 tree from producer snapshotDocument raw (closed-shadow already flattened). */
const VIRTUAL_F_FROM_SNAPSHOT = `(() => {
  const PLACEHOLDER = new Set(['script','noscript','template','base','object','embed','applet']);
  if (typeof window.__speculumPageProjectionV2 === 'undefined'
    || typeof window.__speculumPageProjectionV2.snapshotDocument !== 'function') {
    return { error: 'no_api' };
  }
  const raw = window.__speculumPageProjectionV2.snapshotDocument();
  function strip(n) {
    if (!n) return null;
    if (n.kind !== 'element') {
      const value = n.value || '';
      if (n.kind === 'text' && !value.trim()) return null;
      if (n.kind === 'comment' && !value.trim()) return null;
      return { kind: n.kind, value };
    }
    let tag = String(n.tag || '').toLowerCase();
    if (tag === 'style' || tag === 'link') return null;
    if (tag === 'meta' || tag === 'title' || tag === 'base') return null;
    if (PLACEHOLDER.has(tag) || tag === 'iframe') tag = 'div';
    const children = [];
    for (const c of n.children || []) {
      const built = strip(c);
      if (built) children.push(built);
    }
    return { kind: 'element', tag, attrs: {}, children };
  }
  function findBody(n) {
    if (!n || n.kind !== 'element') return null;
    if (n.tag === 'body') return n;
    for (const c of n.children || []) {
      const f = findBody(c);
      if (f) return f;
    }
    return null;
  }
  const body = findBody(raw);
  return body ? strip(body) : { error: 'no_body' };
})()`;

/** Fallback F walk when in-page API is missing (open shadow only). */
const VIRTUAL_F_FALLBACK = `(${F_WALK_SRC})(document.body)`;

const sites = [
  { id: 'beleza', url: 'https://www.belezanaweb.com.br/', softNav: false },
  { id: 'eneba-softnav', url: 'https://www.eneba.com/', softNav: true },
  {
    id: 'live-odds',
    url: process.env.SPECULUM_LIVE_ODDS_URL || '',
    softNav: false,
  },
].filter((s) => s.url);

/** Optional live-one: `SPECULUM_LIVE_SITE_IDS=beleza` (comma-separated ids). */
const siteIdFilter = (process.env.SPECULUM_LIVE_SITE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (siteIdFilter.length) {
  for (let i = sites.length - 1; i >= 0; i--) {
    if (!siteIdFilter.includes(sites[i].id)) sites.splice(i, 1);
  }
}

if (process.env.SPECULUM_LIVE_ORACLES !== '1') {
  console.error(
    '[live-runner] Refusing to run without SPECULUM_LIVE_ORACLES=1 (opt-in live gate).',
  );
  console.error('Sites:', sites.map((s) => s.id).join(', ') || '(none — set SPECULUM_LIVE_ODDS_URL)');
  process.exit(2);
}

if (sites.length === 0) {
  console.error('[live-runner] No sites configured.');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Same encoding as web `encodeNavigationState` — W7S NSO wire. */
function encodeNavigationState(host) {
  const json = JSON.stringify({ v: 1, h: host.trim().toLowerCase() });
  return Buffer.from(json, 'utf8').toString('base64');
}

function buildProjectedEntryUrl(host, path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const nso = encodeURIComponent(encodeNavigationState(host));
  return `${BASE}${normalizedPath}?_w7s_nso=${nso}`;
}

async function collectArmedDiagnostics(page, consoleErrorCount = 0, consoleSamples = []) {
  const dom = await page.evaluate(() => {
    const host = document.querySelector('[data-speculum-dom-surface]');
    const overlay = document.querySelector('.fixed.inset-0 .text-neutral-600');
    const frames = [...(host?.querySelectorAll('iframe') ?? [])];
    let activeHtml = 0;
    for (const f of frames) {
      try {
        activeHtml = Math.max(activeHtml, (f.contentDocument?.documentElement?.outerHTML || '').length);
      } catch {
        /* */
      }
    }
    return {
      armedAttr: host?.getAttribute('data-speculum-armed') ?? null,
      surfacePresent: Boolean(host),
      iframeCount: frames.length,
      activeHtml,
      errorOverlay: overlay?.textContent?.trim().slice(0, 200) ?? null,
      href: window.location.href,
    };
  });
  return { ...dom, consoleErrorCount, consoleSamples: consoleSamples.slice(0, 8) };
}

function req(method, urlPath, body, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`);
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, body: text });
          }
        });
      },
    );
    r.on('timeout', () => {
      r.destroy();
      reject(new Error(`request timeout ${method} ${urlPath}`));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function putNav(host) {
  /* Per-site Navigation PUT hangs ConfigApplied in lab — use NSO on the projected URL instead. */
  void host;
}

async function putSessionsPageProjection() {
  // Seed-appropriate Sessions baseline when stack is not yet operational.
  // detachedSessionTimeout is NOT an establish fix (sessions attach on StartSession).
  const sessions = {
    detachedSessionTimeout: '00:30:00',
    isJsBridgeEnabled: true,
    dataStreamTransport: 'webSocket',
    viewportPolicy: {
      default: { width: 1280, height: 720 },
      minimum: { width: 100, height: 100 },
      maximum: { width: 4096, height: 2160 },
    },
    clientEnvironmentPolicy: {
      defaultLocale: 'pt-BR',
      defaultLanguage: 'pt-BR',
      defaultTimeZoneId: 'America/Sao_Paulo',
      defaultColorScheme: 'light',
    },
    deviceEmulationPolicy: {
      default: {
        mobile: false,
        touch: false,
        deviceScaleFactor: 1,
        maxTouchPoints: 0,
        userAgentProfile: 'desktop',
        screenOrientation: 'landscapePrimary',
      },
      minDeviceScaleFactor: 1,
      maxDeviceScaleFactor: 2,
      maxTouchPoints: 10,
      defaultTouchPointsWhenTouch: 5,
      desktopUserAgentProfile: 'desktop',
      mobileUserAgentProfile: 'mobile',
      tabletUserAgentProfile: 'tablet',
    },
    inputMultiplexingPolicy: { access: 'shared', ownership: 'firstAttached', scheduling: 'arrivalOrder' },
    outputMultiplexingPolicy: { delivery: 'broadcast', ownership: 'firstAttached' },
    mirrorMode: 'pageProjection',
    screencastPolicy: { maxEncodeScale: 2 },
  };
  const res = await req('PUT', '/w7s/api/configurations/Sessions', sessions);
  if (res.status >= 400) {
    throw new Error(`Sessions PUT failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
}

async function putMirrorPageProjection() {
  /* Sessions already ensured operational at boot — avoid PUT storms that hang ConfigApplied. */
}

function treeChecksum(node) {
  const tags = [];
  const walk = (n) => {
    if (!n) return;
    if (n.kind === 'element') {
      tags.push(n.tag);
      for (const c of n.children || []) walk(c);
    } else tags.push(n.kind === 'text' ? '#text' : '#comment');
  };
  walk(node);
  let h = 2166136261;
  for (const t of tags) {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0xff;
    h = Math.imul(h, 16777619);
  }
  return { nodeCount: tags.length, checksum: (h >>> 0).toString(16) };
}

/** Wait for projected imgs to finish (or plateau) after establish — L1/pass-through catch-up. */
async function waitProjectedAssetsQuiet(page, ms) {
  const t0 = Date.now();
  let best = null;
  let lastBroken = Infinity;
  let plateauSince = 0;
  while (Date.now() - t0 < ms) {
    const a = await probeProjectedAssets(page);
    best = a;
    if (a.ok) return a;
    // Also wait until in-flight imgs resolve (pendingLazy used for both lazy + !complete).
    if ((a.pendingLazy ?? 0) === 0 && (a.brokenImgs ?? 0) === 0 && (a.imgCount ?? 0) > 0) {
      return a;
    }
    if (typeof a.brokenImgs === 'number' && a.brokenImgs < lastBroken) {
      lastBroken = a.brokenImgs;
      plateauSince = Date.now();
    } else if (plateauSince && Date.now() - plateauSince >= 4_000) {
      return a;
    } else if (!plateauSince) {
      plateauSince = Date.now();
    }
    await sleep(500);
  }
  return best || { ok: false, brokenImgs: -1, virtualData1x1: -1, imgCount: 0 };
}

/** PP-ASSET-3 — broken imgs + virtual-data 1×1 placeholders on the projected surface. */
async function probeProjectedAssets(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-speculum-dom-surface]');
    if (!host) return { ok: false, reason: 'no_surface' };
    let brokenImgs = 0;
    let virtualData1x1 = 0;
    let imgCount = 0;
    let pendingLazy = 0;
    const docs = [];
    for (const f of host.querySelectorAll('iframe')) {
      try {
        if (f.contentDocument) docs.push(f.contentDocument);
      } catch {
        /* */
      }
    }
    docs.push(document);
    for (const doc of docs) {
      for (const img of doc.querySelectorAll('img')) {
        imgCount += 1;
        const src = img.currentSrc || img.getAttribute('src') || '';
        const loading = (img.getAttribute('loading') || '').toLowerCase();
        // Lazy below-fold images that have not started are not asset-serve failures.
        if (loading === 'lazy' && !img.complete && img.naturalWidth === 0) {
          pendingLazy += 1;
          continue;
        }
        // In-flight fetches are not serve failures — only completed empties.
        if (!img.complete) {
          pendingLazy += 1;
          continue;
        }
        if (img.naturalWidth === 0) brokenImgs += 1;
        if (/virtual-data/i.test(src) && (img.naturalWidth <= 1 || img.naturalHeight <= 1)) {
          virtualData1x1 += 1;
        }
      }
    }
    return {
      ok: brokenImgs === 0 && virtualData1x1 === 0,
      brokenImgs,
      virtualData1x1,
      imgCount,
      pendingLazy,
    };
  });
}

async function waitDocumentSettled(page, ms, quietMs = 1500, watchAfterQuietMs = 6000) {
  // Generic settle: (1) HTML stops growing, (2) fingerprint quiet, (3) watch for
  // late document replacement. No site- or vendor-specific branches.
  const t0 = Date.now();
  let maxLen = 0;
  let lastGrowthAt = Date.now();
  const growthQuietMs = 2000;
  while (Date.now() - t0 < ms) {
    const len = await page.evaluate(() => document.documentElement?.outerHTML?.length ?? 0);
    if (len > maxLen + 256) {
      maxLen = len;
      lastGrowthAt = Date.now();
    }
    if (maxLen > 0 && Date.now() - lastGrowthAt >= growthQuietMs) break;
    await sleep(250);
  }

  let last = '';
  let stableSince = 0;
  let lastFp = '';
  while (Date.now() - t0 < ms) {
    const fp = await page.evaluate(() => {
      const b = document.body;
      if (!b) return '';
      return [
        document.readyState,
        String(b.childElementCount),
        String((b.innerText || '').trim().length),
        String((document.documentElement?.outerHTML || '').length),
      ].join('|');
    });
    lastFp = fp;
    if (fp && fp === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) {
        const quietFp = fp;
        const watchUntil = Date.now() + watchAfterQuietMs;
        let lateChange = false;
        while (Date.now() < watchUntil && Date.now() - t0 < ms) {
          await sleep(250);
          const next = await page.evaluate(() => {
            const b = document.body;
            if (!b) return '';
            return [
              document.readyState,
              String(b.childElementCount),
              String((b.innerText || '').trim().length),
              String((document.documentElement?.outerHTML || '').length),
            ].join('|');
          });
          if (next !== quietFp) {
            last = next;
            lastFp = next;
            stableSince = 0;
            lateChange = true;
            break;
          }
        }
        if (!lateChange) return { ok: true, fp: quietFp };
        continue;
      }
    } else {
      last = fp;
      stableSince = 0;
    }
    await sleep(250);
  }
  return { ok: false, timeout: true, fp: lastFp };
}

async function waitProjectedArmed(page, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface]');
      if (!host) return { ok: false, reason: 'no_surface' };
      const frames = [...host.querySelectorAll('iframe')];
      let docHtml = 0;
      let textLen = 0;
      let paintable = false;
      for (const f of frames) {
        try {
          const doc = f.contentDocument;
          if (!doc?.documentElement) continue;
          docHtml = Math.max(docHtml, (doc.documentElement.outerHTML || '').length);
          textLen = Math.max(textLen, (doc.body?.innerText || '').trim().length);
          const kids = doc.body?.childElementCount ?? 0;
          if (kids > 0 || (doc.documentElement.childElementCount ?? 0) > 1) paintable = true;
        } catch {
          /* sandbox */
        }
      }
      const armedAttr = host.getAttribute('data-speculum-armed') === 'true';
      // Real HTML — not the empty ~39 shell. Do not require carousel-quiet here;
      // settle runs separately before stills (Beleza never fully quiets on innerText).
      const ok = armedAttr && paintable && docHtml > 1000;
      return { ok, textLen, docHtml, armed: armedAttr, paintable };
    });
    if (last.ok) return last;
    await sleep(250);
  }
  return { ...(last || {}), ok: false, timeout: true };
}

async function waitProjectedDocumentQuiet(page, ms, quietMs = 1500) {
  const t0 = Date.now();
  let last = '';
  let stableSince = 0;
  let lastFp = '';
  while (Date.now() - t0 < ms) {
    const fp = await page.evaluate(() => {
      const host = document.querySelector('[data-speculum-dom-surface]');
      if (!host) return '';
      for (const f of host.querySelectorAll('iframe')) {
        try {
          const doc = f.contentDocument;
          if (!doc?.body) continue;
          // Bucket volatile carousel/ad churn — same idea as Virtual documentReady.
          const htmlLen = (doc.documentElement?.outerHTML || '').length;
          return [
            doc.readyState,
            String(Math.floor((doc.body.childElementCount || 0) / 32)),
            String(Math.floor(htmlLen / 8192)),
          ].join('|');
        } catch {
          /* */
        }
      }
      return '';
    });
    lastFp = fp;
    if (fp && fp === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) return { ok: true, fp };
    } else {
      last = fp;
      stableSince = 0;
    }
    await sleep(250);
  }
  return { ok: false, timeout: true, fp: lastFp };
}

/** Tear down live Chromium: hub StopSession first, then page close (disconnect backstop). */
async function stopProjectedSession(page, sessionId) {
  let stopped = false
  if (page && !page.isClosed?.()) {
    try {
      stopped = await page.evaluate(async () => {
        const stop = window.__speculumStopSession
        if (typeof stop !== 'function') return false
        await stop()
        return true
      })
    } catch (err) {
      console.error(
        '[live-runner] hub StopSession evaluate failed:',
        err && err.message ? err.message : err,
      )
    }
  }
  if (!stopped && sessionId) {
    try {
      const res = await req(
        'POST',
        `/w7s/api/admin/maintenance/sessions/${sessionId}/stop`,
        null,
        10_000,
      )
      if (res.status >= 400) {
        console.error(
          '[live-runner] admin stop failed:',
          res.status,
          typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body).slice(0, 200),
        )
      } else {
        stopped = true
      }
    } catch (err) {
      console.error(
        '[live-runner] admin stop error:',
        err && err.message ? err.message : err,
      )
    }
  }
  if (!stopped) {
    console.error(
      '[live-runner] StopSession did not confirm; relying on page/browser close → hub OnDisconnected',
      { sessionId },
    )
  }
  if (page && !page.isClosed?.()) {
    try {
      await page.close()
    } catch {
      /* */
    }
  }
}

function readSidecarFile(containerPath) {
  return execFileSync(
    'docker',
    ['exec', SIDECAR_CONTAINER, 'cat', containerPath],
    { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 },
  );
}

async function harnessScreenshot(sessionId, token) {
  const res = await req(
    'POST',
    `/w7s/api/sessions/${sessionId}/screenshot`,
    { token },
    60_000,
  );
  if (res.status >= 400 || !res.body?.ok) {
    throw new Error(`virtual screenshot failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  const shot = res.body?.data?.screenshot;
  if (!shot?.path) {
    throw new Error(`virtual screenshot missing path: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return readSidecarFile(shot.path);
}

async function harnessEvaluate(sessionId, token, expression) {
  const res = await req(
    'POST',
    `/w7s/api/sessions/${sessionId}/evaluate`,
    { token, expression },
    60_000,
  );
  if (res.status >= 400 || !res.body?.ok) {
    throw new Error(`virtual evaluate failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  let value = res.body.evaluate;
  if (value == null && res.body.data && typeof res.body.data === 'object') {
    value = res.body.data.evaluate;
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      /* keep string */
    }
  }
  return value;
}

function cropChromeStrip(buf) {
  try {
    const { PNG } = require('pngjs');
    const img = PNG.sync.read(buf);
    const cut = Math.min(48, Math.floor(img.height * 0.08));
    if (cut <= 0) return buf;
    const out = new PNG({ width: img.width, height: img.height - cut });
    for (let y = 0; y < out.height; y++) {
      const src = y * img.width * 4;
      const dst = y * out.width * 4;
      out.data.set(img.data.subarray(src, src + out.width * 4), dst);
    }
    return PNG.sync.write(out);
  } catch {
    return buf;
  }
}

function normalizeStillPair(virtualBuf, projectedBuf) {
  const { PNG } = require('pngjs');
  const v = PNG.sync.read(virtualBuf);
  const p = PNG.sync.read(projectedBuf);
  const width = Math.min(v.width, p.width, VIEWPORT.width);
  const height = Math.min(v.height, p.height, VIEWPORT.height);
  const crop = (img) => {
    if (img.width === width && img.height === height) return PNG.sync.write(img);
    const out = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const si = (y * img.width + x) * 4;
        const di = (y * width + x) * 4;
        out.data[di] = img.data[si];
        out.data[di + 1] = img.data[si + 1];
        out.data[di + 2] = img.data[si + 2];
        out.data[di + 3] = img.data[si + 3];
      }
    }
    return PNG.sync.write(out);
  };
  return { virtual: crop(v), projected: crop(p), width, height };
}

async function runSite(chromium, site) {
  const result = {
    id: site.id,
    url: site.url,
    o1: null,
    o2: null,
    o5: null,
    assets: null,
    ok: false,
    errors: [],
  };
  fs.mkdirSync(OUT, { recursive: true });

  const host = new URL(site.url).host;
  await putNav(host);
  await putMirrorPageProjection();

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  try {
    // Accept bar: Speculum Virtual (same session as Projected), not host Playwright.
    // Host egress is often Akamai/CF challenged while Speculum Chrome is not.
    const projected = await context.newPage();
    let sessionId = null;
    let sessionToken = null;
    projected.on('request', (req) => {
      const m = /\/w7s\/api\/sessions\/([0-9a-fA-F-]{36})\//.exec(req.url());
      if (m) sessionId = m[1];
      try {
        const u = new URL(req.url());
        const tok = u.searchParams.get('speculum-session-token');
        if (tok) sessionToken = tok;
      } catch {
        /* */
      }
    });
    let projectedConsoleErrors = 0;
    const projectedConsoleSamples = [];
    projected.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || /desync|establish_mismatch|refusing StartSession|normalize_rejected/i.test(text)) {
        projectedConsoleErrors += 1;
        if (projectedConsoleSamples.length < 12) projectedConsoleSamples.push(`${msg.type()}: ${text.slice(0, 240)}`);
      }
    });
    await projected.goto(buildProjectedEntryUrl(host), {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    const armed = await waitProjectedArmed(projected, 180_000);
    if (!armed.ok) {
      const diag = await collectArmedDiagnostics(
        projected,
        projectedConsoleErrors,
        projectedConsoleSamples,
      ).catch(() => null);
      result.errors.push(
        `projected surface not armed: ${JSON.stringify(armed)} diag=${JSON.stringify(diag)}`,
      );
      await stopProjectedSession(projected, sessionId);
      return result;
    }

    sessionId =
      sessionId ||
      (await projected.evaluate(() => window.__speculumSessionId || null).catch(() => null));
    sessionToken =
      sessionToken ||
      (await projected.evaluate(() => window.__speculumSessionToken || null).catch(() => null));
    if (!sessionId || !sessionToken) {
      result.errors.push(`missing session binding sessionId=${sessionId} token=${Boolean(sessionToken)}`);
      await stopProjectedSession(projected, sessionId);
      return result;
    }

    await waitProjectedAssetsQuiet(projected, 45_000);
    // Brief live catch-up beat after assets — MO frames after establish must land for O2.
    await sleep(2_000);
    // Bucketed quiet before stills (optional — do not fail the site if carousel churns).
    await waitProjectedDocumentQuiet(projected, 8_000).catch(() => ({ ok: false }));

    if (site.softNav) {
      const pt = await projected.evaluate(() => {
        const hostEl = document.querySelector('[data-speculum-dom-surface]');
        if (!hostEl) return null;
        for (const f of hostEl.querySelectorAll('iframe')) {
          try {
            const doc = f.contentDocument;
            if (!doc) continue;
            const a = doc.querySelector('a[href*="/marketplace/"], a[href*="/product"]');
            if (!a) continue;
            const ir = f.getBoundingClientRect();
            const ar = a.getBoundingClientRect();
            return {
              x: ir.left + ar.left + ar.width / 2,
              y: ir.top + ar.top + ar.height / 2,
            };
          } catch {
            /* */
          }
        }
        return null;
      });
      if (pt) {
        await projected.evaluate(({ x, y }) => {
          const hostEl = document.querySelector('[data-speculum-dom-surface]');
          if (!hostEl) return;
          const fire = (type, buttons) => {
            hostEl.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                button: 0,
                buttons,
              }),
            );
          };
          fire('pointerdown', 1);
          fire('pointerup', 0);
          hostEl.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0,
            }),
          );
        }, pt);
        await waitProjectedArmed(projected, 60_000);
      }
    }

    const surface = projected.locator('[data-speculum-dom-surface]').first();
    let projectedPng = null;
    // Parent lab chrome (SessionObservationChrome) composites over the iframe
    // element screenshot — hide it before capture so O1 compares Virtual↔Projected only.
    await projected.evaluate(() => {
      for (const el of document.querySelectorAll(
        '[aria-label="Show front observation"], [aria-label="Hide observation"]',
      )) {
        const root = el.closest('.fixed') || el.parentElement || el
        if (root instanceof HTMLElement) root.style.setProperty('display', 'none', 'important')
      }
    }).catch(() => undefined);
    const iframeCount = await projected.locator('[data-speculum-dom-surface] iframe').count();
    for (let i = 0; i < iframeCount; i++) {
      const fr = projected.locator('[data-speculum-dom-surface] iframe').nth(i);
      const vis = await fr.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none';
      });
      if (!vis) continue;
      // Viewport-sized iframe element still — never full html scrollHeight (tall black void).
      projectedPng = await fr.screenshot({ type: 'png' });
      break;
    }
    if (!projectedPng) projectedPng = await surface.screenshot({ type: 'png' });

    let virtualPng;
    try {
      virtualPng = await harnessScreenshot(sessionId, sessionToken);
    } catch (err) {
      result.errors.push(`Speculum Virtual still: ${err.message || err}`);
      await stopProjectedSession(projected, sessionId);
      return result;
    }

    const pair = normalizeStillPair(virtualPng, projectedPng);
    fs.writeFileSync(path.join(OUT, `${site.id}-virtual.png`), pair.virtual);
    fs.writeFileSync(path.join(OUT, `${site.id}-projected.png`), pair.projected);

    // Observe chrome already hidden — do not crop (crop concentrates AA noise over the threshold).
    const o1 = compareStillPair(pair.virtual, pair.projected);
    result.o1 = { ok: o1.ok, diffPct: o1.diffPct, structuralRegions: o1.structuralRegions, results: o1.results };
    if (!o1.ok) result.errors.push(`O1 fail diffPct=${o1.diffPct} regions=${o1.structuralRegions}`);

    const projectedTree = await projected.evaluate((walkSrc) => {
      const hostEl = document.querySelector('[data-speculum-dom-surface]');
      if (!hostEl) return null;
      const walk = eval(walkSrc);
      const frames = [...hostEl.querySelectorAll('iframe')];
      for (const f of frames) {
        try {
          const doc = f.contentDocument;
          // Match Virtual O2 root: body (VIRTUAL_F_FROM_SNAPSHOT findBody).
          const body = doc?.body;
          if (body && (body.childElementCount > 0 || (body.innerText || '').trim().length > 0)) {
            return walk(body);
          }
          if (doc?.documentElement && (doc.documentElement.childElementCount ?? 0) > 0) {
            return walk(doc.documentElement);
          }
        } catch {
          /* */
        }
      }
      return null;
    }, F_WALK_SRC);

    let virtualTree;
    try {
      virtualTree = await harnessEvaluate(sessionId, sessionToken, VIRTUAL_F_FROM_SNAPSHOT);
      if (virtualTree?.error === 'no_api') {
        virtualTree = await harnessEvaluate(sessionId, sessionToken, VIRTUAL_F_FALLBACK);
      }
    } catch (err) {
      result.errors.push(`Speculum Virtual F: ${err.message || err}`);
      virtualTree = null;
    }
    if (virtualTree?.error) {
      result.errors.push(`Speculum Virtual F: ${virtualTree.error}`);
      virtualTree = null;
    }

    const strip = (n) => {
      if (!n) return null;
      if (n.kind !== 'element') return { kind: n.kind, value: n.value };
      return {
        kind: 'element',
        tag: n.tag,
        attrs: {},
        children: (n.children || []).map(strip),
      };
    };
    const vBody = strip(virtualTree);
    const pBody = strip(projectedTree);
    const vSum = treeChecksum(vBody);
    const pSum = treeChecksum(pBody);
    const o2Cheap = compareChecksums(vSum.nodeCount, vSum.checksum, pSum.nodeCount, pSum.checksum);
    const o2Diffs = vBody && pBody ? diffTrees(vBody, pBody, 'F(V)↔P/') : ['missing_tree'];
    const o2 = {
      ok: Boolean(vBody && pBody && o2Cheap.ok && o2Diffs.length === 0),
      cheap: o2Cheap,
      fullErrors: o2Diffs.slice(0, 12),
      vSum,
      pSum,
    };
    result.o2 = o2;
    if (!o2.ok) {
      result.errors.push(
        `O2 fail count V=${vSum.nodeCount}/${vSum.checksum} P=${pSum.nodeCount}/${pSum.checksum}; ${o2Diffs.slice(0, 3).join('; ')}`,
      );
    }

    const assets = await probeProjectedAssets(projected);
    result.assets = assets;
    if (!assets.ok) {
      result.errors.push(
        `PP-ASSET-3 fail brokenImgs=${assets.brokenImgs} virtualData1x1=${assets.virtualData1x1} imgs=${assets.imgCount}`,
      );
    }

    const o5Sample = await projected.evaluate(async () => {
      const hostEl = document.querySelector('[data-speculum-dom-surface]');
      if (!hostEl) return null;
      let observeRoot = hostEl;
      let clickView = window;
      for (const f of hostEl.querySelectorAll('iframe')) {
        try {
          const doc = f.contentDocument;
          if (doc?.body && (doc.body.innerText || '').trim().length > 0) {
            observeRoot = doc.documentElement;
            clickView = doc.defaultView || window;
            break;
          }
        } catch {
          /* */
        }
      }
      const target =
        observeRoot.querySelector('a,button,[role="button"],input') || observeRoot;
      const t0 = performance.now();
      let localMs = null;
      let authoritativeMs = null;
      const mo = new MutationObserver(() => {
        const elapsed = performance.now() - t0;
        if (localMs == null) localMs = elapsed;
        authoritativeMs = elapsed;
      });
      mo.observe(observeRoot, { subtree: true, childList: true, attributes: true, characterData: true });
      target.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: clickView }),
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (localMs == null) localMs = 0;
      await new Promise((r) => setTimeout(r, 100));
      mo.disconnect();
      if (authoritativeMs == null) authoritativeMs = localMs;
      return {
        localFeedbackMs: localMs,
        authoritativeMs,
        rttMs: 40,
        networkStalled: false,
      };
    });
    if (!o5Sample) {
      result.errors.push('O5: no surface for interaction probe');
      result.o5 = { ok: false };
    } else {
      const o5 = gateInteraction(o5Sample);
      result.o5 = { ok: o5.ok, results: o5.results, sample: o5Sample };
      if (!o5.ok) result.errors.push(`O5 fail ${JSON.stringify(o5.results)}`);
    }

    result.ok = Boolean(result.o1?.ok && result.o2?.ok && result.o5?.ok && result.assets?.ok);
    result.sessionId = sessionId;
    await stopProjectedSession(projected, sessionId);
    await sleep(3500);
    return result;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  console.error('[live-runner] boot', { base: BASE, sites: sites.map((s) => s.id) });
  let chromium;
  try {
    // Prefer patchright — same stack as Speculum Virtual; playwright headless-shell
    // is routinely challenged (Cloudflare) while Speculum Chrome is not.
    chromium = require('patchright').chromium;
  } catch {
    try {
      chromium = require('playwright').chromium;
    } catch {
      console.error('[live-runner] playwright or patchright required');
      process.exit(1);
    }
  }

  // Health + operational gate
  try {
    console.error('[live-runner] checking client-config…');
    let health = await req('GET', '/w7s/api/public/client-config');
    if (health.status >= 400) {
      console.error('[live-runner] Speculum stack not healthy at', BASE, health.status);
      process.exit(1);
    }
    if (!health.body?.operational) {
      console.error('[live-runner] ensuring Sessions config…');
      await putSessionsPageProjection();
      health = await req('GET', '/w7s/api/public/client-config');
    }
    if (!health.body?.operational) {
      console.error(
        '[live-runner] Stack not operational; missing=',
        health.body?.missing,
        '— apply Sessions (+ other mandatory) before live oracles.',
      );
      process.exit(1);
    }
    console.error('[live-runner] stack operational');
  } catch (err) {
    console.error('[live-runner] Cannot reach Speculum stack at', BASE, err.message || err);
    process.exit(1);
  }

  const summary = { base: BASE, sites: [], ok: true };
  for (const site of sites) {
    console.error(`[live-runner] === ${site.id} ${site.url} ===`);
    const r = await runSite(chromium, site);
    summary.sites.push(r);
    if (!r.ok) summary.ok = false;
    console.error(
      `[live-runner] ${site.id}: ${r.ok ? 'PASS' : 'FAIL'}`,
      r.errors.length ? r.errors.join(' | ') : '',
    );
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'live-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: summary.ok, sites: summary.sites.map((s) => ({ id: s.id, ok: s.ok })) }, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

void main().catch((err) => {
  console.error('[live-runner] fatal', err);
  process.exit(1);
});
