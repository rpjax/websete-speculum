/**
 * E2E input QA — Projected capture → UnifiedIntent → EventApplier → OS ABS/scrollSet.
 *
 * Canonical: point at Docker lab (port 4103) with SPECULUM_LAB_EXTERNAL=1.
 * Local spawn only if /dev/uinput is available (fail-closed otherwise).
 *
 * Usage:
 *   # Terminal A: npm run lab:docker
 *   # Terminal B:
 *   set SPECULUM_LAB_EXTERNAL=1
 *   set SPECULUM_LAB_PORT=4103
 *   npm run lab:input-e2e-qa
 *
 *   # Or inside Docker compose network:
 *   npm run lab:input-e2e:docker
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('patchright');

const PORT = process.env.SPECULUM_LAB_PORT || '4103';
const HOST = process.env.SPECULUM_LAB_HOST || '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const EXTERNAL = process.env.SPECULUM_LAB_EXTERNAL === '1';
const OUT = path.join(__dirname, '..', 'lab-runs', 'input-e2e-qa-os');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uinputOk() {
  try {
    return require('../dist/browser/patchright/input/uinput').uinputAvailable() === true;
  } catch {
    return false;
  }
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`lab health timeout ${BASE}/health`);
}

async function waitFrames(page, min = 1, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = Number((await page.textContent('#streamFrames')) || '0');
    if (n >= min) return n;
    const chip = (await page.textContent('#chipPhase')) || '';
    if (/fault/i.test(chip)) throw new Error(`fault while waiting frames: ${chip}`);
    await wait(200);
  }
  throw new Error('frames timeout');
}

async function projectedFrame(page) {
  const handle = await page
    .waitForSelector('#surfaceHost iframe, #surfaceHost >> iframe', { timeout: 30_000 })
    .catch(() => null);
  if (handle) {
    const frame = await handle.contentFrame();
    if (frame) return frame;
  }
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const ok = await f.evaluate(() => document.documentElement != null).catch(() => false);
    if (ok) return f;
  }
  throw new Error('projected surface frame not found');
}

async function browseStart(page, fixturePath) {
  await page.fill('#url', `${BASE}/${fixturePath}`);
  await page.click('#browseStart');
  await waitFrames(page, 1);
  await wait(2000);
}

async function browseStop(page) {
  const before = (await page.textContent('#activity')) || '';
  await page.click('#browseStop');
  await page
    .waitForFunction(
      (prev) => {
        const a = document.getElementById('activity')?.textContent ?? '';
        return a.includes('stopped') && a !== prev;
      },
      before,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  await wait(800);
  return findLatestDossier();
}

function intentDebug(page) {
  return page.evaluate(() => ({
    intents: document.getElementById('dbgIntents')?.textContent ?? '?',
    drops: document.getElementById('dbgIntentDrop')?.textContent ?? '?',
    frames: document.getElementById('streamFrames')?.textContent ?? '?',
    phase: document.getElementById('chipPhase')?.textContent ?? '?',
    activityTail: (document.getElementById('activity')?.textContent ?? '').slice(-800),
  }));
}

function findLatestDossier() {
  const base = path.join(__dirname, '..', 'lab-runs');
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .map((d) => ({ d, t: fs.statSync(path.join(base, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return dirs[0] ? path.join(base, dirs[0].d) : null;
}

function readPipeline(dossierDir) {
  const p = path.join(dossierDir, 'probes', 'input-pipeline.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assertOsPipeline(pipeline, name) {
  if (!pipeline) return; // browse dossiers may land elsewhere in Docker bind mounts
  if (pipeline.backend && pipeline.backend !== 'os') {
    throw new Error(`${name}: expected backend=os got ${pipeline.backend}`);
  }
}

async function runScenario(page, name, fixture, act, assert) {
  const result = { name, ok: false, detail: '', pipeline: null, debug: null };
  try {
    await browseStart(page, fixture);
    const frame = await projectedFrame(page);
    const before = await intentDebug(page);
    await act(page, frame);
    await wait(1000);
    result.debug = { before, after: await intentDebug(page) };
    await assert(page, frame);
    const dossier = await browseStop(page);
    if (dossier && fs.existsSync(dossier)) {
      result.pipeline = readPipeline(dossier);
      result.dossier = dossier;
      assertOsPipeline(result.pipeline, name);
    }
    result.ok = true;
    result.detail = 'pass';
  } catch (err) {
    result.detail = err instanceof Error ? err.message : String(err);
    try {
      result.debug = result.debug || { after: await intentDebug(page) };
      const dossier = await browseStop(page);
      if (dossier && fs.existsSync(dossier)) {
        result.pipeline = readPipeline(dossier);
        result.dossier = dossier;
      }
    } catch {
      /* */
    }
  }
  return result;
}

/** Click via mouse on Projected → capture UnifiedIntent → OS ABS on Virtual. */
async function qaClick(page) {
  return runScenario(
    page,
    'e2e-os-click',
    'fixtures/input-click.html',
    async (p, frame) => {
      const btn = await frame.waitForSelector('#click-me', { timeout: 15_000 });
      const box = await btn.boundingBox();
      if (!box) throw new Error('no bbox #click-me');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await p.mouse.move(x, y);
      await wait(80);
      await p.mouse.down();
      await wait(40);
      await p.mouse.up();
    },
    async (_p, frame) => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const st = await frame.evaluate(() => document.getElementById('status')?.getAttribute('data-state'));
        if (st === 'clicked') return;
        await wait(120);
      }
      const snap = await frame.evaluate(() => ({
        status: document.getElementById('status')?.getAttribute('data-state'),
      }));
      throw new Error(`Projected #status never clicked: ${JSON.stringify(snap)}`);
    },
  );
}

/** Focus + keyboard.type so capture emits keyDown/keyUp (not Projected-only fill). */
async function qaForms(page) {
  return runScenario(
    page,
    'e2e-os-forms',
    'fixtures/input-forms.html',
    async (p, frame) => {
      const field = await frame.waitForSelector('#field', { timeout: 15_000 });
      const box = await field.boundingBox();
      if (!box) throw new Error('no bbox #field');
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await wait(120);
      await p.keyboard.type('e2e-qa-typed', { delay: 35 });
      await wait(100);
      await p.keyboard.press('Tab');
    },
    async (_p, frame) => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const snap = await frame.evaluate(() => ({
          v: document.getElementById('field')?.value,
          mirror: document.getElementById('mirror')?.getAttribute('data-value'),
        }));
        // Mirror only updates when Virtual site script ran + streamed back.
        if (snap.v === 'e2e-qa-typed' && snap.mirror === 'e2e-qa-typed') return;
        await wait(120);
      }
      const snap = await frame.evaluate(() => ({
        v: document.getElementById('field')?.value,
        mirror: document.getElementById('mirror')?.getAttribute('data-value'),
      }));
      throw new Error(`forms not synced via OS keys: ${JSON.stringify(snap)}`);
    },
  );
}

async function qaScroll(page) {
  return runScenario(
    page,
    'e2e-os-scroll',
    'fixtures/input-scroll.html',
    async (p, frame) => {
      const scroller = await frame.waitForSelector('#scroller', { timeout: 15_000 });
      const box = await scroller.boundingBox();
      if (!box) throw new Error('no bbox #scroller');
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 14; i++) {
        await p.mouse.wheel(0, 80);
        await wait(45);
      }
    },
    async (_p, frame) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const t = await frame.evaluate(() => document.getElementById('scroller')?.scrollTop ?? 0);
        if (t > 80) return;
        await wait(120);
      }
      const t = await frame.evaluate(() => document.getElementById('scroller')?.scrollTop ?? 0);
      throw new Error(`scrollTop stayed ${t}`);
    },
  );
}

async function qaIframeClick(page) {
  return runScenario(
    page,
    'e2e-os-iframe-click',
    'fixtures/iframe-open.html',
    async (p, frame) => {
      await wait(8000);
      let target = null;
      for (let attempt = 0; attempt < 40 && !target; attempt++) {
        for (const f of frame.page().frames()) {
          const has = await f.evaluate(() => !!document.getElementById('inner-click')).catch(() => false);
          if (has) {
            target = f;
            break;
          }
        }
        if (!target) await wait(250);
      }
      if (!target) throw new Error('nested projected frame missing');
      const btn = await target.waitForSelector('#inner-click', { timeout: 10_000 });
      const box = await btn.boundingBox();
      if (!box) throw new Error('no bbox #inner-click');
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    },
    async (_p, frame) => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        for (const f of frame.page().frames()) {
          const s = await f
            .evaluate(() => document.getElementById('inner-status')?.getAttribute('data-state'))
            .catch(() => null);
          if (s === 'clicked') return;
        }
        await wait(150);
      }
      throw new Error('nested #inner-status never clicked');
    },
  );
}

async function qaStressBurst(page) {
  return runScenario(
    page,
    'e2e-os-stress-burst',
    'fixtures/input-scroll-matrix.html',
    async (p, frame) => {
      await wait(3000);
      const list = await frame.waitForSelector('#panel-list', { timeout: 15_000 });
      const box = await list.boundingBox();
      if (!box) throw new Error('no bbox #panel-list');
      await p.mouse.move(box.x + 40, box.y + 40);
      for (let i = 0; i < 80; i++) {
        await p.mouse.wheel(0, 60);
        await wait(12);
      }
      const feed = await frame.$('#panel-feed');
      if (feed) {
        const fb = await feed.boundingBox();
        if (fb) {
          await p.mouse.move(fb.x + 40, fb.y + 40);
          for (let i = 0; i < 60; i++) {
            await p.mouse.wheel(0, 50);
            await wait(12);
          }
        }
      }
      for (let i = 0; i < 100; i++) {
        await p.mouse.move(box.x + 40 + (i % 40) * 4, box.y + 40 + (i % 20) * 3);
        if (i % 12 === 0) {
          await p.mouse.down();
          await wait(12);
          await p.mouse.up();
        }
        await wait(8);
      }
    },
    async (_p, frame) => {
      const snap = await frame.evaluate(() => ({
        list: document.getElementById('panel-list')?.scrollTop ?? 0,
        feed: document.getElementById('panel-feed')?.scrollTop ?? 0,
        y: window.scrollY || 0,
      }));
      if (snap.list < 50 && snap.feed < 50 && snap.y < 50) {
        throw new Error(`stress no scroll effect: ${JSON.stringify(snap)}`);
      }
    },
  );
}

/** Multi-panel farm — Projected capture → OS; censusSnapshotMs lands in input-pipeline. */
async function qaE2eStressFarm(page) {
  return runScenario(
    page,
    'e2e-os-stress-farm',
    'fixtures/input-e2e-stress.html?panels=48',
    async (p, frame) => {
      await wait(4000);
      for (const id of ['#cell-0', '#cell-15', '#cell-31', '#cell-63']) {
        const el = await frame.waitForSelector(id, { timeout: 15_000 });
        const box = await el.boundingBox();
        if (!box) throw new Error(`no bbox ${id}`);
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await wait(40);
      }
      const field = await frame.waitForSelector('#field', { timeout: 10_000 });
      const fb = await field.boundingBox();
      if (!fb) throw new Error('no bbox #field');
      await p.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await wait(80);
      await p.keyboard.type('stress-ok', { delay: 25 });
      const panel = await frame.waitForSelector('#panel-0', { timeout: 10_000 });
      const pb = await panel.boundingBox();
      if (!pb) throw new Error('no bbox #panel-0');
      await p.mouse.move(pb.x + 40, pb.y + 40);
      for (let i = 0; i < 40; i++) {
        await p.mouse.wheel(0, 70);
        await wait(15);
      }
      for (let i = 0; i < 30; i++) {
        await p.mouse.move(pb.x + 20 + (i % 20) * 5, pb.y + 20 + (i % 10) * 4);
        if (i % 5 === 0) {
          await p.mouse.down();
          await wait(20);
          await p.mouse.up();
        }
        await wait(10);
      }
    },
    async (_p, frame) => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const snap = await frame.evaluate(() => ({
          clicks: Number(document.getElementById('hud-clicks')?.textContent || '0'),
          field: document.getElementById('field')?.value ?? '',
          mirror: document.getElementById('mirror')?.getAttribute('data-value') ?? '',
          panel0: document.getElementById('panel-0')?.scrollTop ?? 0,
          panelSum: Number(document.getElementById('hud-panel-sum')?.textContent || '0'),
        }));
        if (snap.clicks >= 4 && snap.field === 'stress-ok' && snap.mirror === 'stress-ok' && (snap.panel0 > 40 || snap.panelSum > 40)) {
          return;
        }
        await wait(150);
      }
      const snap = await frame.evaluate(() => ({
        clicks: document.getElementById('hud-clicks')?.textContent,
        field: document.getElementById('field')?.value,
        mirror: document.getElementById('mirror')?.getAttribute('data-value'),
        panel0: document.getElementById('panel-0')?.scrollTop,
      }));
      throw new Error(`stress-farm assert: ${JSON.stringify(snap)}`);
    },
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const root = path.join(__dirname, '..');

  let lab = null;
  let stderr = '';

  if (!EXTERNAL) {
    if (!uinputOk()) {
      console.error(
        [
          'FAIL: /dev/uinput unavailable — cannot spawn local lab for OS input E2E.',
          'Start Docker lab then:',
          '  SPECULUM_LAB_EXTERNAL=1 SPECULUM_LAB_PORT=4103 npm run lab:input-e2e-qa',
          'Or: npm run lab:input-e2e:docker',
        ].join('\n'),
      );
      process.exit(2);
    }
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    for (const script of ['build:virtual', 'build:lab-client']) {
      const r = spawnSync(npm, ['run', script], { cwd: root, stdio: 'inherit', shell: true });
      if ((r.status ?? 1) !== 0) throw new Error(`${script} failed`);
    }
    {
      const r = spawnSync(npm, ['exec', '--', 'tsc'], { cwd: root, stdio: 'inherit', shell: true });
      if ((r.status ?? 1) !== 0) throw new Error('tsc failed');
    }
    lab = spawn(
      process.execPath,
      [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
      {
        cwd: root,
        env: {
          ...process.env,
          SPECULUM_LAB_HOST: HOST,
          SPECULUM_LAB_PORT: String(PORT),
          SPECULUM_LAB_HEADED: '1',
          SPECULUM_INPUT_BACKEND: 'os',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    lab.stderr.on('data', (d) => {
      stderr += String(d);
    });
    lab.stdout.on('data', (d) => process.stdout.write(d));
  }

  const report = {
    at: new Date().toISOString(),
    backend: 'os',
    base: BASE,
    external: EXTERNAL,
    scenarios: [],
    failed: 0,
  };

  try {
    await waitHealth(EXTERNAL ? 30_000 : 90_000);
    const chromePath = process.env.CHROME_EXECUTABLE || '';
    const browser = await chromium.launch({
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => {
        const ws = document.getElementById('chipWs')?.textContent ?? '';
        const phase = document.getElementById('chipPhase')?.textContent ?? '';
        return /ws open|connected/i.test(ws) || /connected|live/i.test(phase);
      },
      null,
      { timeout: 20_000 },
    );

    const scenarios = [qaClick, qaForms, qaScroll, qaIframeClick, qaStressBurst, qaE2eStressFarm];
    for (const fn of scenarios) {
      process.stdout.write(`\n=== ${fn.name} ===\n`);
      const r = await fn(page);
      report.scenarios.push(r);
      console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.detail}`);
      if (r.pipeline) {
        console.log(`  backend=${r.pipeline.backend ?? '?'} path=${r.pipeline.path ?? '?'}`);
      }
      if (!r.ok) report.failed += 1;
      await wait(600);
    }

    await browser.close();
  } catch (err) {
    console.error('[e2e-qa-os] fatal', err);
    if (stderr) console.error(stderr.slice(-4000));
    report.failed += 1;
    report.fatal = err instanceof Error ? err.message : String(err);
  } finally {
    if (lab) {
      lab.kill('SIGTERM');
      await wait(500);
    }
  }

  const reportPath = path.join(OUT, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nOS QA report: ${reportPath}`);
  console.log(`Failed: ${report.failed}/${report.scenarios.length || '?'}`);
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
