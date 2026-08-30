/**
 * Drive lab UI + Projected client for blueprint input-iframe-xo-shadow-click.
 * CLI lab:run has no DOM client — probe.nestedHostReady requires this.
 * Run: node scripts/lab-xo-shadow-ui.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('patchright');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  throw new Error('lab health timeout');
}

async function runXoShadowUi() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://${LAB_HOST}:${LAB_PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /connected|live/i.test(document.getElementById('chipPhase')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    await page.click('[data-mode="run"]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#blueprint option')].some(
          (o) => o.value === 'input-iframe-xo-shadow-click',
        ),
      null,
      { timeout: 30_000 },
    );
    await page.selectOption('#blueprint', 'input-iframe-xo-shadow-click');
    await page.click('#runStart');

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const hint = (await page.textContent('#progressHint')) ?? '';
      const dossier = (await page.textContent('#runDossier')) ?? '';
      const chip = (await page.textContent('#chipPhase')) ?? '';
      const activity = (await page.textContent('#activity')) ?? '';
      const verdicts = (await page.textContent('#runVerdicts')) ?? '';
      if (/finished with .* fail/i.test(hint)) {
        throw new Error(
          `input-iframe-xo-shadow-click FAILED hint=${hint} chip=${chip} dossier=${dossier}\n${verdicts}\n${activity}`,
        );
      }
      if (/no fails in summary/i.test(hint)) {
        console.log(`[xo-shadow-ui] PASS dossier=${dossier.trim()}`);
        return;
      }
      if (/fault/i.test(chip) && !/run in flight/i.test(chip)) {
        throw new Error(`UI fault: ${chip}\n${activity}`);
      }
      await wait(250);
    }
    throw new Error('input-iframe-xo-shadow-click UI run timed out');
  } finally {
    await browser.close();
  }
}

async function main() {
  const root = path.join(__dirname, '..');
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    {
      cwd: root,
      env: { ...process.env, SPECULUM_LAB_HOST: LAB_HOST, SPECULUM_LAB_PORT: String(LAB_PORT) },
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
    await runXoShadowUi();
  } catch (err) {
    console.error('[xo-shadow-ui] failed', err);
    if (stderr) console.error(stderr);
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
