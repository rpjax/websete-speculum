/**
 * Generic lab-UI driver for the touch probes (PP-SCROLL-AXIS family).
 * Run: node scripts/lab-touch-probe-ui.js <blueprintId>
 *   npm run lab:touch-fling-tap        -> input-touch-fling-tap
 *   npm run lab:touch-surface-parity   -> input-touch-surface-parity
 *
 * Same chassis as lab-touch-scroll-axis-ui.js: boot the lab host, drive the UI,
 * then print the probe artifact. Blueprint-specific printing only.
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('patchright');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

const PORT = LAB_PORT;
const HOST = LAB_HOST;
const RUN_TIMEOUT_MS = 240_000;
const PROJECTED_CDP_PORT = Number(process.env.SPECULUM_LAB_PROJECTED_CDP_PORT || '9333');

const PROBES = {
  'input-touch-fling-tap': { artifact: 'touch-fling-tap.json', print: printFlingTap },
  'input-touch-surface-parity': { artifact: 'touch-surface-parity.json', print: printParity },
};

const BLUEPRINT = process.argv[2];
if (!BLUEPRINT || !PROBES[BLUEPRINT]) {
  console.error(
    `usage: node scripts/lab-touch-probe-ui.js <${Object.keys(PROBES).join('|')}>`,
  );
  process.exit(2);
}

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
  // Headless Blink has no compositor fling — touchFlingTap needs SPECULUM_PROBE_HEADED=1
  // or it can only ever report VOID:no_fling_observed_projected.
  const browser = await chromium.launch({
    headless: process.env.SPECULUM_PROBE_HEADED !== '1',
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
      const finished = /Run finished with/i.test(hint) || /Run finished — no fails/i.test(hint);
      if (finished) {
        const verdicts = (await page.textContent('#runVerdicts')) ?? '';
        console.log(`[${BLUEPRINT}] done hint=${hint.trim()}`);
        console.log(verdicts);
        if (!dossier.trim()) throw new Error('run finished but dossier path missing');
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

function printFlingTap(diag) {
  console.log('\n=== CELLS ===');
  console.log(
    ['surf', 'gesture', 'fling', 'start', 'afterGest', 'atTap', 'settle', 'preΔ', 'postΔ', 'dn', 'up', 'loc', 'hit', 'href', 'err'].join('\t'),
  );
  for (const c of diag.cells ?? []) {
    console.log(
      [
        c.surface,
        c.gesture,
        c.flingObserved ? 'Y' : 'n',
        c.scrollStart,
        c.scrollAfterGesture,
        c.scrollAtTap,
        c.scrollAfterSettle,
        c.preTapTravel,
        c.postTapTravel,
        c.intentDownDelta,
        c.intentUpDelta,
        c.locationChanged ? 'Y' : 'n',
        c.hitTagName ?? '-',
        c.hitClosestHref ?? '-',
        c.error ?? '-',
      ].join('\t'),
    );
  }
}

function printParity(diag) {
  console.log('\n=== DIVERGENCES ===');
  if (!diag.divergences?.length) {
    console.log('(none)');
  } else {
    console.log(['selector', 'field', 'control', 'projected', 'root'].join('\t'));
    for (const d of diag.divergences) {
      console.log([d.selector, d.field, String(d.control), String(d.projected), d.root ? 'Y' : 'n'].join('\t'));
    }
  }
  console.log('\n=== PROJECTED SURFACE ===');
  console.log(['selector', 'present', 'touch-action', 'ovf-x', 'ovf-y', 'rangeX', 'rangeY'].join('\t'));
  for (const n of diag.projected ?? []) {
    console.log(
      [
        n.selector,
        n.present ? 'Y' : 'n',
        n.touchAction ?? '-',
        n.overflowX ?? '-',
        n.overflowY ?? '-',
        n.scrollWidth - n.clientWidth,
        n.scrollHeight - n.clientHeight,
      ].join('\t'),
    );
  }
}

function printArtifact(dossierDir) {
  const { artifact, print } = PROBES[BLUEPRINT];
  const probePath = path.join(dossierDir, 'probes', artifact);
  const verdictsPath = path.join(dossierDir, 'verdicts.json');
  if (!fs.existsSync(probePath)) {
    console.error(`[${BLUEPRINT}] missing ${probePath}`);
    return;
  }
  const diag = JSON.parse(fs.readFileSync(probePath, 'utf8'));
  console.log('\n=== VERDICT ===');
  console.log(diag.verdict);
  console.log(diag.hypothesis?.join('\n') ?? '');
  if (diag.voidReasons?.length) console.log('voidReasons:', diag.voidReasons.join('; '));
  print(diag);
  if (fs.existsSync(verdictsPath)) {
    console.log('\n=== verdicts.json ===');
    console.log(fs.readFileSync(verdictsPath, 'utf8'));
  }
  console.log(`\nartifact: ${probePath}`);
}

async function main() {
  const root = path.join(__dirname, '..');
  if (!process.env.CHROME_EXECUTABLE?.trim()) {
    process.env.CHROME_EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  const labEnv = {
    ...process.env,
    CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
    SPECULUM_LAB_HEADED: process.env.SPECULUM_LAB_HEADED ?? '0',
    SPECULUM_LAB_PROJECTED_CDP_URL: `http://127.0.0.1:${PROJECTED_CDP_PORT}`,
  };
  killLabPort();
  await wait(800);
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    { cwd: root, env: labEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  lab.stderr.on('data', (d) => {
    stderr += String(d);
  });
  lab.stdout.on('data', (d) => process.stdout.write(d));

  try {
    await waitHealth(90_000);
    const dossier = await runUi();
    printArtifact(dossier);
  } catch (err) {
    console.error(`[${BLUEPRINT}] failed`, err);
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
