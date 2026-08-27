'use strict';
/**
 * One-shot proof: `sparse-cdp` id-addressed click end-to-end (decision-log.md 2026-08-27).
 *
 * Exercises the FULL live wire, not a unit mock: `resolveAndClickDomInputByNodeId` enqueues a
 * down/up with `nodeId` set and no `census` → `EventApplier.resolveClickTarget` branch →
 * sidecar `loopbackInvoke('resolveNodeHit')` → Virtual `bus.onInvocation('resolveNodeHit')` →
 * `domNodes.get(nodeId)` → live root-viewport point → `sparse-cdp`'s CDP dispatch. Asserts via
 * a real DOM state read (`#status[data-state]`), not a protocol-only signal (per
 * docs/page-projection/spec/acceptance.md — never pass/fail from event telemetry alone).
 *
 * Docker: node scripts/scratch/diag/diag-nodeid-click.js
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-nodeid-click');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function proveRootClick(chassis, fixtureOrigin) {
  await chassis.boot({
    mode: 'run',
    url: `${fixtureOrigin}/fixtures/input-click.html`,
    frameRateHz: 60,
    blueprintId: 'diag-nodeid-click-root',
    slug: 'diag-nodeid-click-root',
    width: 800,
    height: 600,
    inputAdapterKind: 'sparse-cdp',
  });
  await wait(1500);
  const session = chassis.browser;

  const before = await session.evaluate("document.getElementById('status')?.getAttribute('data-state') ?? null");
  if (!before.ok) throw new Error(`before-read failed: ${before.errorMessage}`);
  console.log(`[root] before: data-state=${before.value}`);
  if (before.value === 'clicked') throw new Error('fixture already clicked before dispatch — bad test setup');

  const r = await session.resolveAndClickDomInputByNodeId('#click-me');
  if (r.status !== 'dispatched') throw new Error(`nodeId click dispatch dropped: ${r.reason}`);
  await wait(500);

  const after = await session.evaluate("document.getElementById('status')?.getAttribute('data-state') ?? null");
  if (!after.ok) throw new Error(`after-read failed: ${after.errorMessage}`);
  console.log(`[root] after:  data-state=${after.value}`);
  if (after.value !== 'clicked') {
    throw new Error('FAIL(root): nodeId-addressed click did not flip #status — resolveNodeHit path broken');
  }
  console.log('PASS(root): sparse-cdp nodeId-addressed click resolved live coords via Virtual and landed on #click-me');
}

async function proveNestedClick(chassis, fixtureOrigin) {
  await chassis.boot({
    mode: 'run',
    url: `${fixtureOrigin}/fixtures/iframe-open.html`,
    frameRateHz: 60,
    blueprintId: 'diag-nodeid-click-nested',
    slug: 'diag-nodeid-click-nested',
    width: 800,
    height: 600,
    inputAdapterKind: 'sparse-cdp',
  });
  await wait(12000); // generous nested-context attach margin (shared docker host under load)
  const session = chassis.browser;

  const readInner = "document.getElementById('child')?.contentDocument?.getElementById('inner-status')?.getAttribute('data-state') ?? null";
  const before = await session.evaluate(readInner);
  if (!before.ok) throw new Error(`before-read (nested) failed: ${before.errorMessage}`);
  console.log(`[nested ctx=2] before: data-state=${before.value}`);
  if (before.value === 'clicked') throw new Error('nested fixture already clicked before dispatch — bad test setup');

  // Sanity: is contextId=2 even reachable via the proven coordinate/selector path first?
  const sanity = await session.resolveAndClickDomInput('#inner-click', 2);
  console.log(`[nested ctx=2] sanity resolveAndClickDomInput (coordinate path): ${JSON.stringify(sanity)}`);
  const sanityAfter = await session.evaluate(readInner);
  console.log(`[nested ctx=2] sanity after: data-state=${sanityAfter.value}`);
  // Reset for the real nodeId-path test below.
  await session.evaluate(
    "(() => { const el = document.getElementById('child')?.contentDocument?.getElementById('inner-status'); if (el) { el.setAttribute('data-state', 'idle'); el.textContent = 'idle'; } })()",
  );

  // contextId=2 — proves requestResolveNodeHit addresses the specific nested context, not just root.
  const r = await session.resolveAndClickDomInputByNodeId('#inner-click', 2);
  if (r.status !== 'dispatched') throw new Error(`nested nodeId click dispatch dropped: ${r.reason}`);
  await wait(500);

  const after = await session.evaluate(readInner);
  if (!after.ok) throw new Error(`after-read (nested) failed: ${after.errorMessage}`);
  console.log(`[nested ctx=2] after:  data-state=${after.value}`);
  if (after.value !== 'clicked') {
    throw new Error('FAIL(nested): nodeId-addressed click into contextId=2 did not flip #inner-status');
  }
  console.log('PASS(nested): sparse-cdp nodeId-addressed click resolved live coords in nested contextId=2 via Virtual');
}

async function main() {
  process.env.SPECULUM_LAB_HEADED = '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  const { LabChassis } = require('../../../dist/browser/mirror/projection/lab/host/chassis');
  const fixture = await startFixtureHttp();
  try {
    const chassisRoot = new LabChassis({ headless: false, outDir: path.join(OUT, 'root') });
    try {
      await proveRootClick(chassisRoot, fixture.origin);
    } finally {
      await chassisRoot.disposeVirtual().catch(() => undefined);
    }

    const chassisNested = new LabChassis({ headless: false, outDir: path.join(OUT, 'nested') });
    try {
      await proveNestedClick(chassisNested, fixture.origin);
    } finally {
      await chassisNested.disposeVirtual().catch(() => undefined);
    }
  } finally {
    await fixture.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
