/**
 * Aggressive virtual-assets lab stress — fixture matrix + real sites.
 *
 * Usage:
 *   node scripts/lab-assets-stress.js [--port 4103] [--dwell 12000]
 *
 * Asserts (hard fail):
 *   - desync == 0 on every target
 *   - at least one /w7s/virtual-* request succeeded (200/206) on fixture
 *   - 401 rate on virtual assets is 0 when token is present
 *   - fixture CSS/font/img virtual URLs appear in Projected DOM
 *
 * Soft report (does not fail alone):
 *   - 404 missing warm fills, third-party XFO noise
 */
const { chromium } = require('patchright');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.SPECULUM_LAB_PORT || argValue('--port') || 4103);
const DWELL_MS = Number(argValue('--dwell') || 12_000);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const OUT_DIR = path.join(__dirname, '..', 'lab-runs', `assets-stress-${stamp()}`);

const TARGETS = [
  { id: 'assets-matrix', url: `${BASE}/fixtures/assets-matrix.html`, dwellMs: Math.max(DWELL_MS, 8_000) },
  { id: 'demo', url: `${BASE}/fixtures/demo.html`, dwellMs: 6_000 },
  { id: 'superbet', url: 'https://superbet.ro/', dwellMs: Math.max(DWELL_MS, 15_000) },
  { id: 'eneba', url: 'https://www.eneba.com/', dwellMs: Math.max(DWELL_MS, 15_000) },
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await wait(200);
  }
  throw new Error(`lab health timeout on ${BASE}`);
}

async function runTarget(browser, target) {
  const page = await browser.newPage();
  const net = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/w7s/virtual-')) return;
    let len = 0;
    try {
      const h = res.headers();
      len = Number(h['content-length'] || 0);
    } catch {
      /* */
    }
    net.push({
      url: u,
      status: res.status(),
      ok: res.ok(),
      contentType: res.headers()['content-type'] || '',
      contentLength: len,
    });
  });

  const consoleErrs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrs.push(msg.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.click('#connect');
  await wait(500);
  await page.fill('#url', target.url);
  await page.click('#browseStart');

  const t0 = Date.now();
  await page.waitForFunction(
    () => {
      const frames = Number(document.getElementById('streamFrames')?.textContent || 0);
      const phase = document.getElementById('chipPhase')?.textContent || '';
      return frames >= 1 && /live|browse|armed/i.test(phase);
    },
    undefined,
    { timeout: 90_000 },
  );
  await wait(target.dwellMs);

  const metrics = await page.evaluate(() => {
    const surface = document.querySelector('#surfaceHost iframe');
    const doc = surface?.contentDocument;
    const virtualAttrs = [];
    if (doc) {
      for (const el of doc.querySelectorAll('[src],[href],[poster],[srcset],style')) {
        for (const name of ['src', 'href', 'poster', 'srcset', 'style']) {
          const v = el.getAttribute?.(name);
          if (v && v.includes('/w7s/virtual-')) virtualAttrs.push({ tag: el.tagName, name, preview: v.slice(0, 160) });
        }
      }
      for (const sheet of doc.styleSheets || []) {
        try {
          const href = sheet.href || '';
          if (href.includes('/w7s/virtual-')) virtualAttrs.push({ tag: 'STYLESHEET', name: 'href', preview: href.slice(0, 160) });
        } catch {
          /* cross-origin sheet */
        }
      }
    }
    return {
      frames: document.getElementById('streamFrames')?.textContent,
      applyMs: document.getElementById('streamApplyMs')?.textContent,
      desync: Number(document.getElementById('streamDesync')?.textContent || 0),
      applyOk: document.getElementById('streamApplyOk')?.textContent,
      ops: document.getElementById('streamOps')?.textContent,
      gen: document.getElementById('streamGen')?.textContent,
      seq: document.getElementById('streamSeq')?.textContent,
      phase: document.getElementById('chipPhase')?.textContent,
      bodyPreview: doc?.body?.innerText?.slice(0, 160) || '',
      virtualAttrCount: virtualAttrs.length,
      virtualAttrs: virtualAttrs.slice(0, 40),
      stylesheetCount: doc?.styleSheets?.length ?? 0,
    };
  });

  try {
    await page.click('#browseStop');
  } catch {
    /* */
  }
  await wait(800);
  await page.close();

  const byStatus = {};
  for (const r of net) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  const ok = net.filter((r) => r.status === 200 || r.status === 206).length;
  const unauthorized = net.filter((r) => r.status === 401).length;
  const missing = net.filter((r) => r.status === 404).length;

  const hardFails = [];
  if (metrics.desync > 0) hardFails.push(`desync=${metrics.desync}`);
  if (target.id === 'assets-matrix') {
    if (ok < 1) hardFails.push('fixture expected >=1 virtual 200/206');
    if (metrics.virtualAttrCount < 1) hardFails.push('fixture expected virtual URLs in Projected DOM');
    if (missing > 0) hardFails.push(`fixture virtual 404 count=${missing}`);
  }
  if (unauthorized > 0) hardFails.push(`virtual 401 count=${unauthorized}`);

  return {
    id: target.id,
    url: target.url,
    wallMs: Date.now() - t0,
    metrics,
    net: {
      total: net.length,
      ok,
      unauthorized,
      missing,
      byStatus,
      samples: net.slice(0, 30),
    },
    consoleErrs: consoleErrs.filter((t) => /virtual-|401|403|Failed to load/i.test(t)).slice(0, 40),
    hardFails,
    pass: hardFails.length === 0,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const health = await waitHealth(20_000);
  console.log(`[assets-stress] lab ok protocol=${health.protocolVersion} → ${OUT_DIR}`);

  const chromePath = process.env.CHROME_EXECUTABLE || undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  });
  const results = [];
  try {
    for (const target of TARGETS) {
      process.stdout.write(`\n=== ${target.id} (${target.url}) ===\n`);
      try {
        const r = await runTarget(browser, target);
        results.push(r);
        console.log(
          JSON.stringify(
            {
              pass: r.pass,
              desync: r.metrics.desync,
              virtualAttrs: r.metrics.virtualAttrCount,
              netOk: r.net.ok,
              net401: r.net.unauthorized,
              net404: r.net.missing,
              hardFails: r.hardFails,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        const fail = {
          id: target.id,
          url: target.url,
          pass: false,
          hardFails: [String(e && e.stack ? e.stack : e)],
        };
        results.push(fail);
        console.error(fail.hardFails[0]);
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    outDir: OUT_DIR,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[assets-stress] wrote ${reportPath}`);
  console.log(`[assets-stress] failed=${report.failed}/${results.length}`);
  if (report.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

