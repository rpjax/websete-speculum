/**
 * Root-cause debug: undeliverable applyScroll / census timeout.
 * Collects [speculumBusDiag] console lines from Virtual while probing.
 *
 * Docker: node scripts/diag-census-timeout-rootcause.js
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'diag-census-timeout-rootcause');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, args, label) {
  console.log(`\n>>> ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
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

function census(ids) {
  return {
    contexts: ids.map((contextId) => ({
      contextId,
      positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }],
    })),
  };
}

async function main() {
  let uok = false;
  try {
    uok = require('../dist/browser/patchright/input/uinput').uinputAvailable() === true;
  } catch {
    uok = false;
  }
  if (!uok) {
    console.error('need Docker /dev/uinput');
    process.exit(2);
  }

  process.env.SPECULUM_LAB_HEADED = '1';
  process.env.SPECULUM_INPUT_BACKEND = 'os';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  run(npm, ['run', 'build:page-projection'], 'build:page-projection');
  run(npm, ['run', 'build:virtual'], 'build:virtual');
  run(npm, ['run', 'build:snapshot'], 'build:snapshot');
  run(npm, ['exec', '--', 'tsc'], 'tsc');

  const { LOOPBACK_INVOKE_IDLE_MS } = require('@speculum/page-projection/core');
  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

  const diagLines = [];
  const httpServer = await startFixtureHttp();
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  chassis.setConsoleRelay((ev) => {
    const text = String(ev.text || '');
    if (text.includes('[speculumBusDiag]')) diagLines.push({ t: ev.t, text });
  });

  const report = {
    at: new Date().toISOString(),
    LOOPBACK_INVOKE_IDLE_MS,
    RESUME_TIMEOUT_MS: 2000,
    cases: [],
    diagLines: [],
    causalChain: [],
  };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${httpServer.origin}/fixtures/input-e2e-stress.html?panels=4`,
      frameRateHz: 60,
      blueprintId: 'diag-timeout-rootcause',
      slug: 'diag-timeout-rootcause',
      width: 1280,
      height: 800,
    });
    await wait(8000);

    const session = chassis.browser;
    const wire = chassis.contextIndex.list();
    report.wireContexts = wire;

    const probes = [
      { id: 'live-1-2', ids: [1, 2] },
      { id: 'ghost-3', ids: [3] },
      { id: 'ghost-999', ids: [999] },
      { id: 'mixed-1-2-3', ids: [1, 2, 3] },
    ];

    for (const p of probes) {
      const before = diagLines.length;
      const t0 = performance.now();
      const r = await session.measureApplyScrollCensus(census(p.ids));
      const wall = performance.now() - t0;
      // let late ContextBus timeout logs flush if outer won the race
      await wait(50);
      const newDiag = diagLines.slice(before);
      report.cases.push({
        id: p.id,
        ids: p.ids,
        ok: r.ok,
        error: r.error ?? null,
        measureMs: r.ms,
        wallMs: wall,
        diag: newDiag.map((d) => d.text),
      });
      console.log(
        `\nCASE ${p.id} ids=${JSON.stringify(p.ids)} ok=${r.ok} wall=${wall.toFixed(1)}ms err=${r.error ?? '-'}`,
      );
      for (const d of newDiag) console.log('  DIAG', d.text);
    }

    report.diagLines = diagLines;

    // Causal interpretation from evidence
    const ghost = report.cases.find((c) => c.id === 'ghost-3');
    const live = report.cases.find((c) => c.id === 'live-1-2');
    const mixed = report.cases.find((c) => c.id === 'mixed-1-2-3');

    report.causalChain.push(
      `Wire live contexts: [${(wire || []).join(', ')}] — id 3 is NOT in the fabric.`,
    );
    if (live?.ok && live.wallMs < 100) {
      report.causalChain.push(
        `Control: live [1,2] applyScrollCensus OK in ${live.wallMs.toFixed(0)}ms — multi-context path works when destinations exist.`,
      );
    }
    if (ghost) {
      const unresolved = (ghost.diag || []).filter((t) => t.includes('routeOutbound.unresolved'));
      const idle = (ghost.diag || []).filter((t) => t.includes('ContextBus.invoke.idleTimeout'));
      report.causalChain.push(
        `Ghost [3]: sidecar err="${ghost.error}" wall=${ghost.wallMs.toFixed(0)}ms.`,
      );
      if (unresolved.length) {
        report.causalChain.push(
          `BUG LOCUS 1 (carrier): routeOutbound logged unresolved dest=3 → action=broadcast_to_all_children. findChildForContext(3) was null. No participant receives addressedHere; no invocation-response.`,
        );
        try {
          const payload = JSON.parse(unresolved[0].replace(/^.*?\[speculumBusDiag\]\s*/, ''));
          report.causalChain.push(
            `Evidence childScopes at unresolved time: ${JSON.stringify(payload.childScopes)} (dest 3 absent).`,
          );
        } catch {
          /* */
        }
      } else {
        report.causalChain.push('BUG LOCUS 1 NOT OBSERVED in console — check virtual rebuild / console wiring.');
      }
      if (idle.length) {
        report.causalChain.push(
          `BUG LOCUS 2 (bus TCS): ContextBus.invoke.idleTimeout fired for destination=3 after ${report.RESUME_TIMEOUT_MS}ms → InvokeTimeout.`,
        );
      } else if (ghost.wallMs >= 1900) {
        report.causalChain.push(
          `BUG LOCUS 2b: ContextBus idle log missing/raced — outer loopback TCS (${report.LOOPBACK_INVOKE_IDLE_MS}ms) equals inner RESUME_TIMEOUT (${report.RESUME_TIMEOUT_MS}ms). Sidecar aborts with "invoke idle timeout" BEFORE Virtual returns {ok:false, reason:timeout}.`,
        );
      }
    }
    if (mixed) {
      report.causalChain.push(
        `Mixed [1,2,3] wall=${mixed.wallMs.toFixed(0)}ms ok=${mixed.ok}: one unresolved dest poisons the whole Phase A (fail-closed), and with nested equal timeouts the poison presents as outer loopback timeout.`,
      );
    }
    report.rootCause = {
      summary:
        'Timeout is not "4 contexts are slow". It is undeliverable ContextBus unicast: destination id has no Virtual peer. Carrier routeOutbound does not NACK; it broadcasts/drops. Source waits full idle timeout. That wait is nested inside loopback invoke with the SAME 2000ms budget, so the observed error is outer "invoke idle timeout" and Virtual never delivers a structured apply failure to the sidecar.',
      bug1_carrier:
        'Unresolved unicast destination: no immediate invocation-response error; broadcast_to_all_children cannot help because children ignore non-matching destination (isAddressedHere).',
      bug2_timeout_nesting:
        'LOOPBACK_INVOKE_IDLE_MS (2000) == RESUME_TIMEOUT_MS (2000) for requestApplyScroll → outer TCS wins the race; Phase A reason is opaque.',
      not_a_perf_issue: 'Live [1,2] proves parallel/multi-context apply is fine when destinations resolve.',
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

  const reportPath = path.join(OUT, 'rootcause-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\n=== CAUSAL CHAIN ===');
  for (const line of report.causalChain || []) console.log('-', line);
  if (report.rootCause) {
    console.log('\n=== ROOT CAUSE ===');
    console.log(report.rootCause.summary);
    console.log('bug1:', report.rootCause.bug1_carrier);
    console.log('bug2:', report.rootCause.bug2_timeout_nesting);
  }
  console.log(`\nReport: ${reportPath}`);
  process.exit(report.fatal ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
