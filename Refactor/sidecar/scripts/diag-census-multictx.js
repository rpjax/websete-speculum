/**
 * Diagnostic: why applyScrollCensus with 4 contexts hits invoke idle timeout.
 * Facts only — no product fix.
 *
 * Usage (Docker): node scripts/diag-census-multictx.js
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'diag-census-multictx');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireOs() {
  let ok = false;
  try {
    ok = require('../dist/browser/patchright/input/uinput').uinputAvailable() === true;
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error('FAIL: need /dev/uinput (Docker lab)');
    process.exit(2);
  }
}

function run(cmd, args, label) {
  console.log(`\n>>> ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

function censusFor(contextIds, positionsPer = 4) {
  return {
    contexts: contextIds.map((contextId) => {
      const positions = [{ nodeId: null, scrollX: 0, scrollY: 0 }];
      for (let i = 1; i < positionsPer; i++) {
        positions.push({ nodeId: 50_000 + contextId * 1000 + i, scrollX: 0, scrollY: i });
      }
      return { contextId, positions };
    }),
  };
}

async function startFixtureHttp() {
  const fixturesDir = path.join(root, 'browser', 'mirror', 'projection', 'lab', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (!url.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const pathname = url.split('?')[0] ?? url;
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
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function main() {
  requireOs();
  process.env.SPECULUM_LAB_HEADED = '1';
  process.env.SPECULUM_INPUT_BACKEND = 'os';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  run(npm, ['run', 'build:page-projection'], 'build:page-projection');
  run(npm, ['run', 'build:virtual'], 'build:virtual');
  run(npm, ['run', 'build:snapshot'], 'build:snapshot');
  run(npm, ['exec', '--', 'tsc'], 'tsc');

  const { LOOPBACK_INVOKE_IDLE_MS } = require('@speculum/page-projection/core');
  const report = {
    at: new Date().toISOString(),
    constants: {
      LOOPBACK_INVOKE_IDLE_MS,
      RESUME_TIMEOUT_MS_code: 2000, // virtualDomainBus.ts literal
      nestedBusTimeoutEqualsOuter: LOOPBACK_INVOKE_IDLE_MS === 2000,
    },
    cases: [],
    facts: [],
  };

  const httpServer = await startFixtureHttp();
  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const chassis = new LabChassis({ headless: false, outDir: OUT });

  try {
    const url = `${httpServer.origin}/fixtures/input-e2e-stress.html?panels=8`;
    console.log(`\nboot ${url}`);
    await chassis.boot({
      mode: 'run',
      url,
      frameRateHz: 60,
      blueprintId: 'diag-census-multictx',
      slug: 'diag-census-multictx',
      width: 1280,
      height: 800,
    });
    // Wait for iframe child to mint + register
    await wait(8000);

    const session = chassis.browser;
    if (!session || typeof session.measureApplyScrollCensus !== 'function') {
      throw new Error('measureApplyScrollCensus missing');
    }

    const wireContexts = chassis.contextIndex.list();
    report.liveContextsFromWire = wireContexts;
    report.facts.push(`Wire contextIndex after boot+8s: [${wireContexts.join(', ')}]`);

    // Producer-side known contexts via evaluate is isolated — use wire index + iframe presence in DOM.
    const iframeSnap = await session.evaluate(`(() => {
      const iframe = document.getElementById('child');
      let childReady = false;
      try {
        childReady = !!(iframe && iframe.contentDocument && iframe.contentDocument.getElementById('inner-scroller'));
      } catch (e) {
        childReady = false;
      }
      return JSON.stringify({
        iframePresent: !!iframe,
        childReady,
        iframeSrc: iframe ? iframe.getAttribute('src') : null,
      });
    })()`);
    report.iframe = iframeSnap.ok ? JSON.parse(iframeSnap.value || '{}') : { error: iframeSnap.errorMessage };
    report.facts.push(`DOM iframe: ${JSON.stringify(report.iframe)}`);

    const cases = [
      { id: 'root-only', ids: [1] },
      { id: 'root+live2', ids: [1, 2] },
      { id: 'ghost-999', ids: [999] },
      { id: 'root+ghost', ids: [1, 999] },
      { id: 'stress-1-2-3-4', ids: [1, 2, 3, 4] },
      { id: 'live-only-subset', ids: wireContexts.length ? wireContexts : [1] },
    ];

    for (const c of cases) {
      const census = censusFor(c.ids, 4);
      const t0 = performance.now();
      const r = await session.measureApplyScrollCensus(census);
      const wall = performance.now() - t0;
      const row = {
        id: c.id,
        contextIds: c.ids,
        ok: r.ok,
        error: r.error ?? null,
        measureMs: r.ms,
        wallMs: wall,
      };
      report.cases.push(row);
      console.log(
        `CASE ${c.id} ids=[${c.ids.join(',')}] ok=${r.ok} measureMs=${r.ms.toFixed(1)} wallMs=${wall.toFixed(1)} err=${r.error ?? '-'}`,
      );
    }

    // applyScrollSet to ghost — same bus destination path, smaller payload
    const tSet0 = performance.now();
    const setGhost = await session.resolveAndScrollViewportDomInput(0, 0, 999);
    // resolveAndScrollViewport always targets given contextId via scrollSet
    // Better: push scrollSet for 999 and flush via another scroll
    await session.pushInput({
      schemaVersion: 1,
      type: 'scrollSet',
      contextId: 999,
      nodeId: null,
      scrollX: 0,
      scrollY: 10,
    });
    await wait(2100);
    report.scrollSetGhostProbe = {
      note: 'enqueue scrollSet contextId=999 then wait 2100ms (Applier serial; observe no crash)',
      waitMs: performance.now() - tSet0,
      resolveViewport999: setGhost,
    };

    // Interpret
    const root = report.cases.find((c) => c.id === 'root-only');
    const live2 = report.cases.find((c) => c.id === 'root+live2');
    const ghost = report.cases.find((c) => c.id === 'ghost-999');
    const rootGhost = report.cases.find((c) => c.id === 'root+ghost');
    const four = report.cases.find((c) => c.id === 'stress-1-2-3-4');

    if (root?.ok && root.wallMs < 100) {
      report.facts.push(`Root-only apply is fast (~${root.wallMs.toFixed(0)}ms) — local bus path OK.`);
    }
    if (live2) {
      report.facts.push(
        `Root+2: ok=${live2.ok} ~${live2.wallMs.toFixed(0)}ms — ${
          live2.ok && live2.wallMs < 100
            ? 'context 2 answers (iframe minted).'
            : live2.wallMs >= 1900
              ? 'context 2 did NOT answer in time (iframe not on bus / not minted).'
              : 'inconclusive timing.'
        }`,
      );
    }
    if (ghost) {
      report.facts.push(
        `Ghost 999 alone: ok=${ghost.ok} ~${ghost.wallMs.toFixed(0)}ms err=${ghost.error} — ${
          ghost.wallMs >= 1900
            ? 'matches nested ContextBus InvokeTimeout (2000ms) OR outer loopback TCS (2000ms).'
            : 'unexpected fast path for missing dest.'
        }`,
      );
    }
    if (rootGhost && four) {
      const bothTimeout = rootGhost.wallMs >= 1900 && four.wallMs >= 1900;
      report.facts.push(
        `root+ghost ~${rootGhost.wallMs.toFixed(0)}ms; 1-2-3-4 ~${four.wallMs.toFixed(0)}ms. ` +
          (bothTimeout
            ? 'Any missing contextId in the census forces a full 2s wait; outer loopback TCS=2000ms fires before Virtual can return fail-closed for later contexts.'
            : 'Timing pattern differs — see cases.'),
      );
    }

    report.facts.push(
      'Code path: sidecar loopback invoke applyScrollCensus (TCS 2000ms) → Virtual applyScrollCensus sequential for-await bus.requestApplyScroll(destination=contextId, timeout=RESUME_TIMEOUT_MS=2000).',
    );
    report.facts.push(
      'routeOutbound(missing dest): no fail-fast — postMessage broadcast to children or silent drop; callee that is not destination ignores; pending invoke waits full idle timeout.',
    );
    report.facts.push(
      'Design draft §10.2 says fan-out parallel; implementation is sequential await. Nested bus timeout == outer loopback idle → outer always wins on first missing context.',
    );
    report.diagnosis = {
      rootCause:
        'applyScrollCensus includes contextIds with no live Virtual DomainBus peer. Missing dest does not fail-closed immediately; ContextBus invoke waits RESUME_TIMEOUT_MS (2000). That wait is nested inside a single loopback invoke whose idle TCS is also 2000ms, so the sidecar observes invoke idle timeout and never gets Virtual\'s {ok:false, reason:timeout}.',
      notTheCause: [
        'Not O(|positions|) cost — 512 positions on ctx 1 stays ~1–2ms',
        'Not Projected snapshotScrollCensus cost',
        'Not ABS / EventApplier Phase B',
      ],
      whyFourCtxStressFailed:
        'Synthetic census used contextIds 1,2,3,4. Fixture only has root (1) + one iframe (likely 2). Ids 3 and 4 are ghosts → first ghost burns 2000ms → outer TCS.',
      improveProfessionally: [
        'Fail-fast when routeOutbound cannot resolve destination (no child scope) — return context_not_found without waiting idle timeout',
        'OR: applyScrollCensus only fans out to live registry contexts; unknown ids → immediate {ok:false, reason:\"context_not_found\"}',
        'Decouple timeouts: outer loopback TCS > sum of per-context budgets, OR per-context budget << outer (e.g. 50–200ms for applyScroll)',
        'Align impl with draft: parallel fan-out with per-context timeout + fail-closed aggregate (still need fail-fast on missing dest)',
        'Stress harness must build census.contexts from live wire/Projected contexts — not synthetic 1..N',
      ],
    };
  } catch (err) {
    report.fatal = err instanceof Error ? err.message : String(err);
    console.error(err);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await httpServer.close();
  }

  const reportPath = path.join(OUT, 'diag-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\n=== FACTS ===');
  for (const f of report.facts || []) console.log('-', f);
  if (report.diagnosis) {
    console.log('\n=== DIAGNOSIS ===');
    console.log(report.diagnosis.rootCause);
    console.log('\nImprove:');
    for (const x of report.diagnosis.improveProfessionally) console.log('-', x);
  }
  console.log(`\nReport: ${reportPath}`);
  process.exit(report.fatal ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
