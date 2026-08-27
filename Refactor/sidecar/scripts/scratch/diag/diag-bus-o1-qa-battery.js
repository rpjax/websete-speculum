'use strict';
/**
 * QA battery — ChildScopeIndex / VirtualDomainBus O(1) fabric (post querySelectorAll removal).
 *
 * Phases:
 *   A) control scroll + never-minted fail-closed
 *   B) ghost minted-then-dead → fail-closed <300ms (not 2s hang)
 *   C) iframe stress fixture: many hosts + scroll/root stay responsive
 *   D) Eneba: CPU profile (querySelectorAll must not dominate) + scroll RTTs
 *   E) input-click blueprint effect oracle
 *
 * Docker:
 *   SPECULUM_DIAG_LOOPBACK=1 node scripts/scratch/diag/diag-bus-o1-qa-battery.js
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-bus-o1-qa');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startFixtureHttp() {
  const fixturesDir = path.join(root, 'browser', 'mirror', 'projection', 'lab', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = (url.split('?')[0] ?? url);
    if (!pathname.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
    if (!file.startsWith(path.normalize(fixturesDir)) || !fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const ct = file.endsWith('.js')
      ? 'application/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': ct });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function pass(name, ok, detail) {
  return { name, ok: !!ok, detail: detail ?? null };
}

function topKeyHas(summary, re) {
  const top = summary?.topSelfTime ?? [];
  return top.some((row) => re.test(row.key));
}

function pctOf(summary, re) {
  const top = summary?.topSelfTime ?? [];
  return top.filter((row) => re.test(row.key)).reduce((s, r) => s + (r.pct || 0), 0);
}

async function main() {
  if (process.env.SPECULUM_DIAG_LOOPBACK !== '1') {
    console.error('Set SPECULUM_DIAG_LOOPBACK=1');
    process.exit(2);
  }
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const { drainInvokeDiagTraces } = require(path.join(
    root,
    'dist/browser/mirror/projection/session/nodeDataPlane',
  ));
  const { summarizeProfile } = require(path.join(
    root,
    'dist/browser/mirror/projection/lab/probes/cpuProfile',
  ));
  const { ChildScopeIndex } = require(path.join(
    root,
    '..',
    'packages',
    'page-projection',
    'dist',
    'virtual',
    'dom',
    'childScopes',
  ));

  const report = {
    startedAt: new Date().toISOString(),
    gates: [],
    phases: {},
  };

  // --- Phase 0: pure index stress (no Chrome) ---
  {
    let next = 2;
    const index = new ChildScopeIndex(() => next++);
    const nodes = new Map();
    const N = 400;
    for (let i = 0; i < N; i++) {
      const w = { id: i };
      const host = { nodeType: 1, isConnected: true, contentWindow: w };
      nodes.set(1000 + i, host);
      const a = index.admit(1000 + i, host);
      if (a.kind !== 'host') throw new Error('admit failed');
    }
    let live = 0;
    const t0 = performance.now();
    for (let round = 0; round < 50; round++) {
      live = 0;
      index.forEachLiveWindow(
        (id) => nodes.get(id),
        () => {
          live += 1;
        },
      );
    }
    const wall = performance.now() - t0;
    // drop half
    for (let i = 0; i < N / 2; i++) index.drop(1000 + i);
    let afterDrop = 0;
    index.forEachLiveWindow(
      (id) => nodes.get(id),
      () => {
        afterDrop += 1;
      },
    );
    const dead = index.windowOf(2, (id) => nodes.get(id)); // first minted was 2, dropped
    report.phases.indexStress = {
      N,
      liveAfterAdmit: live,
      afterDrop,
      deadWindowNull: dead === null,
      fiftyForEachMs: wall,
    };
    report.gates.push(pass('index-stress-count', live === N, { live, N }));
    report.gates.push(pass('index-stress-drop', afterDrop === N / 2, { afterDrop }));
    report.gates.push(pass('index-stress-dead-null', dead === null));
    report.gates.push(pass('index-stress-speed', wall < 200, { wallMs: wall }));
    console.log('P0 indexStress', report.phases.indexStress);
  }

  const httpServer = await startFixtureHttp();
  const chassis = new LabChassis({ headless: false, outDir: OUT });

  try {
    // --- Phase A: control ---
    await chassis.boot({
      mode: 'run',
      url: `${httpServer.origin}/fixtures/input-click.html`,
      frameRateHz: 30,
      blueprintId: 'qa-bus-o1-control',
      slug: 'qa-bus-o1-control',
      width: 1280,
      height: 720,
      cpuProfiling: true,
    });
    await wait(2000);
    let session = chassis.browser;
    drainInvokeDiagTraces();
    const control = await session.measureApplyScrollSet({
      contextId: 1,
      nodeId: null,
      scrollX: 0,
      scrollY: 40,
    });
    const controlTrace = drainInvokeDiagTraces().find((t) => t.name === 'applyScrollSet');
    const never = await session.measureApplyScrollSet({
      contextId: 99999,
      nodeId: null,
      scrollX: 0,
      scrollY: 0,
    });
    report.phases.control = { control, controlTrace, never };
    report.gates.push(pass('control-scroll-ok', control.ok === true && control.wallMs < 500, control));
    report.gates.push(
      pass(
        'never-minted-fail-closed',
        never.ok === false && /context_not_found/i.test(never.error || '') && never.wallMs < 300,
        never,
      ),
    );
    console.log('PA', { control: control.wallMs, never: never.wallMs, err: never.error });

    // --- Phase B: ghost ---
    await chassis.navigate(`${httpServer.origin}/fixtures/input-ghost-context.html`);
    await wait(7000);
    session = chassis.browser;
    const listed =
      typeof chassis.contextIndex?.list === 'function' ? chassis.contextIndex.list() : [1];
    const deadCandidate = listed.filter((id) => id !== 1).sort((a, b) => b - a)[0] ?? null;
    let ghost = { skipped: true, reason: 'no dead candidate' };
    if (deadCandidate != null) {
      drainInvokeDiagTraces();
      const r = await session.measureApplyScrollSet({
        contextId: deadCandidate,
        nodeId: null,
        scrollX: 0,
        scrollY: 10,
      });
      const traces = drainInvokeDiagTraces().filter((t) => t.name === 'applyScrollSet');
      ghost = { deadCandidate, r, traces };
      const fastFail =
        r.ok === false &&
        /context_not_found/i.test(r.error || '') &&
        r.wallMs < 300 &&
        !(traces[0]?.heartbeats > 0 && r.wallMs >= 1800);
      report.gates.push(pass('ghost-fail-closed-fast', fastFail, ghost));
    } else {
      report.gates.push(pass('ghost-fail-closed-fast', false, ghost));
    }
    report.phases.ghost = { listed, ghost };
    console.log('PB ghost', JSON.stringify(ghost).slice(0, 400));

    // --- Phase C: stress many iframes ---
    const stressHtml = `<!doctype html><html><head><meta charset=utf-8><title>bus-o1-stress</title></head>
<body style="margin:0;height:4000px;font:14px monospace">
<div id="status">boot</div>
<script>
(function(){
  var n = 120;
  for (var i = 0; i < n; i++) {
    var f = document.createElement('iframe');
    f.width = 10; f.height = 10;
    f.src = 'about:blank';
    document.body.appendChild(f);
  }
  document.getElementById('status').textContent = 'iframes=' + n;
})();
</script>
</body></html>`;
    const stressPath = path.join(
      root,
      'browser',
      'mirror',
      'projection',
      'lab',
      'fixtures',
      '_qa-bus-o1-stress.html',
    );
    fs.writeFileSync(stressPath, stressHtml);
    await chassis.navigate(`${httpServer.origin}/fixtures/_qa-bus-o1-stress.html`);
    await wait(5000);
    session = chassis.browser;
    const stressScrolls = [];
    for (let i = 0; i < 8; i++) {
      drainInvokeDiagTraces();
      const r = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 100 + i * 50,
      });
      const tr = drainInvokeDiagTraces().find((t) => t.name === 'applyScrollSet');
      stressScrolls.push({ r, tr });
    }
    const stressOk = stressScrolls.filter((s) => s.r.ok && s.r.wallMs < 800);
    const stressOuterIdle = stressScrolls.filter((s) =>
      /invoke idle timeout/i.test(s.r.error || ''),
    );
    report.phases.iframeStress = {
      scrolls: stressScrolls.map((s) => ({
        ok: s.r.ok,
        wallMs: s.r.wallMs,
        error: s.r.error,
        started: s.tr?.started,
        heartbeats: s.tr?.heartbeats,
      })),
      okCount: stressOk.length,
      outerIdleCount: stressOuterIdle.length,
    };
    report.gates.push(
      pass('iframe-stress-root-scroll', stressOk.length >= 6 && stressOuterIdle.length === 0, {
        okCount: stressOk.length,
        outerIdle: stressOuterIdle.length,
      }),
    );
    console.log('PC stress', report.phases.iframeStress.okCount, 'ok /', stressScrolls.length);

    // --- Phase D: Eneba CPU + scroll ---
    await chassis.navigate('https://www.eneba.com/');
    await wait(12000);
    session = chassis.browser;
    const cpuStart = await session.startCpuProfile();
    const enebaScrolls = [];
    for (let i = 0; i < 5; i++) {
      drainInvokeDiagTraces();
      const r = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 250 + i * 100,
      });
      const tr = drainInvokeDiagTraces().find((t) => t.name === 'applyScrollSet');
      enebaScrolls.push({ r, tr });
      await wait(200);
    }
    await wait(1500);
    const cpuStop = await Promise.race([
      session.stopCpuProfile(),
      wait(20000).then(() => ({ ok: false, reason: 'cpu_stop_timeout' })),
    ]);
    let cpuSummary = null;
    if (cpuStop.ok && cpuStop.profileBytes) {
      const raw = JSON.parse(Buffer.from(cpuStop.profileBytes).toString('utf8'));
      cpuSummary = summarizeProfile(raw, 8);
      fs.writeFileSync(path.join(OUT, 'eneba.cpuprofile'), JSON.stringify(raw));
      fs.writeFileSync(path.join(OUT, 'eneba-cpu-summary.json'), JSON.stringify(cpuSummary, null, 2));
    }
    const qsaPct = pctOf(cpuSummary, /querySelectorAll/i);
    const hasQsaTop = topKeyHas(cpuSummary, /querySelectorAll/i);
    const enebaOk = enebaScrolls.filter((s) => s.r.ok && s.r.wallMs < 1000);
    const enebaIdle = enebaScrolls.filter((s) => /invoke idle timeout/i.test(s.r.error || ''));
    report.phases.eneba = {
      cpuStart,
      scrolls: enebaScrolls.map((s) => ({
        ok: s.r.ok,
        wallMs: s.r.wallMs,
        error: s.r.error,
        started: s.tr?.started,
      })),
      qsaPct,
      hasQsaTop,
      top5: cpuSummary?.topSelfTime?.slice(0, 5) ?? null,
      ourCodePct: cpuSummary?.ourCode?.totalPct ?? null,
    };
    report.gates.push(
      pass('eneba-no-qsa-storm', qsaPct < 5 && !hasQsaTop, { qsaPct, top5: report.phases.eneba.top5 }),
    );
    report.gates.push(
      pass('eneba-scroll-responsive', enebaOk.length >= 3 && enebaIdle.length === 0, {
        ok: enebaOk.length,
        idle: enebaIdle.length,
      }),
    );
    console.log('PD eneba qsaPct=', qsaPct, 'scrollOk=', enebaOk.length, 'idle=', enebaIdle.length);

    // --- Phase E: click effect ---
    await chassis.navigate(`${httpServer.origin}/fixtures/input-click.html`);
    await wait(2500);
    session = chassis.browser;
    const before = await session.evaluate(
      "document.getElementById('status')?.getAttribute('data-state') ?? null",
    );
    const click = await session.resolveAndClickDomInputByNodeId('#click-me');
    await wait(600);
    const after = await session.evaluate(
      "document.getElementById('status')?.getAttribute('data-state') ?? null",
    );
    const clickOk =
      before.ok &&
      after.ok &&
      after.value === 'clicked' &&
      click.status === 'dispatched';
    report.phases.click = { before: before.value, after: after.value, click };
    report.gates.push(pass('input-click-effect', clickOk, report.phases.click));
    console.log('PE click', before.value, '→', after.value);
  } finally {
    try {
      await chassis.disposeVirtual();
    } catch {
      /* */
    }
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await httpServer.close();
    try {
      fs.unlinkSync(
        path.join(root, 'browser/mirror/projection/lab/fixtures/_qa-bus-o1-stress.html'),
      );
    } catch {
      /* */
    }
  }

  const failed = report.gates.filter((g) => !g.ok);
  report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  report.failedGates = failed.map((g) => g.name);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log('\n======== QA VERDICT:', report.verdict, '========');
  for (const g of report.gates) {
    console.log(g.ok ? 'PASS' : 'FAIL', g.name, g.detail ? JSON.stringify(g.detail).slice(0, 160) : '');
  }
  console.log('Wrote', path.join(OUT, 'qa-report.json'));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
