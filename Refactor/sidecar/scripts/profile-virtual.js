/**
 * CDP CPU profile of the Virtual-side producer under stress-churn.html, transport=console
 * (no dataplane needed — we only care about producer CPU, not wire delivery). Throwaway
 * diagnostic, not part of the pyramid: answers "is buildMs high because of the algorithm or
 * because of this implementation's constant factors" with a real self-time breakdown instead
 * of guessing. Run: node scripts/profile-virtual.js [durationMs]
 *
 * CPU capture + self-time aggregation now come from `lab/cpuProfile.ts` (the official Benchmark
 * tool's CDP module) instead of a fourth copy of the same math — this script stays a CLI entry
 * point specifically because it (and profile-real-site-full.js) need `transport: 'discard'`
 * against arbitrary real-site URLs, which the lab UI's own `runBenchmark` flow (always
 * `transport: 'loopback'` against its own data plane) can't do — real-site CSP `connect-src`
 * blocks that loopback WebSocket (frame-protocol.md decision log, 2026-08-13).
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('patchright');
const { loadInpageScript } = require('../dist/browser/mirror/projection/inject/loadInpageScript');
const { buildConfigPreScript } = require('../dist/browser/mirror/projection/inject/buildConfigPreScript');
const { startCpuProfile, stopCpuProfile } = require('../dist/browser/mirror/projection/lab/cpuProfile');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function serveFixture(fixturePath) {
  const html = fs.readFileSync(fixturePath);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function main() {
  const fixtureName = process.argv[2] || 'stress-churn.html';
  const durationMs = Number(process.argv[3] || 8000);
  const query = process.argv[4] || '';
  // Real sites behind an interstitial (Akamai/Cloudflare bot-check) still fire
  // `domcontentloaded` for the *challenge* page, not the real one — a fixed 500ms settle
  // isn't enough. Explicit 5th arg so a slow-clearing site can ask for more.
  const settleMs = Number(process.argv[5] || 500);
  const isRealUrl = /^https?:\/\//.test(fixtureName);

  let fixtureServer = null;
  let fixtureUrl;
  if (isRealUrl) {
    // Real-site probe (2026-08-13, "does the algorithm survive real DOM churn, not just our
    // own synthetic worst-case fixtures"): transport=discard means no data-plane WebSocket is
    // ever opened (bootstrap.ts skips LoopbackFrameTransport entirely for 'discard'), so a
    // real site's CSP `connect-src` — which blocks the loopback WS `perf-projection-lab.js`
    // needs — never comes into play here. CPU-only, same as the synthetic-fixture runs.
    fixtureUrl = fixtureName;
  } else {
    const fixturePath = path.join(
      __dirname,
      '..',
      'browser',
      'mirror',
      'projection',
      'lab',
      'static',
      'fixtures',
      fixtureName,
    );
    const served = await serveFixture(fixturePath);
    fixtureServer = served.server;
    fixtureUrl = query ? `${served.url}?${query}` : served.url;
  }

  const configPre = buildConfigPreScript({
    transport: 'discard',
    frameRateHz: 30,
    telemetry: { enabled: false },
  });
  const mainScript = loadInpageScript();

  const browser = await chromium.launch({ headless: true });
  let profileResult;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[pageerror]', err));
    // Patchright does not forward addInitScript-context console/pageerror events reliably
    // (same quirk hit during the §5.1 bootstrap-gap investigation) — capture into a polled
    // global instead of relying on page.on(...).
    await page.addInitScript({
      content: `globalThis.__speculumProfileErrors = [];
        addEventListener('error', (e) => globalThis.__speculumProfileErrors.push(String(e.error?.stack || e.message)));
        addEventListener('unhandledrejection', (e) => globalThis.__speculumProfileErrors.push(String(e.reason?.stack || e.reason)));`,
    });
    await page.addInitScript({ content: configPre });
    await page.addInitScript({ content: mainScript });

    const cdp = await context.newCDPSession(page);

    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await wait(settleMs);
    const before = await page.evaluate(() => ({
      hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
      sequence: globalThis.__speculumProjection?.frameEmitter?.currentSequence ?? -1,
      tableSize: globalThis.__speculumProjection?.domNodes?.size ?? -1,
      errors: globalThis.__speculumProfileErrors,
    }));
    console.log('page:', { url: page.url(), title: await page.title().catch(() => '(n/a)') });
    console.log('before:', before);

    await startCpuProfile(cdp, 100); // 100us — fine grain, short run
    await wait(durationMs);
    profileResult = await stopCpuProfile(cdp);

    const after = await page.evaluate(() => ({
      sequence: globalThis.__speculumProjection?.frameEmitter?.currentSequence ?? -1,
      tableSize: globalThis.__speculumProjection?.domNodes?.size ?? -1,
    }));
    console.log('after:', after);
  } finally {
    // Always close, even on a `page.goto` timeout — otherwise the child Chromium process
    // (and, on Windows, this script) is left hanging indefinitely.
    await browser.close().catch(() => {});
    fixtureServer?.close();
  }
  if (!profileResult) return;

  const outPath = path.join(__dirname, 'virtual-stress.cpuprofile');
  fs.writeFileSync(outPath, JSON.stringify(profileResult.raw));
  console.log(`Saved raw profile: ${outPath}`);

  const { summary } = profileResult;
  console.log(`\nTotal samples=${summary.totalSamples}  wall=${summary.wallMs.toFixed(0)}ms  approx CPU~${summary.approxCpuMs.toFixed(0)}ms`);
  console.log('\nTop self-time (by sample count) — where CPU actually goes:');
  for (const r of summary.topSelfTime) {
    console.log(`  ${r.pct.toFixed(1).padStart(5)}%  ~${r.ms.toFixed(1).padStart(6)}ms  ${r.key}`);
  }
  console.log(
    `\nOur-code total: ${summary.ourCode.totalPct.toFixed(2)}%  (~${summary.ourCode.totalMs.toFixed(2)}ms)`,
  );
}

main()
  .catch((err) => {
    console.error('PROFILE FAIL', err);
    process.exitCode = 1;
  })
  .finally(() => {
    // A `page.goto` timeout throws before `browser.close()` runs, leaving a headless
    // Chromium process (and this script) hanging indefinitely — force-exit either way.
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
