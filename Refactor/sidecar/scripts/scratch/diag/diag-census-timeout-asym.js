/**
 * Timeout asymmetry experiment:
 * APPLY_SCROLL bus idle 250ms under loopback idle 2000ms.
 * Ghost dest must fail ~250ms with Virtual reason — not outer invoke idle 2000ms.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'diag-census-timeout-asym');
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
    uok = require('../dist/browser/input/os/uinput').uinputAvailable() === true;
  } catch {
    uok = false;
  }
  if (!uok) {
    console.error('need Docker uinput');
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

  const virtualJs = fs.readFileSync(path.join(root, 'dist/browser/mirror/projection/virtual.js'), 'utf8');
  const has250 = virtualJs.includes('timeoutMs: 250') || virtualJs.includes('timeoutMs:250');

  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const { LOOPBACK_INVOKE_IDLE_MS } = require('@speculum/page-projection/core');
  const httpServer = await startFixtureHttp();
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  const report = {
    at: new Date().toISOString(),
    experiment: 'APPLY_SCROLL_TIMEOUT_MS=250 under LOOPBACK_INVOKE_IDLE_MS=2000',
    LOOPBACK_INVOKE_IDLE_MS,
    virtualBundleMentions250: has250,
    cases: [],
    verdict: null,
  };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${httpServer.origin}/fixtures/input-e2e-stress.html?panels=4`,
      frameRateHz: 60,
      blueprintId: 'diag-timeout-asym',
      slug: 'diag-timeout-asym',
      width: 1280,
      height: 800,
    });
    await wait(7000);
    const session = chassis.browser;
    report.wireContexts = chassis.contextIndex.list();

    for (const p of [
      { id: 'live-1-2', ids: [1, 2] },
      { id: 'ghost-3', ids: [3] },
      { id: 'mixed-1-2-3', ids: [1, 2, 3] },
    ]) {
      const t0 = performance.now();
      const r = await session.measureApplyScrollCensus(census(p.ids));
      const wall = performance.now() - t0;
      const row = { id: p.id, ids: p.ids, ok: r.ok, error: r.error ?? null, measureMs: r.ms, wallMs: wall };
      report.cases.push(row);
      console.log(`CASE ${p.id} ok=${r.ok} wall=${wall.toFixed(1)}ms err=${r.error ?? '-'}`);
    }

    const ghost = report.cases.find((c) => c.id === 'ghost-3');
    const live = report.cases.find((c) => c.id === 'live-1-2');
    const outerMsg = ghost?.error && String(ghost.error).includes('invoke idle timeout');
    const fastFail = ghost && ghost.wallMs < 800 && ghost.ok === false;
    const liveOk = live && live.ok === true && live.wallMs < 100;

    if (liveOk && fastFail && !outerMsg) {
      report.verdict = {
        proved:
          'Undeliverable dest fails via INNER ContextBus timeout (~250ms). Outer loopback stays open. Equal 2000/2000 masked this as outer TCS.',
        ghostWallMs: ghost.wallMs,
        ghostError: ghost.error,
      };
    } else if (liveOk && outerMsg) {
      report.verdict = {
        proved: 'UNEXPECTED: still outer TCS with APPLY_SCROLL=250',
        ghostWallMs: ghost.wallMs,
        ghostError: ghost.error,
      };
    } else {
      report.verdict = { proved: 'inconclusive', ghost, live };
    }
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

  const reportPath = path.join(OUT, 'asym-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\nVERDICT', JSON.stringify(report.verdict, null, 2));
  console.log('Report', reportPath);
  process.exit(report.fatal ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
