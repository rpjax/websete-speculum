/**
 * One-shot Turnstile widget parity — dispatch speculum-widget-parity on lab UI.
 * Run while Projected/Virtual are diverged (widget missing on Projected).
 * Artifact: sidecar/lab-runs/widget-parity-last.json
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('patchright');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

const PORT = LAB_PORT;
const HOST = LAB_HOST;
const TIMEOUT_MS = 120_000;

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

async function runParity(onLabChunk) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let diagnostic = null;

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[widget-parity-diag]')) return;
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

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('speculum-widget-parity'));
    });

    const deadline = Date.now() + 45_000;
    while (!diagnostic && Date.now() < deadline) {
      onLabChunk((parsed) => {
        if (parsed) diagnostic = parsed;
      });
      await wait(200);
    }
    if (!diagnostic) throw new Error('widget.diag timeout — no console payload');

    const outDir = path.join(__dirname, '..', 'lab-runs');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'widget-parity-last.json');
    fs.writeFileSync(outPath, JSON.stringify(diagnostic, null, 2));
    console.log('[widget-parity-run] wrote', outPath);
    console.log('[widget-parity-run] verdict=', diagnostic.verdict);
    console.log('[widget-parity-run] hypothesis=', (diagnostic.hypothesis || []).join(' | '));
  } finally {
    await browser.close();
  }
}

async function main() {
  const labProc = spawn('node', ['dist/browser/mirror/projection/lab/host/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, SPECULUM_LAB_PORT: PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  const onLabChunk = (fn) => {
    const lines = buf.split('\n');
    for (const line of lines) {
      if (!line.includes('[lab] widget-parity-diag')) continue;
      const jsonStart = line.indexOf('{');
      if (jsonStart < 0) continue;
      try {
        fn(JSON.parse(line.slice(jsonStart)));
      } catch {
        /* ignore */
      }
    }
  };
  labProc.stdout.on('data', (d) => {
    buf += d.toString();
    if (buf.length > 512_000) buf = buf.slice(-256_000);
  });
  labProc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    await waitHealth(TIMEOUT_MS);
    await runParity(onLabChunk);
  } finally {
    labProc.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('[widget-parity-run] failed', err);
  process.exit(1);
});
