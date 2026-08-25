/**
 * End-to-end perf measurement — input path + virtual assets proxy.
 *
 * Goal: find optimization targets that move the needle (not micro-noise).
 *
 * Usage: node scripts/lab-perf-measure.js [--port 4103]
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('patchright');
const { performance } = require('node:perf_hooks');

const PORT = Number(process.env.SPECULUM_LAB_PORT || arg('--port') || 4103);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const OUT = path.join(__dirname, '..', 'lab-runs', `perf-measure-${stamp()}`);

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function pct(samples) {
  if (!samples.length) return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { count: s.length, min: s[0], avg: sum / s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

async function waitHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* */
    }
    await wait(200);
  }
  throw new Error('lab health timeout');
}

async function projectedFrame(page) {
  const handle = await page.waitForSelector('#surfaceHost iframe', { timeout: 30_000 });
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no projected frame');
  return frame;
}

async function browseStart(page, url) {
  await page.fill('#url', url);
  await page.click('#browseStart');
  await page.waitForFunction(
    () => {
      const frames = Number(document.getElementById('streamFrames')?.textContent || 0);
      const phase = document.getElementById('chipPhase')?.textContent || '';
      return frames >= 1 && /live|browse|armed/i.test(phase);
    },
    undefined,
    { timeout: 90_000 },
  );
}

async function browseStop(page) {
  await page.click('#browseStop').catch(() => {});
  await wait(1200);
  return page.evaluate(() => document.getElementById('dossierPath')?.textContent || null).catch(() => null);
}

async function connect(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.click('#connect');
  await wait(400);
}

/** True E2E: Projected click → Virtual script → Projected status attr (round-trip). */
async function measureInputClickE2E(page, samples = 40) {
  await browseStart(page, `${BASE}/fixtures/input-click.html`);
  await wait(1500);
  const frame = await projectedFrame(page);
  const latencies = [];
  const fails = [];

  for (let i = 0; i < samples; i++) {
    await frame.evaluate(() => {
      const el = document.getElementById('status');
      if (el) {
        el.setAttribute('data-state', 'idle');
        el.textContent = 'idle';
      }
    });
    // Reset on Virtual via a no-op browse won't work — scripts don't run on Projected.
    // Instead: click only when idle; after first click Virtual stays "clicked".
    // Use unique counter via evaluate on Virtual... we can't. Measure first click only in batch
    // by reloading session every N? Too heavy.
    // Better: use scroll fixture for repeatable E2E; click once for pipeline dossier.
    break;
  }

  // One authentic click E2E (cold-ish after settle).
  const btn = await frame.waitForSelector('#click-me', { timeout: 15_000 });
  const box = await btn.boundingBox();
  if (!box) throw new Error('no bbox');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await wait(80);
  const t0 = performance.now();
  await page.mouse.down();
  await page.mouse.up();
  const deadline = Date.now() + 8_000;
  let e2eMs = null;
  while (Date.now() < deadline) {
    const st = await frame.evaluate(() => document.getElementById('status')?.getAttribute('data-state'));
    if (st === 'clicked') {
      e2eMs = performance.now() - t0;
      break;
    }
    await wait(16);
  }
  if (e2eMs == null) fails.push('click_e2e_timeout');

  // Burst: push scroll intents via UI mouse wheel for dispatch volume + dossier timing.
  await browseStop(page);
  await browseStart(page, `${BASE}/fixtures/input-scroll.html`);
  await wait(1200);
  const frame2 = await projectedFrame(page);
  const scroller = await frame2.waitForSelector('#scroller', { timeout: 15_000 });
  await scroller.hover();
  const scrollE2E = [];
  for (let i = 0; i < samples; i++) {
    const before = await frame2.evaluate(() => document.getElementById('scroller')?.scrollTop ?? 0);
    const t1 = performance.now();
    await page.mouse.wheel(0, 60);
    const deadline2 = Date.now() + 3_000;
    while (Date.now() < deadline2) {
      const after = await frame2.evaluate(() => document.getElementById('scroller')?.scrollTop ?? 0);
      if (after > before + 5) {
        scrollE2E.push(performance.now() - t1);
        break;
      }
      await wait(8);
    }
  }

  // Rapid scroll storm (queue pressure) — wall for N wheels, measure scrollTop delta rate.
  const stormN = 80;
  const stormT0 = performance.now();
  for (let i = 0; i < stormN; i++) {
    await page.mouse.wheel(0, 40);
  }
  await wait(200);
  const stormTop = await frame2.evaluate(() => document.getElementById('scroller')?.scrollTop ?? 0);
  const stormWallMs = performance.now() - stormT0;

  const dossier = await browseStop(page);
  let pipeline = null;
  if (dossier && fs.existsSync(path.join(dossier, 'probes', 'input-pipeline.json'))) {
    pipeline = JSON.parse(fs.readFileSync(path.join(dossier, 'probes', 'input-pipeline.json'), 'utf8'));
  }

  return {
    clickE2eMs: e2eMs,
    scrollE2eMs: pct(scrollE2E),
    scrollStorm: { wheels: stormN, wallMs: stormWallMs, scrollTop: stormTop, wheelsPerSec: stormN / (stormWallMs / 1000) },
    pipeline,
    fails,
    samples: { click: e2eMs != null ? 1 : 0, scroll: scrollE2E.length },
  };
}

/** Mode A pointer burst via projected clicks on matrix — many intents, dossier timing. */
async function measureInputClickBurst(page, clicks = 50) {
  await browseStart(page, `${BASE}/fixtures/input-click.html`);
  await wait(1000);
  const frame = await projectedFrame(page);
  const btn = await frame.waitForSelector('#click-me', { timeout: 15_000 });
  const box = await btn.boundingBox();
  if (!box) throw new Error('no bbox');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  const t0 = performance.now();
  for (let i = 0; i < clicks; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await wait(12);
  }
  const wallMs = performance.now() - t0;
  await wait(500);
  const dossier = await browseStop(page);
  let pipeline = null;
  if (dossier && fs.existsSync(path.join(dossier, 'probes', 'input-pipeline.json'))) {
    pipeline = JSON.parse(fs.readFileSync(path.join(dossier, 'probes', 'input-pipeline.json'), 'utf8'));
  }
  return {
    clicks,
    wallMs,
    clicksPerSec: clicks / (wallMs / 1000),
    pipeline,
  };
}

async function measureAssetsProxy(page, target, dwellMs) {
  await browseStart(page, target.url);
  const net = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/w7s/virtual-')) return;
    const timing = res.request().timing?.() || null;
    net.push({
      url: u.split('?')[0].replace(BASE, ''),
      status: res.status(),
      ct: (res.headers()['content-type'] || '').split(';')[0],
      timing,
    });
  });

  await wait(dwellMs);

  // Resource Timing from the lab shell (Projected fetches go through parent or iframe).
  const rt = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    return entries
      .filter((e) => e.name.includes('/w7s/virtual-'))
      .map((e) => ({
        name: e.name.split('?')[0].replace(location.origin, ''),
        duration: e.duration,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        startTime: e.startTime,
        responseStart: e.responseStart,
        requestStart: e.requestStart,
        waiting: Math.max(0, e.responseStart - e.requestStart),
        download: Math.max(0, e.responseEnd - e.responseStart),
      }));
  });

  // Also peek inside projected iframe timings.
  const rtInner = await page.evaluate(() => {
    const iframe = document.querySelector('#surfaceHost iframe');
    const win = iframe?.contentWindow;
    if (!win?.performance) return [];
    try {
      return win.performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/w7s/virtual-'))
        .map((e) => ({
          name: e.name.split('?')[0],
          duration: e.duration,
          transferSize: e.transferSize,
          waiting: Math.max(0, e.responseStart - e.requestStart),
          download: Math.max(0, e.responseEnd - e.responseStart),
        }));
    } catch {
      return [];
    }
  });

  const allRt = [...rt, ...rtInner];
  const durations = allRt.map((e) => e.duration).filter((n) => n > 0);
  const waiting = allRt.map((e) => e.waiting).filter((n) => n >= 0);
  const download = allRt.map((e) => e.download).filter((n) => n >= 0);
  const byCt = {};
  for (const r of net) {
    const k = r.ct || 'unknown';
    if (!byCt[k]) byCt[k] = { n: 0, ok: 0, fail: 0 };
    byCt[k].n += 1;
    if (r.status >= 200 && r.status < 300) byCt[k].ok += 1;
    else byCt[k].fail += 1;
  }

  // Warm vs cold: re-fetch top assets from lab page with Performance marks.
  const unique = [...new Set(allRt.map((e) => e.name).filter((n) => n.includes('/w7s/virtual-assets/')))].slice(0, 12);
  const token = await page.evaluate(() => {
    // session token rides on existing virtual URLs in the projected DOM
    const iframe = document.querySelector('#surfaceHost iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return '';
    for (const el of doc.querySelectorAll('[src],[href]')) {
      for (const a of ['src', 'href']) {
        const v = el.getAttribute(a) || '';
        const m = /speculum-session-token=([^&]+)/.exec(v);
        if (m) return decodeURIComponent(m[1]);
      }
    }
    return '';
  });

  const coldWarm = [];
  if (token && unique.length) {
    for (const name of unique.slice(0, 8)) {
      const pathOnly = name.includes('://') ? new URL(name).pathname + (new URL(name).search || '') : name;
      const bare = pathOnly.split('?')[0];
      const url = `${BASE}${bare}?speculum-session-token=${encodeURIComponent(token)}`;
      const cold = [];
      const warm = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const res = await fetch(url);
        await res.arrayBuffer();
        const dt = performance.now() - t0;
        if (i === 0) cold.push(dt);
        else warm.push(dt);
      }
      coldWarm.push({
        key: bare.replace('/w7s/virtual-assets/', '').slice(0, 80),
        coldMs: pct(cold),
        warmMs: pct(warm),
      });
    }
  }

  // Concurrent storm on one warm CSS/png.
  let concurrency = null;
  if (token && unique[0]) {
    const bare = (unique[0].includes('://') ? new URL(unique[0]).pathname : unique[0]).split('?')[0];
    const url = `${BASE}${bare}?speculum-session-token=${encodeURIComponent(token)}`;
    // warm once
    await fetch(url).then((r) => r.arrayBuffer());
    const N = 40;
    const t0 = performance.now();
    const results = await Promise.all(
      Array.from({ length: N }, async () => {
        const s = performance.now();
        const res = await fetch(url);
        await res.arrayBuffer();
        return { ms: performance.now() - s, status: res.status };
      }),
    );
    concurrency = {
      n: N,
      wallMs: performance.now() - t0,
      perReq: pct(results.map((r) => r.ms)),
      statuses: results.reduce((a, r) => {
        a[r.status] = (a[r.status] || 0) + 1;
        return a;
      }, {}),
    };
  }

  await browseStop(page);
  return {
    id: target.id,
    url: target.url,
    dwellMs,
    net: {
      total: net.length,
      ok: net.filter((r) => r.status >= 200 && r.status < 300).length,
      byStatus: net.reduce((a, r) => {
        a[r.status] = (a[r.status] || 0) + 1;
        return a;
      }, {}),
      byCt,
    },
    resourceTiming: {
      count: allRt.length,
      durationMs: pct(durations),
      waitingMs: pct(waiting),
      downloadMs: pct(download),
      topSlow: [...allRt].sort((a, b) => b.duration - a.duration).slice(0, 8),
    },
    coldWarm,
    concurrency,
  };
}

function microbenchAssetsCpu() {
  // In-process CPU cost of rewrite/stamp (no network) — isolates hop cost.
  const urlForms = require('../dist/browser/mirror/projection/assets/urlForms.js');
  const { stampAuthInServedBody } = require('@speculum/page-projection/projected/sessionBindingAuth');
  const { FrameRewriteHop } = require('../dist/browser/mirror/projection/assets/rewritePart.js');
  const { AssetStore } = require('../dist/browser/mirror/projection/assets/AssetStore.js');
  const { BinaryFrameEncoder } = require('@speculum/page-projection/virtual/frame/binaryFrameEncoder');
  const { createFrame, CHECK_SCOPE_TABLE } = require('@speculum/page-projection/core/frame');
  const { OpCode, NodeKind } = require('@speculum/page-projection/core/opcodes');
  const { ElementNs } = require('@speculum/page-projection/core/elementNs');
  const { applyOpToTable } = require('@speculum/page-projection/core/replicatedTableApply');
  const { ReplicatedTable } = require('@speculum/page-projection/core/replicatedTable');

  const cssChunks = [];
  for (let i = 0; i < 200; i++) {
    cssChunks.push(`.c${i}{background:url(https://cdn.example.com/img/${i}.png)}`);
    cssChunks.push(`@import "https://cdn.example.com/css/${i}.css";`);
  }
  const bigCss = cssChunks.join('\n');

  const rewriteSamples = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    urlForms.rewriteCssText(bigCss, 'https://www.example.com/', () => {});
    rewriteSamples.push(performance.now() - t0);
  }

  const virtualCss = urlForms.rewriteCssText(bigCss, 'https://www.example.com/', () => {});
  const stampSamples = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    stampAuthInServedBody(virtualCss, 'text/css', 'tok-perf-measure');
    stampSamples.push(performance.now() - t0);
  }

  // Hop: frame with 80 URL attrs
  const attrs = Array.from({ length: 80 }, (_, i) => ({
    name: i % 3 === 0 ? 'src' : i % 3 === 1 ? 'data-src' : 'href',
    value: `https://cdn.example.com/bulk/${i}.png?n=${i}`,
  }));
  const ops = [
    {
      op: OpCode.NodeNew,
      id: 10,
      kind: NodeKind.Element,
      ns: ElementNs.Html,
      name: 'div',
      attrs,
    },
  ];
  const table = new ReplicatedTable();
  table.reset();
  table.setSequence(1);
  const pre = table.tableHash;
  for (const op of ops) applyOpToTable(table, op);
  const frame = createFrame({
    generation: 1,
    sequence: 1,
    preTableHash: pre,
    resync: true,
    ops: [...ops, { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash }],
  });
  const bytes = new BinaryFrameEncoder().encode(frame)[0];
  const hopSamples = [];
  for (let i = 0; i < 40; i++) {
    const hop = new FrameRewriteHop();
    const assets = new AssetStore();
    const t0 = performance.now();
    hop.push(bytes, { pageUrl: 'https://www.example.com/', assets });
    hopSamples.push(performance.now() - t0);
  }

  return {
    cssRewriteMs: pct(rewriteSamples),
    cssStampMs: pct(stampSamples),
    frameHop80UrlsMs: pct(hopSamples),
    cssBytes: Buffer.byteLength(bigCss),
    virtualCssBytes: Buffer.byteLength(virtualCss),
  };
}

function findings(report) {
  const out = [];
  const click = report.input?.clickE2eMs;
  const scroll = report.input?.scrollE2eMs;
  const pipe = report.input?.pipeline?.journal || report.inputBurst?.pipeline?.journal;
  const inj = report.input?.pipeline?.dispatch || report.inputBurst?.pipeline?.dispatch;

  if (typeof click === 'number') {
    out.push({
      area: 'input',
      signal: `click E2E (Projected→Virtual→Projected) ${click.toFixed(1)} ms`,
      note: click > 80 ? 'Human-noticeable; look at capture→dispatch→CDP→frame apply chain' : 'Acceptable single-shot',
      priority: click > 120 ? 'high' : click > 80 ? 'med' : 'low',
    });
  }
  if (scroll?.p95) {
    out.push({
      area: 'input',
      signal: `scroll E2E p95=${scroll.p95.toFixed(1)} ms (n=${scroll.count})`,
      note: scroll.p95 > 50 ? 'Scroll feedback lag — coalesce/move path or frame tick' : 'Scroll feedback OK',
      priority: scroll.p95 > 80 ? 'high' : scroll.p95 > 50 ? 'med' : 'low',
    });
  }
  if (pipe?.clientLagMs?.p95 != null && pipe.clientLagMs.count > 0) {
    out.push({
      area: 'input',
      signal: `clientLag p95=${pipe.clientLagMs.p95} ms (wire+queue to sidecar)`,
      note: pipe.clientLagMs.p95 > 20 ? 'Capture→sidecar lag; WS/batching' : 'Wire lag small',
      priority: pipe.clientLagMs.p95 > 40 ? 'med' : 'low',
    });
  }
  if (pipe?.dispatchMs?.p95 != null && pipe.dispatchMs.count > 0) {
    out.push({
      area: 'input',
      signal: `dispatchMs p95=${pipe.dispatchMs.p95} ms (sidecar receive→inject done)`,
      note: pipe.dispatchMs.p95 > 15 ? 'DomElementInput / resolve / CDP is the hot path' : 'Dispatch cheap',
      priority: pipe.dispatchMs.p95 > 25 ? 'high' : pipe.dispatchMs.p95 > 15 ? 'med' : 'low',
    });
  }
  if (inj?.injectMs?.p95 != null && inj.injectMs.count > 0) {
    out.push({
      area: 'input',
      signal: `injectMs p95=${inj.injectMs.p95} ms queueWait p95=${inj.queueWaitMs?.p95 ?? '?'}`,
      note: 'Patchright/CDP inject cost inside DomElementInput',
      priority: (inj.injectMs.p95 || 0) > 20 ? 'high' : 'low',
    });
  }

  for (const a of report.assets || []) {
    const d = a.resourceTiming?.durationMs;
    if (d?.p95) {
      out.push({
        area: 'assets',
        signal: `${a.id} virtual GET duration p95=${d.p95.toFixed(1)} ms (n=${d.count})`,
        note: d.p95 > 100 ? 'Proxy TTFB/fill dominates paint; warm L1 + parallel fill' : 'Serve latency OK',
        priority: d.p95 > 200 ? 'high' : d.p95 > 100 ? 'med' : 'low',
      });
    }
    const w = a.resourceTiming?.waitingMs;
    if (w?.p95 && d?.p95 && w.p95 > d.p95 * 0.6) {
      out.push({
        area: 'assets',
        signal: `${a.id} waiting(TTFB) p95=${w.p95.toFixed(1)} ms ≈ most of duration`,
        note: 'Optimize getAsset await/fill — not download bytes',
        priority: 'high',
      });
    }
    if (a.concurrency?.perReq?.p95) {
      out.push({
        area: 'assets',
        signal: `${a.id} concurrent×${a.concurrency.n} per-req p95=${a.concurrency.perReq.p95.toFixed(1)} ms wall=${a.concurrency.wallMs.toFixed(0)}`,
        note: a.concurrency.wallMs > a.concurrency.perReq.avg * 2 ? 'Serialization in getAsset/L1?' : 'Concurrency scales',
        priority: a.concurrency.wallMs > 500 ? 'med' : 'low',
      });
    }
    const coldSlow = (a.coldWarm || []).filter((x) => x.coldMs.avg > (x.warmMs.avg || 1) * 3);
    if (coldSlow.length) {
      out.push({
        area: 'assets',
        signal: `${a.id} cold≫warm on ${coldSlow.length} keys (e.g. ${coldSlow[0].key})`,
        note: 'Cold = fill/pass-through; ensure nested kick + inFlight await are tight',
        priority: 'med',
      });
    }
  }

  const cpu = report.microbench;
  if (cpu?.cssRewriteMs?.p95 > 20) {
    out.push({
      area: 'assets-cpu',
      signal: `CSS rewrite p95=${cpu.cssRewriteMs.p95.toFixed(1)} ms for ~${(cpu.cssBytes / 1024).toFixed(0)}KB`,
      note: 'Hot on CSSOM-heavy sites; regex rewrite could be incremental',
      priority: cpu.cssRewriteMs.p95 > 50 ? 'high' : 'med',
    });
  }
  if (cpu?.frameHop80UrlsMs?.p95 > 5) {
    out.push({
      area: 'assets-cpu',
      signal: `FrameRewriteHop 80-URL frame p95=${cpu.frameHop80UrlsMs.p95.toFixed(2)} ms`,
      note: 'On critical path every frame with URL attrs',
      priority: cpu.frameHop80UrlsMs.p95 > 15 ? 'high' : 'med',
    });
  }

  const rank = { high: 0, med: 1, low: 2 };
  return out.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await waitHealth();
  console.log(`[perf] lab ${BASE} → ${OUT}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const report = { at: new Date().toISOString(), base: BASE, out: OUT };

  try {
    await connect(page);
    console.log('\n=== input E2E (click + scroll) ===');
    report.input = await measureInputClickE2E(page, 35);
    console.log(
      JSON.stringify(
        {
          clickE2eMs: report.input.clickE2eMs,
          scrollE2e: report.input.scrollE2eMs,
          storm: report.input.scrollStorm,
          dispatch: report.input.pipeline?.journal?.dispatchMs,
          clientLag: report.input.pipeline?.journal?.clientLagMs,
          inject: report.input.pipeline?.dispatch?.injectMs,
        },
        null,
        2,
      ),
    );

    console.log('\n=== input click burst (dossier timing) ===');
    report.inputBurst = await measureInputClickBurst(page, 60);
    console.log(
      JSON.stringify(
        {
          clicksPerSec: report.inputBurst.clicksPerSec,
          dispatch: report.inputBurst.pipeline?.journal?.dispatchMs,
          clientLag: report.inputBurst.pipeline?.journal?.clientLagMs,
          inject: report.inputBurst.pipeline?.dispatch?.injectMs,
          byMode: report.inputBurst.pipeline?.journal?.byMode,
        },
        null,
        2,
      ),
    );

    console.log('\n=== assets proxy (matrix + superbet) ===');
    report.assets = [];
    for (const t of [
      { id: 'assets-matrix', url: `${BASE}/fixtures/assets-matrix.html`, dwell: 6_000 },
      { id: 'superbet', url: 'https://superbet.ro/', dwell: 14_000 },
    ]) {
      console.log(`--- ${t.id} ---`);
      const a = await measureAssetsProxy(page, t, t.dwell);
      report.assets.push(a);
      console.log(
        JSON.stringify(
          {
            net: a.net,
            duration: a.resourceTiming.durationMs,
            waiting: a.resourceTiming.waitingMs,
            concurrency: a.concurrency,
            coldWarmSample: a.coldWarm.slice(0, 3),
            topSlow: a.resourceTiming.topSlow.slice(0, 5),
          },
          null,
          2,
        ),
      );
    }

    console.log('\n=== assets CPU microbench ===');
    report.microbench = microbenchAssetsCpu();
    console.log(JSON.stringify(report.microbench, null, 2));

    report.findings = findings(report);
    console.log('\n=== FINDINGS (priority) ===');
    for (const f of report.findings) {
      console.log(`[${f.priority}] ${f.area}: ${f.signal}`);
      console.log(`         → ${f.note}`);
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[perf] wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

