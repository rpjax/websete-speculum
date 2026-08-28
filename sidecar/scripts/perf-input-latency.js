'use strict';
/**
 * Practical input latency — click / text keystrokes / checkbox toggle.
 *
 * Measures wall-clock time from "command issued" (host `Date.now()` right before
 * `resolveAnd*DomInput`) to "event actually observed in the DOM" (page-side `Date.now()`
 * recorded by the fixture's own listener, read back in one batched `evaluate` at the end).
 * Host script and Chrome run in the same container/process tree, so both `Date.now()` calls
 * share one OS clock — no time-origin handshake needed.
 *
 * Deliberately does NOT rely on `EventApplier.flush()` / `resolveAnd*DomInput()`'s own
 * resolved promise as "done" — peripheral move/button are fire-and-forget (queued, not
 * awaited) by design (§10.5), so that promise can resolve before the event has actually
 * reached the page. Only the fixture's own event listener timestamp is trustworthy.
 *
 * Docker: node scripts/perf-input-latency.js [--iterations N]
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'perf-input-latency');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const args = { iterations: 30, gapMs: 250 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--iterations') args.iterations = Number(argv[++i]) || args.iterations;
    else if (t === '--gap-ms') args.gapMs = Number(argv[++i]) || args.gapMs;
  }
  return args;
}

async function startFixtureHttp() {
  const fixturesDir = path.join(root, 'browser', 'mirror', 'projection', 'lab', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? url;
    if (!pathname.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
    if (!file.startsWith(path.normalize(fixturesDir)) || !fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function stats(samples) {
  if (samples.length === 0) return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    avg: Math.round((sum / sorted.length) * 10) / 10,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}

async function readLog(session, kind) {
  const r = await session.evaluate(`document.getElementById('log').getAttribute('data-${kind}')`);
  if (!r.ok) throw new Error(`readback failed: ${r.errorMessage}`);
  return JSON.parse(r.value);
}

async function resetLog(session, kind) {
  const r = await session.evaluate(`document.getElementById('log').setAttribute('data-${kind}', '[]')`);
  if (!r.ok) throw new Error(`reset failed: ${r.errorMessage}`);
}

async function measureClick(chassis, n, gapMs) {
  const session = chassis.browser;
  await resetLog(session, 'click');
  const t0s = [];
  for (let i = 0; i < n; i++) {
    t0s.push(Date.now());
    const r = await session.resolveAndClickDomInput('#btn');
    if (r.status !== 'dispatched') throw new Error(`click dispatch dropped: ${r.reason}`);
    await wait(gapMs);
  }
  const hits = await readLog(session, 'click');
  if (hits.length !== n) throw new Error(`click count mismatch: sent=${n} observed=${hits.length}`);
  return stats(hits.map((h, i) => h - t0s[i]));
}

async function measureType(chassis, n, gapMs) {
  const session = chassis.browser;
  const samples = [];
  for (let i = 0; i < n; i++) {
    await session.evaluate("document.getElementById('text').value = '';");
    await resetLog(session, 'input');
    const t0 = Date.now();
    const r = await session.resolveAndTypeDomInput('#text', 'x');
    if (r.status !== 'dispatched') throw new Error(`type dispatch dropped: ${r.reason}`);
    await wait(gapMs);
    const hits = await readLog(session, 'input');
    if (hits.length < 1) throw new Error(`type produced no input event on iteration ${i}`);
    samples.push(hits[0] - t0);
  }
  return stats(samples);
}

async function measureCheckbox(chassis, n, gapMs) {
  const session = chassis.browser;
  const samples = [];
  for (let i = 0; i < n; i++) {
    await resetLog(session, 'change');
    const t0 = Date.now();
    const r = await session.resolveAndClickDomInput('#chk');
    if (r.status !== 'dispatched') throw new Error(`checkbox dispatch dropped: ${r.reason}`);
    await wait(gapMs);
    const hits = await readLog(session, 'change');
    if (hits.length < 1) throw new Error(`checkbox produced no change event on iteration ${i}`);
    samples.push(hits[0] - t0);
  }
  return stats(samples);
}

async function runSparse(fixtureOrigin, n, gapMs) {
  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const chassis = new LabChassis({ headless: false, outDir: path.join(OUT, 'sparse-cdp') });
  console.log('\n=== sparse-cdp ===');
  await chassis.boot({
    mode: 'run',
    url: `${fixtureOrigin}/fixtures/perf-input-latency.html`,
    frameRateHz: 60,
    blueprintId: 'perf-input-latency-sparse-cdp',
    slug: 'perf-input-latency-sparse-cdp',
    width: 800,
    height: 600,
  });
  await wait(1500); // let the surface settle before the first sample
  const result = { kind: 'sparse-cdp' };
  try {
    result.click = await measureClick(chassis, n, gapMs);
    console.log(`  click    : ${JSON.stringify(result.click)}`);
    result.type = await measureType(chassis, n, gapMs);
    console.log(`  type/char: ${JSON.stringify(result.type)}`);
    result.checkbox = await measureCheckbox(chassis, n, gapMs);
    console.log(`  checkbox : ${JSON.stringify(result.checkbox)}`);
  } finally {
    await chassis.disposeVirtual().catch(() => undefined);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  process.env.SPECULUM_LAB_HEADED = '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  const fixture = await startFixtureHttp();
  const report = { at: new Date().toISOString(), iterations: args.iterations, gapMs: args.gapMs, results: {} };
  try {
    report.results['sparse-cdp'] = await runSparse(fixture.origin, args.iterations, args.gapMs);
  } finally {
    await fixture.close();
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY (ms, dispatch-command -> DOM event observed) ===');
  const r = report.results['sparse-cdp'];
  console.log('sparse-cdp:');
  console.log(`  click    avg=${r.click.avg} p95=${r.click.p95} max=${r.click.max}`);
  console.log(`  type/char avg=${r.type.avg} p95=${r.type.p95} max=${r.type.max}`);
  console.log(`  checkbox avg=${r.checkbox.avg} p95=${r.checkbox.p95} max=${r.checkbox.max}`);
  console.log(`\nReport: ${path.join(OUT, 'report.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
