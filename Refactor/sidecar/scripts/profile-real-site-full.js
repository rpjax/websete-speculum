/**
 * "Complete" real-site CPU profile — unlike profile-virtual.js's default (which deliberately
 * waits `settleMs` past `domcontentloaded` before starting the profiler, to skip the SPA's own
 * boot/hydration burst and measure clean steady-state), this one profiles from t=0 of navigation
 * through a long tail, with zero gaps, and:
 *   (a) samples table growth (`sequence`/`tableSize`) on an interval so the boot burst is visible
 *       as a curve, not hidden by a single before/after snapshot;
 *   (b) buckets the CPU profile into time windows so "cost during hydration" and "cost at
 *       steady-state" are reported separately, not blended into one aggregate;
 *   (c) explicitly sums self-time for every known producer/client function by name across the
 *       WHOLE profile (not just whatever lands in a top-25 cutoff) — "didn't make top 25" is not
 *       the same claim as "cost is zero", and this session was asked to stop hand-waving that gap.
 *
 * CPU capture + self-time/bucket aggregation now come from `lab/cpuProfile.ts` (the official
 * Benchmark tool's CDP module) instead of a third copy of the same math — this script stays a
 * CLI entry point specifically for arbitrary real-site URLs under `transport: 'discard'`, which
 * the lab UI's own `runBenchmark` flow (always `transport: 'loopback'`) can't probe (real-site
 * CSP `connect-src` blocks that loopback WebSocket — frame-protocol.md decision log, 2026-08-13).
 *
 * Run: node scripts/profile-real-site-full.js <url> [totalDurationMs] [snapshotIntervalMs]
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('patchright');
const { loadInpageScript } = require('../dist/browser/mirror/projection/inject/loadInpageScript');
const { buildConfigPreScript } = require('../dist/browser/mirror/projection/inject/buildConfigPreScript');
const { startCpuProfile, stopCpuProfile } = require('../dist/browser/mirror/projection/lab/cpuProfile');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('Usage: node scripts/profile-real-site-full.js <https://...> [totalDurationMs] [snapshotIntervalMs]');
    process.exitCode = 1;
    return;
  }
  const totalDurationMs = Number(process.argv[3] || 30000);
  const snapshotIntervalMs = Number(process.argv[4] || 1000);

  const configPre = buildConfigPreScript({
    transport: 'discard',
    frameRateHz: 30,
    telemetry: { enabled: false },
  });
  const mainScript = loadInpageScript();

  const browser = await chromium.launch({ headless: true });
  let profileResult;
  const snapshots = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[pageerror]', err));
    await page.addInitScript({
      content: `globalThis.__speculumProfileErrors = [];
        addEventListener('error', (e) => globalThis.__speculumProfileErrors.push(String(e.error?.stack || e.message)));
        addEventListener('unhandledrejection', (e) => globalThis.__speculumProfileErrors.push(String(e.reason?.stack || e.reason)));`,
    });
    await page.addInitScript({ content: configPre });
    await page.addInitScript({ content: mainScript });

    const cdp = await context.newCDPSession(page);

    // Profiler starts BEFORE navigation — no settle gap, no skipped boot burst. The whole
    // lifecycle (parse, hydrate, settle) lands inside one continuous profile.
    await startCpuProfile(cdp, 100);
    const navStart = Date.now();

    const gotoPromise = page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      .catch((err) => {
        console.error('[goto failed]', err.message);
        return null;
      });

    let elapsed = 0;
    while (elapsed < totalDurationMs) {
      await wait(Math.min(snapshotIntervalMs, totalDurationMs - elapsed));
      elapsed = Date.now() - navStart;
      const snap = await page
        .evaluate(() => ({
          hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
          sequence: globalThis.__speculumProjection?.frameEmitter?.currentSequence ?? -1,
          tableSize: globalThis.__speculumProjection?.domNodes?.size ?? -1,
          url: location.href,
          title: document.title,
        }))
        .catch((err) => ({ error: String(err.message || err) }));
      snapshots.push({ tMs: elapsed, ...snap });
    }

    await gotoPromise;
    profileResult = await stopCpuProfile(cdp, 6); // 6 time buckets across the whole run

    const errors = await page
      .evaluate(() => globalThis.__speculumProfileErrors ?? [])
      .catch(() => []);
    console.log(`\nProducer-side errors observed: ${errors.length}`);
    if (errors.length > 0) console.log(errors.slice(0, 3));
  } finally {
    await browser.close().catch(() => {});
  }
  if (!profileResult) return;

  const outPath = path.join(__dirname, `full-profile-${Date.now()}.cpuprofile`);
  fs.writeFileSync(outPath, JSON.stringify(profileResult.raw));
  console.log(`Saved raw profile: ${outPath}`);

  console.log('\n=== Table growth over time (boot burst visible as a curve, not one snapshot) ===');
  console.log('  t(ms)   seq  tableSize  url/title');
  let prevSeq = 0;
  let prevSize = 0;
  for (const s of snapshots) {
    if (s.error) {
      console.log(`  ${String(s.tMs).padStart(6)}  ERROR: ${s.error}`);
      continue;
    }
    const dSeq = s.sequence - prevSeq;
    const dSize = s.tableSize - prevSize;
    console.log(
      `  ${String(s.tMs).padStart(6)}  ${String(s.sequence).padStart(4)}  ${String(s.tableSize).padStart(9)}  ` +
        `(Δseq ${dSeq >= 0 ? '+' : ''}${dSeq}, Δrows ${dSize >= 0 ? '+' : ''}${dSize})  ${s.title || ''}`,
    );
    prevSeq = s.sequence;
    prevSize = s.tableSize;
  }

  printSummary(profileResult.summary);
}

function printSummary(summary) {
  console.log(
    `\n=== Overall: samples=${summary.totalSamples}  wall=${summary.wallMs.toFixed(0)}ms  approx CPU~${summary.approxCpuMs.toFixed(0)}ms ===`,
  );

  console.log('\nTop self-time (whole run, unbucketed):');
  for (const r of summary.topSelfTime) {
    console.log(`  ${r.pct.toFixed(2).padStart(6)}%  ~${r.ms.toFixed(1).padStart(6)}ms  ${r.key}`);
  }

  console.log('\n=== Explicit accounting: every function on OUR allowlist, whole run, whether or not it made top-25 ===');
  if (summary.ourCode.byFunction.length === 0) {
    console.log('  (zero samples landed in any allowlisted producer function — literally 0 self-time, not "too small to rank")');
  } else {
    for (const r of summary.ourCode.byFunction) {
      console.log(`  ${r.pct.toFixed(3).padStart(7)}%  ~${r.ms.toFixed(2).padStart(6)}ms  ${r.key}`);
    }
  }
  console.log(
    `  TOTAL our-code self-time: ${summary.ourCode.totalPct.toFixed(3)}%  (~${summary.ourCode.totalMs.toFixed(2)}ms of ${summary.wallMs.toFixed(0)}ms wall)`,
  );

  if (summary.timeBuckets) {
    const n = summary.timeBuckets.length;
    console.log(`\n=== Time-bucketed breakdown (${n} buckets) ===`);
    for (const b of summary.timeBuckets) {
      const tRangeMs = `${b.rangeMs[0].toFixed(0)}-${b.rangeMs[1].toFixed(0)}ms`;
      console.log(
        `  [${tRangeMs.padStart(11)}]  idle=${b.idlePct.toFixed(1)}%  our-code=${b.ourCodePct.toFixed(3)}%  top: ${b.topNonIdle
          .map((t) => `${t.name}(${t.pct.toFixed(1)}%)`)
          .join(', ') || '(none)'}`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error('PROFILE FAIL', err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
