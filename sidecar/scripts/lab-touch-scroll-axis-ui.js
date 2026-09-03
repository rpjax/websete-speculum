/**
 * PP-SCROLL-AXIS matrix via lab UI + Projected CDP.
 * Run: npm run lab:touch-scroll-axis
 *
 * Optional: SPECULUM_LAB_TOUCH_SCROLL_URL — override boot/control fixture URL (real site later).
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('patchright');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

const PORT = LAB_PORT;
const HOST = LAB_HOST;
const BLUEPRINT = 'input-touch-scroll-axis';
const RUN_TIMEOUT_MS = 240_000;
const PROJECTED_CDP_PORT = Number(process.env.SPECULUM_LAB_PROJECTED_CDP_PORT || '9333');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killLabPort() {
  if (process.platform === 'win32') {
    spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue; ` +
        'if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }',
    ]);
    return;
  }
  spawnSync('sh', ['-c', `fuser -k ${PORT}/tcp 2>/dev/null || lsof -ti:${PORT} | xargs -r kill -9`]);
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

async function runUi() {
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${PROJECTED_CDP_PORT}`],
  });
  const page = await browser.newPage();
  try {
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /connected|live/i.test(document.getElementById('chipPhase')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    await page.click('[data-mode="run"]');
    // Blueprint lives under "more" panel; ensure HUD expanded.
    const collapsed = await page.evaluate(
      () => document.getElementById('surfaceHud')?.dataset.collapsed === 'true',
    );
    if (collapsed) await page.click('#hudToggle');
    await page.click('#hudMore');
    await page.waitForFunction(
      (bp) => [...document.querySelectorAll('#blueprint option')].some((o) => o.value === bp),
      BLUEPRINT,
      { timeout: 20_000 },
    );
    await page.locator('#blueprint').selectOption(BLUEPRINT, { force: true });
    await page.click('#runStart');

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const hint = (await page.textContent('#progressHint')) ?? '';
      const dossier = (await page.textContent('#runDossier')) ?? '';
      const chip = (await page.textContent('#chipPhase')) ?? '';
      const finished =
        /Run finished with/i.test(hint) || /Run finished — no fails/i.test(hint);
      if (finished) {
        const verdicts = (await page.textContent('#runVerdicts')) ?? '';
        console.log(`[touch-scroll-axis-ui] done hint=${hint.trim()}`);
        console.log(verdicts);
        if (!dossier.trim()) {
          throw new Error('run finished but dossier path missing');
        }
        return dossier.trim();
      }
      if (/fault/i.test(chip) && !/run in flight/i.test(chip)) {
        throw new Error(`UI fault: ${chip}`);
      }
      await wait(300);
    }
    throw new Error(`${BLUEPRINT} UI run timed out`);
  } finally {
    await browser.close();
  }
}

function printArtifact(dossierDir) {
  const probePath = path.join(dossierDir, 'probes', 'touch-scroll-axis.json');
  const verdictsPath = path.join(dossierDir, 'verdicts.json');
  if (!fs.existsSync(probePath)) {
    console.error(`[touch-scroll-axis-ui] missing ${probePath}`);
    return;
  }
  const diag = JSON.parse(fs.readFileSync(probePath, 'utf8'));
  console.log('\n=== VERDICT ===');
  console.log(diag.verdict);
  console.log(`matrixMode=${diag.matrixMode ?? 'r1'}`);
  console.log(diag.hypothesis?.join('\n') ?? '');
  if (diag.voidReasons?.length) {
    console.log('voidReasons:', diag.voidReasons.join('; '));
  }
  console.log('\n=== CELLS ===');
  console.log(
    [
      'var',
      'surf',
      'gest',
      'pageΔY',
      'page',
      'dp',
      'canc',
      'hitTag',
      'hitHref',
      'locΔ',
      'vHash',
      'vOk',
      'dnΔ',
      'upΔ',
      'mtp',
    ].join('\t'),
  );
  for (const c of diag.cells ?? []) {
    console.log(
      [
        c.variant ?? '-',
        c.surface,
        c.gesture,
        c.deltaDocScrollY,
        c.pageRolled ? 'Y' : 'n',
        c.touchstartDefaultPrevented === true
          ? 'T'
          : c.touchstartDefaultPrevented === false
            ? 'F'
            : '?',
        c.touchstartCancelable === true ? 'T' : c.touchstartCancelable === false ? 'F' : '?',
        c.hitTagName ?? '-',
        c.hitClosestHref ?? '-',
        c.locationChanged ? 'Y' : 'n',
        c.virtualHashAfter ?? '-',
        c.virtualHashOk === true ? 'Y' : c.virtualHashOk === false ? 'n' : '-',
        c.intentDownDelta ?? 0,
        c.intentUpDelta ?? 0,
        c.maxTouchPoints,
      ].join('\t'),
    );
  }
  if (fs.existsSync(verdictsPath)) {
    console.log('\n=== verdicts.json ===');
    console.log(fs.readFileSync(verdictsPath, 'utf8'));
  }
  console.log(`\nartifact: ${probePath}`);
}

async function main() {
  const root = path.join(__dirname, '..');
  if (!process.env.CHROME_EXECUTABLE?.trim()) {
    process.env.CHROME_EXECUTABLE =
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  const projectedCdpUrl = `http://127.0.0.1:${PROJECTED_CDP_PORT}`;
  const labEnv = {
    ...process.env,
    CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
    SPECULUM_LAB_HEADED: process.env.SPECULUM_LAB_HEADED ?? '0',
    SPECULUM_LAB_PROJECTED_CDP_URL: projectedCdpUrl,
  };
  killLabPort();
  await wait(800);
  // Ensure TS + bundles are current (npm script also builds; this path assumes dist exists).
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    {
      cwd: root,
      env: labEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  lab.stderr.on('data', (d) => {
    stderr += String(d);
  });
  lab.stdout.on('data', (d) => {
    process.stdout.write(d);
  });

  try {
    await waitHealth(90_000);
    const dossier = await runUi();
    printArtifact(dossier);
  } catch (err) {
    console.error('[touch-scroll-axis-ui] failed', err);
    console.error(stderr);
    process.exitCode = 1;
  } finally {
    lab.kill('SIGTERM');
    await wait(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
