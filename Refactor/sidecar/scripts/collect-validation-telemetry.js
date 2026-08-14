/**
 * One-shot validation pass: lab runBenchmark (metrics + CPU + invariants + structuralDiff)
 * on synthetic fixtures, then requestTableLiveOracle. Writes lab-runs/validation-summary.json.
 * Real-site CPU stays on profile-virtual.js (transport: discard).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const HOST = '127.0.0.1';
const PORT = 4096;

const SYNTHETIC = [
  { fixture: 'static-dom.html', durationMs: 8_000 },
  { fixture: 'insert-before-remove.html', durationMs: 10_000 },
  { fixture: 'demo.html', durationMs: 12_000 },
  { fixture: 'mutation-churn.html', durationMs: 12_000 },
  { fixture: 'forms-state.html', durationMs: 8_000 },
  { fixture: 'scroll.html', durationMs: 8_000 },
  { fixture: 'stress-churn.html', durationMs: 15_000 },
  { fixture: 'prepend-stress.html', durationMs: 15_000 },
];

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

function runOneBenchmark(fixture, durationMs) {
  const url = `http://${HOST}:${PORT}/fixtures/${fixture}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`timeout benchmark ${fixture}`));
    }, durationMs + 90_000);

    const out = { fixture, url, durationMs, benchmark: null, tableLiveOracle: null, errors: [] };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'runBenchmark',
          url,
          durationMs,
          frameRateHz: 30,
          telemetry: {
            enabled: true,
            frameEmitted: true,
            transportDeferred: true,
            aggregate: true,
            applyResult: true,
            desync: true,
            applyOverrun: true,
            clock: true,
            aggregateIntervalMs: 2000,
          },
          options: { cpuProfile: true, invariants: true, structuralDiff: true },
        }),
      );
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'error') out.errors.push(msg.message);
      if (msg.type === 'benchmarkComplete') {
        out.benchmark = {
          reportDir: msg.reportDir,
          reportPath: msg.reportPath,
          metrics: msg.report?.metrics ?? null,
          cpuOurCodePct: msg.report?.cpuProfile?.summary?.ourCode?.totalPct ?? null,
          cpuOurCodeMs: msg.report?.cpuProfile?.summary?.ourCode?.totalMs ?? null,
          cpuTop: (msg.report?.cpuProfile?.summary?.topSelfTime ?? []).slice(0, 8),
          ourFunctions: (msg.report?.cpuProfile?.summary?.ourCode?.byFunction ?? []).slice(0, 12),
          invariants: msg.report?.invariants ?? null,
          structuralDiff: msg.report?.structuralDiff ?? null,
        };
        ws.send(JSON.stringify({ type: 'requestTableLiveOracle' }));
        setTimeout(() => {
          if (out.tableLiveOracle) return;
          clearTimeout(timer);
          try {
            ws.send(JSON.stringify({ type: 'stop' }));
          } catch {
            // ignore
          }
          ws.close();
          resolve(out);
        }, 20_000);
      }
      if (msg.type === 'tableLiveOracleResult') {
        out.tableLiveOracle = msg;
        clearTimeout(timer);
        try {
          ws.send(JSON.stringify({ type: 'stop' }));
        } catch {
          // ignore
        }
        ws.close();
        resolve(out);
      }
    });

    ws.on('error', reject);
    ws.on('close', () => {
      clearTimeout(timer);
      if (out.benchmark && !out.tableLiveOracle) resolve(out);
    });
  });
}

async function main() {
  const env = { ...process.env, SPECULUM_LAB_HOST: HOST, SPECULUM_LAB_PORT: String(PORT) };
  const child = spawn(process.execPath, [path.join('dist', 'browser', 'mirror', 'projection', 'lab', 'index.js')], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[lab] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[lab] ${d}`));

  const results = [];
  try {
    await waitHealth(60_000);
    for (const row of SYNTHETIC) {
      console.log(`\n=== BENCHMARK ${row.fixture} ${row.durationMs}ms ===`);
      try {
        const r = await runOneBenchmark(row.fixture, row.durationMs);
        results.push(r);
        const m = r.benchmark?.metrics;
        const invFails = (r.benchmark?.invariants ?? []).filter((c) => c.failCount > 0);
        const sd = r.benchmark?.structuralDiff;
        console.log(
          JSON.stringify({
            fixture: row.fixture,
            fps: m?.steadyFps,
            buildMsP95: m?.buildMs?.p95,
            applyMsP95: m?.applyMs?.p95,
            tableSize: m?.lastTableSize,
            desyncs: m?.desyncCount,
            overruns: m?.applyOverrunCount,
            ourCpuPct: r.benchmark?.cpuOurCodePct,
            structuralIdentical: sd?.status === 'ok' ? sd.result?.identical : sd?.status,
            o2Identical: r.tableLiveOracle?.result?.identical,
            invariantFails: invFails.map((c) => `${c.id}:${c.failCount}`),
            errors: r.errors,
          }),
        );
      } catch (err) {
        console.error(`FAIL ${row.fixture}`, err);
        results.push({ fixture: row.fixture, error: String(err) });
      }
      await wait(800);
    }
  } finally {
    child.kill('SIGTERM');
    await wait(500);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }

  const outDir = path.join(process.cwd(), 'lab-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'validation-synthetic.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
