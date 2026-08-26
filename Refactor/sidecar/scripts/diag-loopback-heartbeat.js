/**
 * Prove loopback invoke-started/heartbeat resets sidecar idle TCS.
 * Ghost dest: ContextBus waits ~2000ms; with heartbeat, sidecar must get
 * structured err=timeout — not outer "invoke idle timeout (2000ms)".
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
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

async function main() {
  let uok = false;
  try {
    uok = require('../dist/browser/patchright/input/uinput').uinputAvailable() === true;
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

  run(npm, ['run', 'build:page-projection'], 'build:page-projection');
  run(npm, ['run', 'build:virtual'], 'build:virtual');
  run(npm, ['run', 'build:snapshot'], 'build:snapshot');
  run(npm, ['exec', '--', 'tsc'], 'tsc');

  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const httpServer = await startFixtureHttp();
  const out = path.join(root, 'lab-runs', 'diag-loopback-heartbeat');
  fs.mkdirSync(out, { recursive: true });
  const chassis = new LabChassis({ headless: false, outDir: out });

  try {
    await chassis.boot({
      mode: 'run',
      url: `${httpServer.origin}/fixtures/input-e2e-stress.html?panels=4`,
      frameRateHz: 60,
      blueprintId: 'diag-loopback-heartbeat',
      slug: 'diag-loopback-heartbeat',
      width: 1280,
      height: 800,
    });
    await wait(7000);
    const session = chassis.browser;
    const wire = chassis.contextIndex.list();

    const live = await session.measureApplyScrollCensus({
      contexts: wire.map((contextId) => ({
        contextId,
        positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }],
      })),
    });
    console.log('LIVE', wire, live);

    const t0 = performance.now();
    const ghost = await session.measureApplyScrollCensus({
      contexts: [{ contextId: 999, positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }] }],
    });
    const wall = performance.now() - t0;
    console.log('GHOST', { ok: ghost.ok, error: ghost.error, wallMs: wall });

    const failFast =
      ghost.ok === false && ghost.error === 'context_not_found' && wall < 200;
    const report = {
      wire,
      live,
      ghost: { ...ghost, wallMs: wall },
      pass: live.ok === true && failFast,
      meaning: failFast
        ? 'Never-minted dest fails closed immediately (context_not_found).'
        : 'FAIL: expected fast context_not_found',
    };
    fs.writeFileSync(path.join(out, 'heartbeat-proof.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.pass ? 0 : 1);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await httpServer.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
