'use strict';
/**
 * Reproduce Projected registry ghost (load-after-drop) → click death on full lab path.
 *
 * Causal chain under test:
 *   1) Same-origin iframe load hangs on /hang
 *   2) Virtual mints ctx N; Projected installNestedHost awaits `load`
 *   3) Fixture removes iframe → NODE_DROP → dropNestedHost clears awaiting, leaves load listener
 *   4) Diag releases /hang → late `load` → registerContext after drop (registry ghost)
 *   5) pointerdown requestScrollCensus fans out to ghost → ~2s fail → no down intent / Phase A poison
 *
 * Also keeps sidecar Phase A wire-ghost census control ([1] ok, [1,2] timeout).
 *
 * Docker: node scripts/diag-click-ghost-context.js
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium } = require('patchright');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'lab-runs', 'diag-click-ghost-context');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const LAB_PORT = envInt('SPECULUM_DIAG_LAB_PORT', 4103);
const LAB_HOST = '127.0.0.1';
const SPAWN_LAB = process.env.SPECULUM_DIAG_SPAWN_LAB === '1';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, args, label) {
  console.log(`\n>>> ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

function census(ids) {
  return {
    contexts: ids.map((contextId) => ({
      contextId,
      positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }],
    })),
  };
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${LAB_HOST}:${LAB_PORT}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(200);
  }
  throw new Error(`lab health timeout port=${LAB_PORT}`);
}

/** Fixture HTTP + controllable /hang gate + /drop-gate. */
async function startFixtureHttp() {
  const fixturesDir = path.join(root, 'browser', 'mirror', 'projection', 'lab', 'fixtures');
  /** @type {Array<{ res: import('http').ServerResponse, id: string }>} */
  const pendingHang = [];
  let hangSeq = 0;
  let released = false;
  let dropGate = false;

  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? url;

    if (pathname === '/hang') {
      hangSeq += 1;
      const id = `hang-${hangSeq}`;
      console.log(`[hang] hold ${id}`);
      if (released) {
        res.writeHead(200, { 'Content-Type': 'image/gif' });
        res.end(gif);
        return;
      }
      pendingHang.push({ res, id });
      return;
    }

    if (pathname === '/hang/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pending: pendingHang.length, released, hangSeq, dropGate }));
      return;
    }

    if (pathname === '/drop-gate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ drop: dropGate }));
      return;
    }

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
  if (!addr || typeof addr === 'string') throw new Error('no port');

  return {
    origin: `http://127.0.0.1:${addr.port}`,
    pendingCount: () => pendingHang.length,
    hangSeq: () => hangSeq,
    openDropGate: () => {
      dropGate = true;
      console.log('[drop-gate] open');
    },
    releaseHang: () => {
      released = true;
      const n = pendingHang.length;
      while (pendingHang.length) {
        const p = pendingHang.shift();
        try {
          p.res.writeHead(200, { 'Content-Type': 'image/gif' });
          p.res.end(gif);
          console.log(`[hang] release ${p.id}`);
        } catch (err) {
          console.warn('[hang] release failed', err instanceof Error ? err.message : String(err));
        }
      }
      return n;
    },
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function mainWorldEval(page, expression, { awaitPromise = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const msg =
        r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text ||
        'mainWorldEval failed';
      throw new Error(msg);
    }
    return r.result?.value;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function installMainWorldIntentProbe(page) {
  await mainWorldEval(
    page,
    `(() => {
      if (globalThis.__speculumClickDiag) return true;
      globalThis.__speculumClickDiag = { intents: [] };
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function sendHook(data, ...rest) {
        try {
          const text = typeof data === 'string' ? data : '';
          const msg = JSON.parse(text);
          if (msg && msg.type === 'client.intent' && msg.intent) {
            globalThis.__speculumClickDiag.intents.push({
              t: Date.now(),
              type: msg.intent.type,
              censusIds: Array.isArray(msg.intent.census && msg.intent.census.contexts)
                ? msg.intent.census.contexts.map((c) => c.contextId)
                : null,
            });
          }
        } catch (_) {}
        return origSend.call(this, data, ...rest);
      };
      return true;
    })()`,
  );
}

function spawnLab() {
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    {
      cwd: root,
      env: {
        ...process.env,
        SPECULUM_LAB_HOST: LAB_HOST,
        SPECULUM_LAB_PORT: String(LAB_PORT),
        SPECULUM_LAB_HEADED: '1',
        SPECULUM_INPUT_BACKEND: 'os',
        CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  lab.stdout.on('data', (d) => process.stdout.write(d));
  lab.stderr.on('data', (d) => process.stderr.write(d));
  return lab;
}

async function bootChassis(chassis, opts, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await chassis.boot(opts);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`boot retry ${attempt + 1}:`, err instanceof Error ? err.message : String(err));
        await wait(4000);
      }
    }
  }
  throw lastErr;
}

async function probeClickTarget(session) {
  const r = await session.evaluate(`(() => {
    const g = globalThis.__ghostLab;
    const el = document.getElementById('click-target');
    return {
      phase: g?.getPhase?.() ?? null,
      clicked: el?.getAttribute('data-clicked') ?? null,
    };
  })()`);
  if (!r.ok) return { ok: false, error: r.errorMessage ?? 'evaluate_failed' };
  try {
    return { ok: true, value: JSON.parse(r.value) };
  } catch {
    return { ok: true, value: r.value };
  }
}

async function waitGhostPhase(session, timeoutMs = 20_000) {
  const t0 = performance.now();
  for (;;) {
    const probe = await probeClickTarget(session);
    const phase = probe.ok ? probe.value?.phase : null;
    if (phase === 'ghosts_ready' || phase === 'awaiting_late_load') {
      return { ok: true, probe, waitMs: performance.now() - t0, phase };
    }
    if (performance.now() - t0 >= timeoutMs) {
      return { ok: false, probe, waitMs: performance.now() - t0, phase: null };
    }
    await wait(250);
  }
}

async function runSidecarWireGhost(httpOrigin, report) {
  console.log('\n=== SIDECAR: wire mint ghosts (Phase A census poison) ===');
  const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');
  const block = { wireContexts: [], censusCases: [], clickCases: [] };
  const chassis = new LabChassis({ headless: false, outDir: path.join(OUT, 'sidecar-wire') });

  await bootChassis(chassis, {
    mode: 'run',
    url: `${httpOrigin}/fixtures/input-ghost-context.html`,
    frameRateHz: 60,
    blueprintId: 'diag-wire-ghost',
    slug: 'diag-wire-ghost',
    width: 638,
    height: 315,
  });

  const session = chassis.browser;
  await waitGhostPhase(session);
  await wait(1000);
  block.wireContexts = chassis.contextIndex.list();

  for (const c of [
    { id: 'census-root-only', ids: [1] },
    { id: 'census-root-plus-2', ids: [1, 2] },
  ]) {
    const t0 = performance.now();
    const r = await session.measureApplyScrollCensus(census(c.ids));
    block.censusCases.push({ ...c, ok: r.ok, error: r.error ?? null, wallMs: performance.now() - t0 });
    console.log(`  CENSUS ${c.id} ok=${r.ok} wall=${(performance.now() - t0).toFixed(0)}ms`);
  }

  const click = await session.resolveAndClickDomInput('#click-target');
  await wait(300);
  const after = await probeClickTarget(session);
  block.clickCases.push({
    dispatch: click,
    virtualClicked: after.ok ? after.value?.clicked === '1' : false,
  });

  report.sidecarWireGhost = block;
  try {
    await chassis.disposeVirtual();
  } catch {
    /* */
  }
  await wait(3000);
}

async function runLabRegistryLeak(fixtureUrl, hang, report) {
  console.log('\n=== LAB E2E: load-after-drop registry leak ===');
  const lab = SPAWN_LAB ? spawnLab() : null;
  if (!SPAWN_LAB) {
    console.log(`  using existing lab http://${LAB_HOST}:${LAB_PORT}/ (set SPECULUM_DIAG_SPAWN_LAB=1 to spawn)`);
  }
  const block = {
    fixtureUrl,
    timeline: [],
    forceRace: null,
    peekBeforeForce: null,
    peekAfterForce: null,
    peekAfterCensus: null,
    hookStatus: null,
    intents: [],
    downIntents: [],
    censusContextIds: [],
    censusFailSkips: false,
    projectedClicked: false,
    journalIntents: [],
    dossierDir: null,
    streamContexts: [],
    clickWallMs: null,
    error: null,
  };

  const note = (id, extra) => {
    const entry = { t: Date.now(), id, hangPending: hang.pendingCount(), ...extra };
    block.timeline.push(entry);
    console.log(`  [${id}]`, JSON.stringify(extra ?? {}));
  };

  try {
    await waitHealth(90_000);
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const cdpNet = await page.context().newCDPSession(page);
    await cdpNet.send('Network.setCacheDisabled', { cacheDisabled: true });

    await page.goto(`http://${LAB_HOST}:${LAB_PORT}/?t=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await installMainWorldIntentProbe(page);
    await page.click('#connect');
    await wait(1200);
    await page.fill('#url', fixtureUrl);
    await page.click('#browseStart');
    note('browse_start');

    const bootDeadline = Date.now() + 90_000;
    while (Date.now() < bootDeadline) {
      const frames = Number(await page.textContent('#streamFrames').catch(() => '0'));
      const armed = await mainWorldEval(
        page,
        `(() => {
          const iframe = document.querySelector('#surfaceHost iframe');
          return Boolean(
            iframe && iframe.contentDocument &&
            (iframe.contentDocument.getElementById('click-target') ||
              iframe.contentDocument.getElementById('click-me'))
          );
        })()`,
      );
      if (frames > 0 && armed) break;
      const status = await page.textContent('#statusStrip').catch(() => '');
      if (/fault/i.test(status ?? '')) throw new Error(`lab UI fault: ${status}`);
      await wait(250);
    }
    note('surface_armed');

    block.hookStatus = await mainWorldEval(
      page,
      `({
        hasPeek: typeof globalThis.__labDiagProjectedPeek === 'function',
        hasForce: typeof globalThis.__labDiagForceLoadAfterDrop === 'function',
        hasInput: typeof globalThis.__labDiagProjectedInput === 'function',
        bootOk: globalThis.__labBootOk || null,
      })`,
    );
    note('hook_status', block.hookStatus);

    block.peekBeforeForce = await mainWorldEval(
      page,
      `(() => {
        const fn = globalThis.__labDiagProjectedPeek;
        return fn ? fn() : { error: 'no_peek_fn' };
      })()`,
    );
    note('peek_before_force', block.peekBeforeForce);

    block.forceRace = await mainWorldEval(
      page,
      `(() => {
        const fn = globalThis.__labDiagForceLoadAfterDrop;
        return fn ? fn(99) : { ok: false, reason: 'no_force_fn' };
      })()`,
    );
    note('force_race', block.forceRace);

    let ghostPeek = null;
    for (let i = 0; i < 30; i++) {
      await wait(100);
      ghostPeek = await mainWorldEval(
        page,
        `(() => {
          const fn = globalThis.__labDiagProjectedPeek;
          return fn ? fn() : null;
        })()`,
      );
      if (ghostPeek && ((ghostPeek.ghosts || []).length > 0 || (ghostPeek.registry || []).includes(99))) {
        note('ghost_in_registry', ghostPeek);
        break;
      }
    }
    block.peekAfterForce = ghostPeek;

    const censusPeek = await mainWorldEval(
      page,
      `(() => {
        const fn = globalThis.__labDiagProjectedInput;
        return fn ? fn() : null;
      })()`,
      { awaitPromise: true },
    );
    block.peekAfterCensus = censusPeek;
    note('census_after_ghost', {
      censusOk: censusPeek && censusPeek.censusOk,
      censusMs: censusPeek && censusPeek.censusMs,
      censusReason: censusPeek && censusPeek.censusReason,
      censusIds: censusPeek && censusPeek.censusIds,
      registry: censusPeek && censusPeek.registry,
      ghosts: censusPeek && censusPeek.ghosts,
    });

    block.streamContexts = await mainWorldEval(
      page,
      `([...document.querySelectorAll('#streamContextList article')].map((c) =>
        (c.textContent || '').replace(/\\s+/g, ' ').trim()
      ))`,
    );

    const clickT0 = performance.now();
    const target = page
      .frameLocator('#surfaceHost iframe')
      .locator('#click-target, #click-me')
      .first();
    await target.scrollIntoViewIfNeeded();
    await target.click({ timeout: 15_000 });
    block.clickWallMs = performance.now() - clickT0;
    await wait(2800);

    const diag = await mainWorldEval(
      page,
      `(globalThis.__speculumClickDiag || { intents: [] })`,
    );
    block.intents = diag.intents || [];
    block.downIntents = block.intents.filter((i) => i.type === 'down' || i.type === 'up');
    const down = block.intents.find((i) => i.type === 'down');
    block.censusContextIds = (down && down.censusIds) || [];
    block.censusFailSkips =
      block.intents.some((i) => i.type === 'move') &&
      !block.intents.some((i) => i.type === 'down' || i.type === 'up');
    if (
      !block.censusFailSkips &&
      censusPeek &&
      censusPeek.censusOk === false &&
      (censusPeek.censusMs || 0) >= 1900 &&
      block.downIntents.length === 0
    ) {
      block.censusFailSkips = true;
    }
    block.projectedClicked = await mainWorldEval(
      page,
      `(() => {
        const iframe = document.querySelector('#surfaceHost iframe');
        const doc = iframe && iframe.contentDocument;
        const el = doc && (doc.getElementById('click-target') || doc.getElementById('click-me'));
        return !!(
          el &&
          (el.getAttribute('data-clicked') === '1' || el.getAttribute('data-state') === 'clicked')
        );
      })()`,
    );
    note('click_result', {
      projectedClicked: block.projectedClicked,
      censusFailSkips: block.censusFailSkips,
      censusContextIds: block.censusContextIds,
      intentTypes: block.intents.map((i) => i.type),
      clickWallMs: block.clickWallMs,
    });

    await page.click('#browseStop');
    await wait(3000);
    await browser.close();

    const dossierRoot = path.join(root, 'lab-runs');
    if (fs.existsSync(dossierRoot)) {
      const dirs = fs
        .readdirSync(dossierRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(dossierRoot, d.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      for (const dir of dirs.slice(0, 8)) {
        const intentsPath = path.join(dir, 'journal', 'intents.json');
        if (!fs.existsSync(intentsPath)) continue;
        try {
          const intents = JSON.parse(fs.readFileSync(intentsPath, 'utf8'));
          block.dossierDir = dir;
          block.journalIntents = intents;
          break;
        } catch {
          /* next */
        }
      }
    }
  } catch (err) {
    block.error = err instanceof Error ? err.message : String(err);
    console.error('lab registry-leak E2E error', block.error);
  } finally {
    hang.releaseHang();
    if (lab) {
      lab.kill('SIGTERM');
      await wait(1500);
    }
  }

  report.labRegistryLeak = block;
}

function buildVerdict(report) {
  const wire = report.sidecarWireGhost ?? {};
  const leak = report.labRegistryLeak ?? {};
  const chain = [];
  const rootOnly = wire.censusCases?.find((c) => c.id === 'census-root-only');
  const ghost2 = wire.censusCases?.find((c) => c.id === 'census-root-plus-2');

  chain.push(
    `Wire mint control: contexts=[${(wire.wireContexts ?? []).join(', ')}]; census[1] ok=${rootOnly?.ok}; census[1,2] ok=${ghost2?.ok} wall=${ghost2?.wallMs?.toFixed?.(0) ?? '?' }ms`,
  );

  const peek = leak.peekAfterCensus ?? leak.peekAfterForce;
  if (peek) {
    chain.push(
      `Projected peek: registry=[${(peek.registry ?? []).join(',')}] buses=[${(peek.buses ?? []).join(',')}] nested=[${(peek.nested ?? []).join(',')}] awaiting=[${(peek.awaiting ?? []).join(',')}] ghosts=[${(peek.ghosts ?? []).join(',')}]`,
    );
    if (peek.censusOk !== undefined) {
      chain.push(
        `Projected census after late load: ok=${peek.censusOk} ms=${peek.censusMs?.toFixed?.(0)} reason=${peek.censusReason ?? '-'} ids=[${(peek.censusIds ?? []).join(',')}]`,
      );
    }
  }
  if (leak.forceRace) {
    chain.push(
      `forceLoadAfterDropRace: ok=${leak.forceRace.ok} installAwaiting=[${(leak.forceRace.afterInstallAwaiting ?? []).join(',')}] dropAwaiting=[${(leak.forceRace.afterDropAwaiting ?? []).join(',')}]`,
    );
  }

  if (leak.error) {
    chain.push(`Lab E2E abortou: ${leak.error}`);
  } else if (leak.censusFailSkips) {
    chain.push(
      'CAUSA EXATA: dropNestedHost deixa o listener load vivo → bind tardio registra ghost no ProjectedInputRuntime → requestScrollCensus falha (~2s) → projectedInputCapture skip census_fail → down/up nunca saem → click morto.',
    );
  } else if ((leak.censusContextIds ?? []).length > 1) {
    chain.push(
      `CAUSA EXATA: census do client inclui ghosts [${leak.censusContextIds.join(',')}] → Phase A Virtual timeout se dest sem peer.`,
    );
  } else if (peek?.censusOk === false && (peek.censusMs ?? 0) >= 1900) {
    chain.push(
      'CAUSA EXATA: Projected requestScrollCensus timeout com registry ghost (mesmo antes do click) — fan-out RPC_SNAPSHOT_ONE para id órfão.',
    );
  } else if (leak.projectedClicked) {
    chain.push('Lab click OK — race não armou ghost nesta corrida.');
  } else {
    chain.push('Inconclusivo no caminho click — ver timeline e peek.');
  }

  let hypothesis = 'inconclusive';
  if (leak.censusFailSkips || (peek?.censusOk === false && (peek.censusMs ?? 0) >= 1900)) {
    hypothesis = 'projected_load_after_drop_registry_ghost';
  } else if ((leak.censusContextIds ?? []).length > 1 && leak.projectedClicked === false) {
    hypothesis = 'client_census_includes_ghost_ids';
  } else if (ghost2?.ok === false) {
    hypothesis = 'virtual_wire_ghost_only';
  }

  return { hypothesis, summary: chain[chain.length - 1], causalChain: chain };
}

async function main() {
  let uok = false;
  try {
    uok = require('../dist/browser/input/os/uinput').uinputAvailable() === true;
  } catch {
    uok = false;
  }
  if (!uok) {
    console.error('FAIL: need /dev/uinput (Docker lab)');
    process.exit(2);
  }

  process.env.SPECULUM_LAB_HEADED = '1';
  process.env.SPECULUM_INPUT_BACKEND = 'os';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  run(npm, ['run', 'build:page-projection'], 'build:page-projection');
  run(npm, ['run', 'build:virtual'], 'build:virtual');
  run(npm, ['run', 'build:lab-client'], 'build:lab-client');
  run(npm, ['run', 'build:snapshot'], 'build:snapshot');
  run(npm, ['exec', '--', 'tsc'], 'tsc');

  const { LOOPBACK_INVOKE_IDLE_MS } = require('@speculum/page-projection/core');
  const hang = await startFixtureHttp();
  // Lab serves static client.js — rebuild already wrote it; use lab fixture URL so Virtual
  // does not depend on the diag HTTP origin (Projected race is forced in-process).
  const labFixtureUrl = `http://${LAB_HOST}:${LAB_PORT}/fixtures/input-click.html`;

  const report = {
    at: new Date().toISOString(),
    LOOPBACK_INVOKE_IDLE_MS,
    RESUME_TIMEOUT_MS: 2000,
    labRegistryLeak: null,
    sidecarWireGhost: null,
    verdict: null,
  };

  try {
    await runLabRegistryLeak(labFixtureUrl, hang, report);
    await runSidecarWireGhost(hang.origin, report);
    report.verdict = buildVerdict(report);
  } catch (err) {
    report.fatal = err instanceof Error ? err.message : String(err);
    console.error(err);
  } finally {
    hang.releaseHang();
    await hang.close();
  }

  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT ===');
  for (const line of report.verdict?.causalChain ?? []) console.log(line);
  console.log(`\nHypothesis: ${report.verdict?.hypothesis ?? report.fatal ?? 'none'}`);
  console.log(`Report: ${reportPath}`);
  process.exit(report.fatal ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
