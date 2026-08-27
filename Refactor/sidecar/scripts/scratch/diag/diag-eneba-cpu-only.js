'use strict';
/**
 * Follow-up: CPU profile only on Eneba (no evaluate during profile window).
 * CDP Profiler can sample even when page JS is wedged.
 *
 * SPECULUM_DIAG_LOOPBACK=1 node scripts/scratch/diag/diag-eneba-cpu-only.js
 */
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-scroll-stall-verdict');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const { summarizeProfile } = require(path.join(
    root,
    'dist/browser/mirror/projection/lab/probes/cpuProfile',
  ));
  const { drainInvokeDiagTraces } = require(path.join(
    root,
    'dist/browser/mirror/projection/session/nodeDataPlane',
  ));

  const chassis = new LabChassis({ headless: false, outDir: OUT });
  try {
    await chassis.boot({
      mode: 'run',
      url: 'data:text/html,<!doctype html><title>diag</title><body>ok</body>',
      frameRateHz: 30,
      blueprintId: 'diag-eneba-cpu-only',
      slug: 'diag-eneba-cpu-only',
      width: 1280,
      height: 720,
      cpuProfiling: true,
    });
    await wait(1500);
    await chassis.navigate('https://www.eneba.com/');
    // Settle without evaluate.
    await wait(12000);
    const session = chassis.browser;
    const start = await session.startCpuProfile();
    console.log('cpu start', start);
    // Scroll attempts during profile (loopback only — no evaluate).
    const scrolls = [];
    for (let i = 0; i < 3; i++) {
      drainInvokeDiagTraces();
      const r = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 300 + i * 80,
      });
      const traces = drainInvokeDiagTraces().filter((t) => t.name === 'applyScrollSet');
      scrolls.push({ r, traces });
      console.log('scroll', i, r, traces[0]);
      await wait(200);
    }
    await wait(2000);
    const stop = await Promise.race([
      session.stopCpuProfile(),
      wait(15000).then(() => ({ ok: false, reason: 'stopCpuProfile_timeout_15s' })),
    ]);
    console.log('cpu stop ok', stop.ok, stop.reason || stop.summary);
    let summary = null;
    if (stop.ok && stop.profileBytes) {
      const raw = JSON.parse(Buffer.from(stop.profileBytes).toString('utf8'));
      summary = summarizeProfile(raw, 10);
      fs.writeFileSync(path.join(OUT, 'eneba.cpuprofile'), JSON.stringify(raw));
      fs.writeFileSync(path.join(OUT, 'eneba-cpu-summary.json'), JSON.stringify(summary, null, 2));
    }
    const out = {
      start,
      scrolls,
      stopSummary: stop.summary ?? null,
      summary,
      topSelfTime: summary?.topSelfTime?.slice(0, 15) ?? null,
      ourCode: summary?.ourCode ?? null,
      buckets: summary?.timeBuckets ?? null,
    };
    fs.writeFileSync(path.join(OUT, 'eneba-cpu-only.json'), JSON.stringify(out, null, 2));
    console.log('TOP', JSON.stringify(out.topSelfTime, null, 2));
    console.log('OUR', JSON.stringify(out.ourCode, null, 2));
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
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
