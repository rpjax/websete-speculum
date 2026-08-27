'use strict';
/**
 * Single objective verdict for Virtual scroll stall / apply_scroll_failed idle timeout.
 *
 * Distinguishes (no guesswork):
 *   A) OUTER_IDLE_NO_STARTED  — Virtual never answered loopback (main thread / WS starved)
 *   B) GHOST_UNICAST_HANG     — started+heartbeat, ContextBus timeout on dead minted id
 *   C) FAIL_CLOSED_OK         — never-minted fails fast with context_not_found
 *   D) RESPONSIVE_BUT_HEAVY   — scrolls ok; CPU/longtask show producer or site cost
 *   E) LOOPBACK_OK_EVAL_HANG  — shouldn't happen; if eval hangs but loopback ok, miswired
 *
 * Evidence: SPECULUM_DIAG_LOOPBACK traces (started/heartbeats) + CDP CPU profile +
 * PerformanceObserver longtasks + Patchright evaluate RTT differential.
 *
 * Docker:
 *   SPECULUM_DIAG_LOOPBACK=1 node scripts/scratch/diag/diag-scroll-stall-verdict.js
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-scroll-stall-verdict');

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

function classifyScroll(sample, traces) {
  const err = sample.error ?? '';
  const outerIdle = /invoke idle timeout/i.test(err);
  const ctxTimeout = err === 'timeout' || /InvokeTimeout/i.test(err);
  const notFound = /context_not_found/i.test(err);
  const t = traces.find((x) => x.name === 'applyScrollSet') ?? traces[traces.length - 1];
  const started = t?.started === true;
  const heartbeats = t?.heartbeats ?? 0;

  if (sample.ok === true && sample.wallMs < 500) {
    return { code: 'OK_FAST', started, heartbeats };
  }
  if (sample.ok === true) {
    return { code: 'OK_SLOW', started, heartbeats, wallMs: sample.wallMs };
  }
  if (notFound && sample.wallMs < 300) {
    return { code: 'FAIL_CLOSED_OK', started, heartbeats };
  }
  if (outerIdle && !started) {
    return { code: 'OUTER_IDLE_NO_STARTED', started, heartbeats };
  }
  if (outerIdle && started && heartbeats === 0) {
    return { code: 'OUTER_IDLE_STARTED_NO_HB', started, heartbeats };
  }
  if ((ctxTimeout || /timeout/i.test(err)) && started && heartbeats > 0) {
    return { code: 'GHOST_UNICAST_HANG', started, heartbeats };
  }
  if (outerIdle && started && heartbeats > 0) {
    // Heartbeats should prevent outer idle — anomalous.
    return { code: 'ANOMALY_OUTER_IDLE_WITH_HB', started, heartbeats };
  }
  return { code: 'OTHER_FAIL', started, heartbeats, err };
}

async function installVirtualObservers(session) {
  const r = await session.evaluate(`(() => {
    const g = globalThis;
    if (g.__diagStallInstalled) return { ok: true, already: true };
    g.__diagLongTasks = [];
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          g.__diagLongTasks.push({
            name: e.name,
            duration: e.duration,
            startTime: e.startTime,
          });
        }
      });
      po.observe({ type: 'longtask', buffered: true });
      g.__diagStallInstalled = true;
      return { ok: true, already: false };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  })()`);
  return r;
}

async function readLongTasks(session) {
  const r = await session.evaluate(`(() => {
    const tasks = globalThis.__diagLongTasks || [];
    const copy = tasks.slice();
    globalThis.__diagLongTasks = [];
    const max = copy.reduce((m, t) => Math.max(m, t.duration || 0), 0);
    return {
      count: copy.length,
      maxMs: max,
      over50: copy.filter((t) => t.duration >= 50).length,
      over200: copy.filter((t) => t.duration >= 200).length,
      top: copy.sort((a, b) => b.duration - a.duration).slice(0, 10),
    };
  })()`);
  if (!r.ok) return { ok: false, reason: r.errorMessage };
  try {
    return { ok: true, ...(typeof r.value === 'string' ? JSON.parse(r.value) : r.value) };
  } catch {
    return { ok: true, raw: r.value };
  }
}

async function evalRtt(session, label) {
  const t0 = performance.now();
  try {
    const r = await Promise.race([
      session.evaluate('1'),
      wait(3000).then(() => ({ ok: false, errorMessage: 'eval_rtt_cap_3000ms' })),
    ]);
    return {
      label,
      ok: r.ok === true,
      wallMs: performance.now() - t0,
      error: r.errorMessage,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      wallMs: performance.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function measureScroll(session, drainTraces, args, label) {
  drainTraces();
  const t0 = performance.now();
  const evalBefore = await evalRtt(session, `${label}:eval-before`);
  const scroll = await session.measureApplyScrollSet(args);
  const evalAfter = await evalRtt(session, `${label}:eval-after`);
  const traces = drainTraces().filter((t) => t.name === 'applyScrollSet');
  const sample = { ...scroll, wallMs: scroll.wallMs ?? performance.now() - t0, label };
  return {
    sample,
    classification: classifyScroll(sample, traces),
    traces,
    evalBefore,
    evalAfter,
  };
}

function pickVerdict(report) {
  const ene = report.phases.eneba?.scrolls ?? [];
  const ghost = report.phases.ghostMinted;
  const never = report.phases.neverMinted;
  const control = report.phases.control;

  if (control && control.classification.code !== 'OK_FAST' && control.classification.code !== 'OK_SLOW') {
    return {
      verdict: 'SETUP_BROKEN',
      bug: 'Control fixture applyScrollSet failed — lab/session not usable for this diag.',
      evidence: control,
    };
  }

  if (never && never.classification.code === 'FAIL_CLOSED_OK') {
    report.gates = { ...(report.gates || {}), neverMintedFailClosed: true };
  }

  const outerNoStart = ene.filter((s) => s.classification.code === 'OUTER_IDLE_NO_STARTED');
  const ghostHang = ene.filter((s) => s.classification.code === 'GHOST_UNICAST_HANG');
  const okScrolls = ene.filter((s) => s.classification.code === 'OK_FAST' || s.classification.code === 'OK_SLOW');

  if (ghost && ghost.classification.code === 'GHOST_UNICAST_HANG') {
    return {
      verdict: 'BUG_GHOST_HASMINTED_UNICAST',
      bug:
        'Minted-then-removed contextId still passes isDeliverableDestination(hasMinted); ' +
        'applyScrollSet hangs ~2s inside ContextBus (started+heartbeat). Same class as old census ghost, still live for scroll/unicast.',
      evidence: { ghost, note: 'ContextBus error is message=timeout; outer idle would mean Virtual never ran.' },
    };
  }

  if (outerNoStart.length >= 2) {
    const evalSlow = outerNoStart.filter((s) => (s.evalBefore?.wallMs ?? 0) > 500 || (s.evalAfter?.wallMs ?? 0) > 500);
    return {
      verdict: 'BUG_VIRTUAL_MAIN_THREAD_STARVED',
      bug:
        'Sidecar saw applyScrollSet OUTER idle timeout with started=false (Virtual never ran loopback handler). ' +
        (evalSlow.length
          ? 'Patchright evaluate also slow/hung in the same window → Virtual JS thread blocked.'
          : 'Evaluate stayed relatively fast → loopback path starved or WS not pumping while page otherwise responsive.'),
      evidence: {
        failingScrolls: outerNoStart.length,
        evalDifferential: outerNoStart.map((s) => ({
          scrollWall: s.sample.wallMs,
          evalBefore: s.evalBefore,
          evalAfter: s.evalAfter,
          traces: s.traces,
        })),
        cpuTop: report.phases.eneba?.cpu?.summary?.topSelfTime?.slice(0, 8),
        longTasks: report.phases.eneba?.longTasks,
      },
    };
  }

  if (ghostHang.length >= 1) {
    return {
      verdict: 'BUG_GHOST_ON_ENEBA_SCROLL',
      bug: 'Eneba scrollSets hit ghost unicast hang (started+heartbeat, ContextBus timeout).',
      evidence: ghostHang,
    };
  }

  if (okScrolls.length === ene.length && ene.length > 0) {
    const lt = report.phases.eneba?.longTasks;
    const our = report.phases.eneba?.cpu?.summary?.ourCode?.totalPct ?? 0;
    const maxLt = lt?.maxMs ?? 0;
    if (maxLt >= 200 || our >= 25) {
      return {
        verdict: 'BUG_VIRTUAL_CPU_HEAVY_BUT_RESPONSIVE',
        bug:
          'applyScrollSet responded; degradation is Virtual main-thread CPU (longtasks/profile), not loopback idle reject. ' +
          'User-visible jank without necessarily printing apply_scroll_failed.',
        evidence: { longTasks: lt, ourCodePct: our, top: report.phases.eneba?.cpu?.summary?.topSelfTime?.slice(0, 10) },
      };
    }
    return {
      verdict: 'NO_REPRO_ON_THIS_RUN',
      bug: 'Scrolls succeeded and CPU/longtasks not decisive. Re-run during the failure window or raise settle/load.',
      evidence: { scrolls: ene, longTasks: lt, cpu: report.phases.eneba?.cpu?.summary },
    };
  }

  return {
    verdict: 'INCONCLUSIVE',
    bug: 'Mixed classifications — see phases for raw evidence.',
    evidence: report.phases,
  };
}

async function main() {
  if (process.env.SPECULUM_DIAG_LOOPBACK !== '1') {
    console.error('Set SPECULUM_DIAG_LOOPBACK=1 (required for heartbeat evidence)');
    process.exit(2);
  }
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

  fs.mkdirSync(OUT, { recursive: true });
  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const { drainInvokeDiagTraces } = require(path.join(
    root,
    'dist/browser/mirror/projection/session/nodeDataPlane',
  ));
  const { summarizeProfile } = require(path.join(
    root,
    'dist/browser/mirror/projection/lab/probes/cpuProfile',
  ));

  const httpServer = await startFixtureHttp();
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  const report = {
    startedAt: new Date().toISOString(),
    phases: {},
    gates: {},
  };

  try {
    // --- Phase control: light fixture ---
    await chassis.boot({
      mode: 'run',
      url: `${httpServer.origin}/fixtures/input-click.html`,
      frameRateHz: 30,
      blueprintId: 'diag-scroll-stall-control',
      slug: 'diag-scroll-stall-control',
      width: 1280,
      height: 720,
      cpuProfiling: true,
    });
    await wait(2000);
    let session = chassis.browser;
    await installVirtualObservers(session);
    drainInvokeDiagTraces();
    report.phases.control = await measureScroll(
      session,
      drainInvokeDiagTraces,
      { contextId: 1, nodeId: null, scrollX: 0, scrollY: 40 },
      'control',
    );
    console.log('CONTROL', JSON.stringify(report.phases.control.classification), report.phases.control.sample);

    report.phases.neverMinted = await measureScroll(
      session,
      drainInvokeDiagTraces,
      { contextId: 99999, nodeId: null, scrollX: 0, scrollY: 0 },
      'never-minted',
    );
    console.log('NEVER_MINTED', JSON.stringify(report.phases.neverMinted.classification), report.phases.neverMinted.sample);

    // --- Ghost minted-then-dead ---
    await chassis.navigate(`${httpServer.origin}/fixtures/input-ghost-context.html`);
    await wait(6000);
    session = chassis.browser;
    await installVirtualObservers(session);
    const ghostMeta = await session.evaluate(`(() => {
      const p = globalThis.__speculumProjection;
      const iframes = [...document.querySelectorAll('iframe')];
      return {
        hasProj: !!p,
        iframeCount: iframes.length,
        // Known contexts from producer if exposed
        keys: Object.keys(globalThis).filter((k) => /speculum/i.test(k)),
      };
    })()`);
    // Force spawn/remove if fixture exposes buttons; else wait for auto churn.
    await session.evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')];
      for (const b of btns) {
        if (/spawn|remove|churn|go/i.test(b.textContent || '')) b.click();
      }
      return btns.map((b) => b.textContent);
    })()`);
    await wait(4000);
    // Discover non-root context ids from chassis context index if available.
    const listed =
      typeof chassis.contextIndex?.list === 'function' ? chassis.contextIndex.list() : [1];
    const deadCandidate = listed.filter((id) => id !== 1).sort((a, b) => b - a)[0] ?? null;
    report.phases.ghostMeta = { ghostMeta, listed, deadCandidate };
    if (deadCandidate != null) {
      report.phases.ghostMinted = await measureScroll(
        session,
        drainInvokeDiagTraces,
        { contextId: deadCandidate, nodeId: null, scrollX: 0, scrollY: 10 },
        'ghost-minted',
      );
      console.log('GHOST', JSON.stringify(report.phases.ghostMinted.classification), report.phases.ghostMinted.sample);
    } else {
      report.phases.ghostMinted = {
        skipped: true,
        reason: 'no non-root contextId observed after ghost fixture',
      };
      console.log('GHOST skipped — no dead candidate');
    }

    // --- Eneba load + CPU + scroll storm ---
    await chassis.navigate('https://www.eneba.com/');
    await wait(14000);
    session = chassis.browser;
    await installVirtualObservers(session);
    await readLongTasks(session); // drain buffered
    const cpuStart = await session.startCpuProfile();
    report.phases.eneba = { cpuStart, scrolls: [] };

    for (let i = 0; i < 5; i++) {
      const row = await measureScroll(
        session,
        drainInvokeDiagTraces,
        { contextId: 1, nodeId: null, scrollX: 0, scrollY: 200 + i * 120 },
        `eneba-${i}`,
      );
      report.phases.eneba.scrolls.push(row);
      console.log(`ENEBA[${i}]`, JSON.stringify(row.classification), {
        wallMs: row.sample.wallMs,
        error: row.sample.error,
        evalBefore: row.evalBefore.wallMs,
        evalAfter: row.evalAfter.wallMs,
      });
      const outerFails = report.phases.eneba.scrolls.filter(
        (s) => s.classification.code === 'OUTER_IDLE_NO_STARTED',
      ).length;
      if (outerFails >= 2) {
        console.log('early-stop: two OUTER_IDLE_NO_STARTED — verdict already decisive');
        break;
      }
      await wait(150);
    }

    report.phases.eneba.longTasks = await readLongTasks(session);
    const cpuStop = await session.stopCpuProfile();
    let cpuSummary = null;
    if (cpuStop.ok && cpuStop.profileBytes) {
      const raw = JSON.parse(Buffer.from(cpuStop.profileBytes).toString('utf8'));
      cpuSummary = summarizeProfile(raw, 8);
      fs.writeFileSync(path.join(OUT, 'eneba.cpuprofile'), JSON.stringify(raw));
      fs.writeFileSync(path.join(OUT, 'eneba-cpu-summary.json'), JSON.stringify(cpuSummary, null, 2));
    }
    report.phases.eneba.cpu = { stop: { ok: cpuStop.ok, reason: cpuStop.reason, summary: cpuStop.summary }, summary: cpuSummary };

    const picked = pickVerdict(report);
    report.verdict = picked.verdict;
    report.bug = picked.bug;
    report.verdictEvidence = picked.evidence;

    fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(report, null, 2));
    console.log('\n======== VERDICT ========');
    console.log(picked.verdict);
    console.log(picked.bug);
    console.log('Wrote', path.join(OUT, 'verdict.json'));
    process.exitCode = picked.verdict.startsWith('BUG_') || picked.verdict === 'SETUP_BROKEN' ? 1 : 0;
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
    await httpServer.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
