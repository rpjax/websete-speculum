/**
 * Input E2E stress + scroll-census cost probe (OS / Docker).
 *
 * Measures:
 *  1) Projected snapshotScrollCensus microbench (synthetic index size)
 *  2) Virtual Phase A applyScrollCensus RTT (synthetic multi-context / positions)
 *  3) Functional stress on fixtures/input-e2e-stress.html (click/type/viewport scroll)
 *
 * Usage:
 *   npm run lab:input-e2e-stress          # needs /dev/uinput
 *   npm run lab:input-e2e-stress:docker   # Windows hosts
 *
 * Env:
 *   STRESS_PANELS=48
 *   STRESS_CENSUS_ITERS=12
 *   STRESS_CLICKS=24
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'input-e2e-stress');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(samples) {
  if (!samples.length) return { n: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    avg: sum / sorted.length,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

function requireOsInput() {
  let ok = false;
  try {
    ok = require('../dist/browser/input/os/uinput').uinputAvailable() === true;
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(
      [
        'FAIL: /dev/uinput unavailable — input E2E stress is fail-closed.',
        'Canonical: npm run lab:input-e2e-stress:docker',
        'See Refactor/sidecar/LAB-DOCKER.md',
      ].join('\n'),
    );
    process.exit(2);
  }
}

function run(cmd, args, label) {
  process.stdout.write(`\n>>> ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(r.status ?? 1);
  }
}

function buildFatCensus(contexts, positionsPerCtx, opts = {}) {
  const contextsOut = [];
  for (let c = 0; c < contexts; c++) {
    const positions = [];
    positions.push({
      nodeId: null,
      scrollX: opts.scrollX ?? 0,
      scrollY: opts.scrollY ?? (c + 1),
    });
    for (let i = 1; i < positionsPerCtx; i++) {
      positions.push({
        nodeId: 10_000 + c * 10_000 + i,
        scrollX: i,
        scrollY: i * 2,
      });
    }
    contextsOut.push({ contextId: c === 0 ? 1 : 1 + c, positions });
  }
  return { contexts: contextsOut };
}

/** Pure Projected algorithm cost — no DOM; stubs registry.get. */
function microbenchSnapshotCensus() {
  const { snapshotScrollCensus } = require('@speculum/page-projection/projected/input/snapshotScrollCensus');
  const sizes = [1, 8, 32, 64, 128, 256, 512, 1024];
  const iters = Math.max(20, Number(process.env.STRESS_SNAPSHOT_ITERS || 80) || 80);
  const rows = [];

  for (const n of sizes) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const scrollIndex = { entries: () => ids };
    const registry = {
      get: () => ({ nodeType: 1, scrollLeft: 1, scrollTop: 2 }),
    };
    const doc = { scrollingElement: { scrollTop: 0, scrollLeft: 0 } };
    const win = { scrollY: 0, scrollX: 0 };
    // warmup
    for (let w = 0; w < 5; w++) {
      snapshotScrollCensus({ contextId: 1, doc, win, registry, scrollIndex });
    }
    const samples = [];
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      const census = snapshotScrollCensus({ contextId: 1, doc, win, registry, scrollIndex });
      samples.push(performance.now() - t0);
      if (census.contexts[0].positions.length !== n + 1) {
        throw new Error(`snapshot size mismatch n=${n}`);
      }
    }
    rows.push({ indexSize: n, positions: n + 1, ms: summarize(samples) });
  }
  return rows;
}

async function startFixtureHttp() {
  const fixturesDir = path.join(root, 'browser', 'mirror', 'projection', 'lab', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (!url.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const pathname = (url.split('?')[0] ?? url);
    const file = path.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
    if (!file.startsWith(path.normalize(fixturesDir)) || !fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('fixture http: no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main() {
  requireOsInput();
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.SPECULUM_INPUT_BACKEND = process.env.SPECULUM_INPUT_BACKEND || 'os';
  if (!process.env.CHROME_EXECUTABLE) {
    process.env.CHROME_EXECUTABLE = '/usr/bin/google-chrome';
  }
  fs.mkdirSync(OUT, { recursive: true });

  run(npm, ['run', 'build:page-projection'], 'build:page-projection');
  run(npm, ['run', 'build:virtual'], 'build:virtual');
  run(npm, ['run', 'build:snapshot'], 'build:snapshot');
  run(npm, ['exec', '--', 'tsc'], 'tsc');

  const report = {
    at: new Date().toISOString(),
    backend: 'os',
    phases: {},
    failed: 0,
    notes: [],
  };

  process.stdout.write('\n=== phase: projected snapshotScrollCensus microbench ===\n');
  try {
    report.phases.snapshotMicrobench = microbenchSnapshotCensus();
    for (const row of report.phases.snapshotMicrobench) {
      console.log(
        `  index=${row.indexSize} p50=${row.ms.p50?.toFixed(3)}ms p95=${row.ms.p95?.toFixed(3)}ms max=${row.ms.max?.toFixed(3)}ms`,
      );
    }
  } catch (err) {
    report.failed += 1;
    report.phases.snapshotMicrobench = { error: err instanceof Error ? err.message : String(err) };
    console.error('FAIL snapshot microbench', err);
  }

  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const panels = Math.max(8, Math.min(128, Number(process.env.STRESS_PANELS || 48) || 48));
  const censusIters = Math.max(3, Math.min(40, Number(process.env.STRESS_CENSUS_ITERS || 12) || 12));
  const clickN = Math.max(4, Math.min(64, Number(process.env.STRESS_CLICKS || 24) || 24));

  const httpServer = await startFixtureHttp();
  // ABS needs headed Chromium on Xorg (Docker lab sets SPECULUM_LAB_HEADED=1).
  const chassis = new LabChassis({
    headless: false,
    outDir: OUT,
  });

  try {
    const url = `${httpServer.origin}/fixtures/input-e2e-stress.html?panels=${panels}`;
    process.stdout.write(`\n=== phase: boot ${url} ===\n`);
    await chassis.boot({
      mode: 'run',
      url,
      frameRateHz: 60,
      blueprintId: 'input-e2e-stress-probe',
      slug: 'input-e2e-stress-probe',
      width: 1280,
      height: 800,
    });
    await wait(6500);

    const session = chassis.browser;
    if (!session) throw new Error('no session');

    // --- Phase A applyScrollCensus RTT ---
    process.stdout.write('\n=== phase: applyScrollCensus RTT (synthetic) ===\n');
    const measure =
      typeof session.measureApplyScrollCensus === 'function'
        ? session.measureApplyScrollCensus.bind(session)
        : null;
    if (!measure) {
      report.failed += 1;
      report.notes.push('measureApplyScrollCensus missing — rebuild session');
    } else {
      const matrix = [
        { contexts: 1, positions: 1 },
        { contexts: 1, positions: 8 },
        { contexts: 1, positions: 32 },
        { contexts: 1, positions: 64 },
        { contexts: 1, positions: 128 },
        { contexts: 1, positions: 256 },
        { contexts: 1, positions: 512 },
      ];
      const liveIds = chassis.contextIndex.list();
      report.notes.push(`live wire contexts: [${liveIds.join(', ')}]`);

      const applyRows = [];
      for (const cell of matrix) {
        const census = buildFatCensus(cell.contexts, cell.positions, { scrollY: 0 });
        census.contexts = census.contexts.filter((c) => c.contextId === 1);
        const samples = [];
        let lastOk = true;
        let lastErr = null;
        for (let i = 0; i < censusIters; i++) {
          const r = await measure(census);
          samples.push(r.ms);
          lastOk = r.ok;
          lastErr = r.error ?? null;
        }
        const row = {
          contexts: cell.contexts,
          positionsPerCtx: cell.positions,
          ok: lastOk,
          error: lastErr,
          ms: summarize(samples),
        };
        applyRows.push(row);
        console.log(
          `  ctx=${cell.contexts} pos=${cell.positions} ok=${lastOk} p50=${row.ms.p50?.toFixed(2)}ms p95=${row.ms.p95?.toFixed(2)}ms max=${row.ms.max?.toFixed(2)}ms` +
            (lastErr ? ` err=${lastErr}` : ''),
        );
        if (!lastOk) {
          report.failed += 1;
          report.notes.push(`applyScrollCensus failed at pos=${cell.positions}: ${lastErr}`);
        }
      }

      // Live multi-context (wire only — never invent ghost ids)
      if (liveIds.length > 1) {
        const liveCensus = {
          contexts: liveIds.map((contextId) => ({
            contextId,
            positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }],
          })),
        };
        const liveSamples = [];
        let liveOk = true;
        let liveErr = null;
        for (let i = 0; i < censusIters; i++) {
          const r = await measure(liveCensus);
          liveSamples.push(r.ms);
          liveOk = r.ok;
          liveErr = r.error ?? null;
        }
        const liveRow = {
          contexts: liveIds.length,
          contextIds: liveIds,
          positionsPerCtx: 1,
          ok: liveOk,
          error: liveErr,
          ms: summarize(liveSamples),
        };
        applyRows.push(liveRow);
        console.log(
          `  liveIds=[${liveIds.join(',')}] ok=${liveOk} p50=${liveRow.ms.p50?.toFixed(2)}ms p95=${liveRow.ms.p95?.toFixed(2)}ms` +
            (liveErr ? ` err=${liveErr}` : ''),
        );
        if (!liveOk) {
          report.failed += 1;
          report.notes.push(`live multi-ctx applyScrollCensus failed: ${liveErr}`);
        }
      }

      report.phases.applyScrollCensus = applyRows;

      // Heuristic bottleneck flags (single-context only)
      const lean = applyRows.find((r) => r.positionsPerCtx === 1 && r.contexts === 1);
      const fat = applyRows.find((r) => r.positionsPerCtx === 256 && r.contexts === 1);
      if (lean?.ms?.p95 != null && fat?.ms?.p95 != null) {
        const ratio = fat.ms.p95 / Math.max(0.001, lean.ms.p95);
        report.phases.censusBottleneck = {
          leanP95Ms: lean.ms.p95,
          fat256P95Ms: fat.ms.p95,
          ratio,
          flag: fat.ms.p95 > 8 || ratio > 20 ? 'investigate' : fat.ms.p95 > 3 ? 'watch' : 'ok',
        };
        console.log(
          `  bottleneck flag=${report.phases.censusBottleneck.flag} leanP95=${lean.ms.p95.toFixed(2)} fat256P95=${fat.ms.p95.toFixed(2)} ratio=${ratio.toFixed(1)}`,
        );
      }
    }

    // --- Functional stress ---
    process.stdout.write('\n=== phase: functional click/type/scroll ===\n');
    const clickSamples = [];
    for (let i = 0; i < clickN; i++) {
      const sel = `#cell-${i % 64}`;
      const t0 = performance.now();
      const out = await session.resolveAndClickDomInput(sel, 1);
      clickSamples.push(performance.now() - t0);
      if (out.status !== 'dispatched') {
        report.failed += 1;
        report.notes.push(`click ${sel} dropped: ${out.reason}`);
        break;
      }
    }
    report.phases.clickLatencyMs = summarize(clickSamples);

    const typed = await session.resolveAndTypeDomInput('#field', 'stress-ok', 1);
    if (typed.status !== 'dispatched') {
      report.failed += 1;
      report.notes.push(`type dropped: ${typed.reason}`);
    }

    const scrollSamples = [];
    for (const y of [200, 600, 1000, 1400, 0]) {
      const t0 = performance.now();
      const out = await session.resolveAndScrollViewportDomInput(y, 0, 1);
      scrollSamples.push(performance.now() - t0);
      if (out.status !== 'dispatched') {
        report.failed += 1;
        report.notes.push(`scrollY=${y} dropped: ${out.reason}`);
      }
    }
    report.phases.scrollSetLatencyMs = summarize(scrollSamples);

    // Fat census on real downs (full Phase A + ABS)
    process.stdout.write('\n=== phase: down/up with fat census (Phase A+ABS) ===\n');
    const fatPathSamples = [];
    const fatCensus = buildFatCensus(1, Math.min(panels + 1, 128), { scrollY: 0 });
    fatCensus.contexts = fatCensus.contexts.filter((c) => c.contextId === 1);
    for (let i = 0; i < 10; i++) {
      const base = {
        schemaVersion: 1,
        viewportW: 1280,
        viewportH: 800,
        x: 40 + (i % 10) * 8,
        y: 80 + (i % 8) * 6,
        button: 'left',
        census: fatCensus,
      };
      const t0 = performance.now();
      await session.pushInput({ ...base, type: 'move' });
      await session.pushInput({ ...base, type: 'down' });
      await session.pushInput({ ...base, type: 'up' });
      // drain via a tiny resolve scroll (flush)
      await session.resolveAndScrollViewportDomInput(0, 0, 1);
      fatPathSamples.push(performance.now() - t0);
    }
    report.phases.fatCensusPointerPathMs = summarize(fatPathSamples);
    console.log(
      `  fat pointer path p50=${report.phases.fatCensusPointerPathMs.p50?.toFixed(2)}ms p95=${report.phases.fatCensusPointerPathMs.p95?.toFixed(2)}ms`,
    );

    await wait(800);
    const assert = await session.evaluate(`(() => {
      const clicks = Number(document.getElementById('hud-clicks')?.textContent || '0');
      const field = document.getElementById('field')?.value ?? '';
      const mirror = document.getElementById('mirror')?.getAttribute('data-value') ?? '';
      const panels = Number(document.getElementById('hud-panels')?.textContent || '0');
      const scrollY = Number(document.getElementById('hud-scroll-y')?.textContent || '0');
      const ok = clicks >= ${Math.min(clickN, 4)} && field === 'stress-ok' && mirror === 'stress-ok';
      return JSON.stringify({ ok, clicks, field, mirror, panels, scrollY });
    })()`);
    let assertBody = { ok: false, reason: 'evaluate failed' };
    if (assert.ok) {
      try {
        assertBody = JSON.parse(assert.value || '{}');
      } catch {
        assertBody = { ok: false, reason: 'parse' };
      }
    } else {
      assertBody = { ok: false, reason: assert.errorMessage || 'evaluate failed' };
    }
    report.phases.functionalAssert = assertBody;
    console.log('  assert', assertBody);
    if (!assertBody.ok) {
      report.failed += 1;
      report.notes.push(`functional assert failed: ${JSON.stringify(assertBody)}`);
    }

    // Blueprint battery (foldable dossier)
    process.stdout.write('\n=== phase: blueprint input-e2e-stress ===\n');
    await chassis.dispose();
    const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
    const bpOut = path.join(OUT, 'blueprint');
    fs.mkdirSync(bpOut, { recursive: true });
    const bp = spawnSync(
      process.execPath,
      [cli, '--blueprint', 'input-e2e-stress', '--out', bpOut, '--headed'],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          SPECULUM_LAB_HEADED: '1',
          SPECULUM_INPUT_BACKEND: 'os',
          CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
        },
      },
    );
    report.phases.blueprintExit = bp.status ?? 1;
    if ((bp.status ?? 1) !== 0) {
      report.failed += 1;
      report.notes.push('blueprint input-e2e-stress failed');
    }
  } catch (err) {
    report.failed += 1;
    report.fatal = err instanceof Error ? err.message : String(err);
    console.error('[input-e2e-stress] fatal', err);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await httpServer.close();
  }

  // Interpret snapshot microbench
  if (Array.isArray(report.phases.snapshotMicrobench)) {
    const at512 = report.phases.snapshotMicrobench.find((r) => r.indexSize === 512);
    if (at512?.ms?.p95 != null) {
      report.phases.snapshotBottleneck = {
        index512P95Ms: at512.ms.p95,
        flag: at512.ms.p95 > 2 ? 'investigate' : at512.ms.p95 > 0.5 ? 'watch' : 'ok',
      };
      console.log(
        `\nsnapshot bottleneck flag=${report.phases.snapshotBottleneck.flag} index512 p95=${at512.ms.p95.toFixed(3)}ms`,
      );
    }
  }

  const reportPath = path.join(OUT, 'stress-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Failed: ${report.failed}`);
  if (report.notes.length) console.log('Notes:', report.notes.join(' | '));
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
