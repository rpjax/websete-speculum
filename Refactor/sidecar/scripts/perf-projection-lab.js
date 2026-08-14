/**
 * Throwaway perf probe for the §5/§5.8 algorithm (resyncVirtual bootstrap + tick-driven
 * TableFrameBuilder), driven against a real lab server (`lab/index.ts`) over its own WS control
 * channel — as opposed to profile-virtual.js/profile-real-site-full.js, which attach CDP directly
 * to a bare Chromium page. Not a smoke test, not committed to the pyramid — a `lab_first`
 * measurement run per the 2026-08-13 decision to validate the algorithm before formalizing it in
 * work-order.md.
 *
 * Percentile math + report export now come from `lab/metricsAggregator.ts` / `lab/runReport.ts`
 * (the official Benchmark tool's own modules) instead of a fourth copy of the same math — this
 * script stays a CLI entry point because it drives the lab server as a *client* over its public
 * WS protocol (`type: 'start'`/`'stop'`), rather than through `LabSession.runBenchmark` directly,
 * which is exactly the same data lab UI's own "Run Benchmark" button exercises.
 *
 * Run: node scripts/perf-projection-lab.js [fixture] [durationMs] [frameRateHz]
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { MetricsAggregator } = require('../dist/browser/mirror/projection/lab/metricsAggregator');
const { writeRunReport, defaultLabRunsDir } = require('../dist/browser/mirror/projection/lab/runReport');

const PORT = 4098;
const HOST = '127.0.0.1';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await wait(200);
  }
  throw new Error('lab health timeout');
}

async function runPerf(fixture, durationMs, frameRateHz) {
  const metrics = new MetricsAggregator();
  const start = Date.now();

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const hardTimer = setTimeout(() => {
      ws.close();
      reject(new Error('perf run timeout'));
    }, durationMs + 30_000);

    let stopTimer = null;

    const targetUrl = /^https?:\/\//.test(fixture) ? fixture : `http://${HOST}:${PORT}/fixtures/${fixture}`;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          url: targetUrl,
          telemetry: {
            enabled: true,
            frameEmitted: true,
            transportDeferred: true,
            aggregate: false,
            applyResult: false,
            desync: true,
            applyOverrun: true,
            clock: true,
            aggregateIntervalMs: durationMs + 1,
          },
          frameRateHz,
        }),
      );
      stopTimer = setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: 'stop' }));
          ws.close();
        } catch {
          // ignore
        }
      }, durationMs);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        metrics.observeWireBytes(data.length);
        return;
      }
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'telemetry' && msg.message) {
          metrics.observeTelemetry(msg.message);
          if (msg.message.kind === 'desynced') console.error('DESYNC', msg.message);
        }
        if (msg.type === 'error' || msg.type === 'ready' || msg.type === 'navigated') {
          console.log('[session]', JSON.stringify(msg));
        }
      } catch {
        // ignore
      }
    });
    ws.on('error', reject);
    ws.on('close', () => {
      clearTimeout(hardTimer);
      if (stopTimer) clearTimeout(stopTimer);
      resolve();
    });
  });

  return { summary: metrics.getSummary(Date.now() - start) };
}

async function main() {
  const fixture = process.argv[2] || 'mutation-churn.html';
  const durationMs = Number(process.argv[3] || 20_000);
  const frameRateHz = Number(process.argv[4] || 30);

  const env = {
    ...process.env,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
  };
  const child = spawn(
    process.execPath,
    [path.join('dist', 'browser', 'mirror', 'projection', 'lab', 'index.js')],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (d) => process.stderr.write(`[lab] ${d}`));

  let summary;
  try {
    await waitHealth(60_000);
    console.log(`Running ${durationMs}ms against ${fixture} @ ${frameRateHz}Hz ...`);
    ({ summary } = await runPerf(fixture, durationMs, frameRateHz));
  } finally {
    child.kill('SIGTERM');
    await wait(500);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }

  console.log('--- bootstrap (resyncVirtual) ---');
  console.log(
    `  sequence=${summary.bootstrap?.sequence} opCount=${summary.bootstrap?.opCount} bytes=${summary.bootstrap?.bytes} tableSize=${summary.bootstrap?.tableSize}`,
  );
  console.log('--- steady-state ticks (TableFrameBuilder) ---');
  console.log(
    `  frames=${summary.steadyFrameCount} over ${durationMs}ms (~${summary.steadyFps.toFixed(1)} fps, cap ${frameRateHz}Hz)`,
  );
  console.log(
    `  buildMs   min=${summary.buildMs.min.toFixed(3)} avg=${summary.buildMs.avg.toFixed(3)} p50=${summary.buildMs.p50.toFixed(3)} p95=${summary.buildMs.p95.toFixed(3)} max=${summary.buildMs.max.toFixed(3)}`,
  );
  console.log(
    `  opCount   min=${summary.opCount.min} avg=${summary.opCount.avg.toFixed(1)} p50=${summary.opCount.p50} p95=${summary.opCount.p95} max=${summary.opCount.max}`,
  );
  console.log(
    `  bytes     min=${summary.bytes.min} avg=${summary.bytes.avg.toFixed(0)} p50=${summary.bytes.p50} p95=${summary.bytes.p95} max=${summary.bytes.max}`,
  );
  console.log(`  tableSize end-of-run=${summary.lastTableSize} (OPEN-2: no NODE_DROP GC in v0, expect monotonic growth)`);
  console.log(`  wire bytes total (incl. bootstrap): ${summary.wireBytesTotal}`);
  console.log(`  desyncs=${summary.desyncCount}  applyOverruns=${summary.applyOverrunCount}`);

  const report = {
    meta: {
      timestamp: new Date().toISOString(),
      url: fixture,
      requestedDurationMs: durationMs,
      frameRateHz,
      options: { cpuProfile: false, invariants: false, structuralDiff: false },
    },
    metrics: summary,
    cpuProfile: null,
    invariants: null,
    structuralDiff: null,
  };
  const written = await writeRunReport(defaultLabRunsDir(), report, null);
  console.log(`\nReport written: ${written.reportPath}`);
}

main().catch((err) => {
  console.error('PERF FAIL', err);
  process.exitCode = 1;
});
