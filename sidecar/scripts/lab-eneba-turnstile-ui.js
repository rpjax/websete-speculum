/**
 * Eneba → Sim → Turnstile with Projected apply surface (dual-plane diagnostic).
 * CLI lab:run alone cannot prove Turnstile — this drives lab UI like lab-iframe-open-ui.js.
 *
 * Run: npm run lab:eneba-turnstile
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('patchright');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

const PORT = LAB_PORT;
const HOST = LAB_HOST;
const BLUEPRINT = 'eneba-turnstile';
const RUN_TIMEOUT_MS = 420_000;
/** Fixed port for Projected client CDP clip capture during blueprint probes. */
const PROJECTED_CDP_PORT = Number(process.env.SPECULUM_LAB_PROJECTED_CDP_PORT || '9333');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Stale host on :4077 silently serves old oracle code — always clear before spawn. */
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

async function runTurnstileUi() {
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
      { timeout: 20_000 },
    );
    await page.click('[data-mode="run"]');
    await page.waitForFunction(
      (bp) => [...document.querySelectorAll('#blueprint option')].some((o) => o.value === bp),
      BLUEPRINT,
      { timeout: 20_000 },
    );
    await page.selectOption('#blueprint', BLUEPRINT);
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
        console.log(`[eneba-turnstile-ui] done hint=${hint.trim()}`);
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

async function main() {
  const root = path.join(__dirname, '..');
  if (!process.env.CHROME_EXECUTABLE?.trim()) {
    const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    process.env.CHROME_EXECUTABLE = winChrome;
  }
  const projectedCdpUrl = `http://127.0.0.1:${PROJECTED_CDP_PORT}`;
  const labEnv = {
    ...process.env,
    CHROME_EXECUTABLE: process.env.CHROME_EXECUTABLE,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
    SPECULUM_LAB_HEADED: process.env.SPECULUM_LAB_HEADED ?? '1',
    SPECULUM_LAB_PROJECTED_CDP_URL: projectedCdpUrl,
  };
  killLabPort();
  await wait(800);
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
    const dossier = await runTurnstileUi();
    console.log(`[eneba-turnstile-ui] artifact probes/turnstile-diagnostic.json under ${dossier}`);
  } catch (err) {
    console.error('[eneba-turnstile-ui] failed', err);
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
