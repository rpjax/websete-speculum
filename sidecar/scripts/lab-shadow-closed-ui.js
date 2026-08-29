/**
 * Drive lab UI as the DOM apply surface for blueprint shadow-closed.
 * CLI lab:run has no DOM client — closed shadow iso is unproven without this.
 * Run: node scripts/lab-shadow-closed-ui.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('patchright');

const PORT = process.env.SPECULUM_LAB_PORT || '4099';
const HOST = process.env.SPECULUM_LAB_HOST || '127.0.0.1';

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

async function runShadowClosedUi() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /connected|live/i.test(document.getElementById('chipPhase')?.textContent ?? ''),
      null,
      { timeout: 15_000 },
    );
    await page.click('[data-mode="run"]');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#blueprint option')].some((o) => o.value === 'shadow-closed'),
      null,
      { timeout: 15_000 },
    );
    await page.selectOption('#blueprint', 'shadow-closed');
    await page.click('#runStart');

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const hint = (await page.textContent('#progressHint')) ?? '';
      const dossier = (await page.textContent('#runDossier')) ?? '';
      const chip = (await page.textContent('#chipPhase')) ?? '';
      if (/finished with .* fail/i.test(hint)) {
        const activity = (await page.textContent('#activity')) ?? '';
        const verdicts = (await page.textContent('#runVerdicts')) ?? '';
        throw new Error(
          `shadow-closed failed hint=${hint} chip=${chip} dossier=${dossier}\n${verdicts}\n${activity}`,
        );
      }
      if (/no fails in summary/i.test(hint)) {
        console.log(`[shadow-closed-ui] pass dossier=${dossier.trim()}`);
        return;
      }
      if (/fault/i.test(chip) && !/run in flight/i.test(chip)) {
        throw new Error(`UI fault: ${chip}`);
      }
      await wait(250);
    }
    throw new Error('shadow-closed UI run timed out');
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
      env: { ...process.env, SPECULUM_LAB_HOST: HOST, SPECULUM_LAB_PORT: String(PORT) },
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
    await waitHealth(60_000);
    await runShadowClosedUi();
  } catch (err) {
    console.error('[shadow-closed-ui] failed', err);
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
