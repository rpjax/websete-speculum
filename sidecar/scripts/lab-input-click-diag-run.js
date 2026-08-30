/**
 * One-shot Turnstile click diagnostic — browse Eneba, Sim, click widget on Projected, dump.
 * Uses existing counters + browse.inputDiag (no new probe).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('patchright');

const PORT = process.env.SPECULUM_LAB_PORT || '4110';
const HOST = process.env.SPECULUM_LAB_HOST || '127.0.0.1';
const TIMEOUT_MS = 300_000;

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
      /* retry */
    }
    await wait(250);
  }
  throw new Error('lab health timeout');
}

async function runDiag(onLabChunk) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let diagnostic = null;

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[input-click-diag]')) return;
    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) return;
    try {
      diagnostic = JSON.parse(text.slice(jsonStart));
    } catch {
      /* ignore partial */
    }
  });

  try {
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#connect');
    await page.waitForFunction(
      () => /connected|live/i.test(document.getElementById('chipPhase')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );

    await page.fill('#url', 'https://www.eneba.com');
    await page.click('#browseStart');
    await page.waitForFunction(
      () => /live/i.test(document.getElementById('chipPhase')?.textContent ?? ''),
      null,
      { timeout: 120_000 },
    );

    await wait(8000);

    const surface = page.frameLocator('#surfaceHost iframe');
    const sim = surface.locator('button, a, [role="button"]').filter({ hasText: /^sim$/i }).first();
    await sim.click({ timeout: 60_000 });
    await wait(15000);

    // Turnstile widget — click center of cf iframe or checkbox host in projected surface.
    const widget = surface
      .locator('iframe[id*="cf-chl"], iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"]')
      .first();
    await widget.waitFor({ state: 'visible', timeout: 60_000 });
    await widget.click({ timeout: 30_000 });
    await wait(2000);

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('speculum-input-diag'));
    });

    const deadline = Date.now() + 45_000;
    while (!diagnostic && Date.now() < deadline) {
      onLabChunk((parsed) => {
        if (parsed) diagnostic = parsed;
      });
      await wait(200);
    }
    if (!diagnostic) throw new Error('input.diag timeout — no console payload');

    const outDir = path.join(__dirname, '..', 'lab-runs');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'input-click-diag-last.json');
    fs.writeFileSync(outPath, JSON.stringify(diagnostic, null, 2));
    console.log('[input-click-diag-run] wrote', outPath);
    console.log(JSON.stringify(diagnostic, null, 2));

    await page.click('#browseStop');
    await wait(2000);
    return diagnostic;
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!process.env.CHROME_EXECUTABLE?.trim()) {
    console.error('CHROME_EXECUTABLE required');
    process.exit(1);
  }

  const root = path.join(__dirname, '..');
  const labEnv = {
    ...process.env,
    SPECULUM_LAB_HOST: HOST,
    SPECULUM_LAB_PORT: String(PORT),
    SPECULUM_LAB_HEADED: process.env.SPECULUM_LAB_HEADED ?? '1',
  };
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    { cwd: root, env: labEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  let stdoutBuf = '';
  const parseStdoutDiag = (setter) => {
    const marker = '[lab] input-click-diag';
    const idx = stdoutBuf.indexOf(marker);
    if (idx < 0) return;
    const jsonStart = stdoutBuf.indexOf('{', idx);
    if (jsonStart < 0) return;
    try {
      setter(JSON.parse(stdoutBuf.slice(jsonStart)));
    } catch {
      /* partial */
    }
  };
  lab.stderr.on('data', (d) => {
    stderr += String(d);
  });
  lab.stdout.on('data', (d) => {
    const s = String(d);
    process.stdout.write(s);
    stdoutBuf += s;
  });

  try {
    await waitHealth(120_000);
    await runDiag((apply) => parseStdoutDiag(apply));
  } catch (err) {
    console.error('[input-click-diag-run] failed', err);
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
