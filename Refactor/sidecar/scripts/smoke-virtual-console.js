/**
 * Smoke: inject console-transport virtual.js, mutate DOM, assert send + PP magic.
 * Run from Refactor/sidecar: node scripts/smoke-virtual-console.js
 *
 * Note: Patchright may not surface page console events; we assert via
 * `__speculumProjection.frameTransport.sends` / `lastBytes`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('patchright');

async function main() {
  const bundleFile = path.join(
    process.cwd(),
    'dist',
    'browser',
    'mirror',
    'projection',
    'virtual.js',
  );
  if (!fs.existsSync(bundleFile)) {
    throw new Error(`virtual.js missing — run npm run build:virtual (${bundleFile})`);
  }
  const bundle = fs.readFileSync(bundleFile, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent('<!doctype html><html><body><main id="m"></main></body></html>');
  await page.evaluate(
    'globalThis.__SPECULUM_PROJECTION__ = { transport: "console", frameRateHz: 60 };',
  );
  await page.evaluate(bundle);
  await page.evaluate(() => {
    const m = document.getElementById('m');
    const d = document.createElement('div');
    d.textContent = 'x';
    m.appendChild(d);
  });
  await new Promise((r) => setTimeout(r, 300));

  const result = await page.evaluate(() => {
    const p = globalThis.__speculumProjection;
    if (!p) return { ok: false, reason: 'no __speculumProjection' };
    const tx = p.frameTransport;
    const last = tx.lastBytes;
    const magic =
      last && last.length >= 2 ? [last[0], last[1]] : null;
    return {
      ok: true,
      sends: tx.sends,
      seq: p.frameEmitter.currentSequence,
      len: last ? last.length : 0,
      magic,
    };
  });

  await browser.close();

  if (!result.ok) {
    console.error('SMOKE FAIL', result);
    process.exit(1);
  }
  if (result.sends < 1 || result.seq < 1) {
    console.error('SMOKE FAIL — expected at least one send', result);
    process.exit(1);
  }
  if (!result.magic || result.magic[0] !== 0x50 || result.magic[1] !== 0x50) {
    console.error('SMOKE FAIL — expected PP magic 0x50 0x50', result);
    process.exit(1);
  }
  console.log(
    `SMOKE OK — sends=${result.sends} seq=${result.seq} len=${result.len} magic=PP`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
