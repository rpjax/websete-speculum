'use strict';
/**
 * D-UI-20 QA spike — multi-point ABS → Chromium hit-test (Docker only).
 *
 * Proves identity F(x) across a grid (corners, edges, interior) with ≤2px error.
 * No chrome-inset calibration. No producer CDP RPC.
 *
 * Usage: node scripts/spike-abs-pointer.js
 * Env: ABS_SPIKE_TOL=2 (default), ABS_SPIKE_SETTLE_MS=40
 */

async function main() {
  const { uinputAvailable } = require('../dist/browser/patchright/input/uinput');
  const { AbsOsInputStack } = require('../dist/browser/input/AbsOsInputStack');
  const { AbsPointerPeripheral } = require('../dist/browser/input/peripherals/AbsPointerPeripheral');
  const { Display, DisplayAllocator } = require('../dist/browser/patchright/Display');
  const { launchChrome, closeChrome, ensureChromeXFocus } = require('../dist/browser/patchright/ChromeRuntime');
  const { mapLogicalToAbs, createLogicalWindowTransform } = require('../dist/browser/patchright/input/logical-to-device');

  if (!uinputAvailable()) {
    console.error('FAIL D-UI-20: /dev/uinput unavailable (run in Docker lab compose)');
    process.exit(2);
  }
  if (!process.env.CHROME_EXECUTABLE) {
    process.env.CHROME_EXECUTABLE = '/usr/bin/google-chrome';
  }

  const W = 800;
  const H = 600;
  const tol = Math.max(0, Number(process.env.ABS_SPIKE_TOL || 2));
  const settleMs = Math.max(0, Number(process.env.ABS_SPIKE_SETTLE_MS || 40));
  // Grid: corners inset 2px (avoid window-edge drop), mid-edges, center, prior regression point.
  const targets = [
    [2, 2],
    [W - 3, 2],
    [2, H - 3],
    [W - 3, H - 3],
    [Math.floor(W / 2), 2],
    [Math.floor(W / 2), H - 3],
    [2, Math.floor(H / 2)],
    [W - 3, Math.floor(H / 2)],
    [Math.floor(W / 2), Math.floor(H / 2)],
    [240, 180],
    [100, 500],
    [700, 50],
  ];

  const sessionId = `spike-abs-${Date.now()}`;
  const displays = new DisplayAllocator();
  let stack = null;
  let display = null;
  let chrome = null;

  try {
    stack = AbsOsInputStack.open({ sessionId, displayWidth: W, displayHeight: H });
    const displayNum = displays.allocate();
    display = await Display.start(displayNum, W, H, stack.displayInputDevices());
    chrome = await launchChrome({
      sessionId,
      displayEnv: display.displayEnv,
      width: W,
      height: H,
      locale: 'en-US',
      language: 'en-US',
      timeZoneId: 'UTC',
      colorScheme: 'light',
    });

    const page = chrome.page;
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#111">
      <pre id="log" style="color:#0f0;font:12px monospace"></pre>
      <script>
        window.__hits = [];
        document.addEventListener('click', (e) => {
          window.__hits.push({ x: e.clientX, y: e.clientY, t: performance.now() });
          document.getElementById('log').textContent = JSON.stringify(window.__hits);
        }, true);
      </script>
    </body></html>`);

    await new Promise((r) => setTimeout(r, 600));
    await ensureChromeXFocus(display.displayEnv);

    // Geometry oracle: content origin must be ~display (0,0) after applyNativeWindowBounds.
    const geomText = await page.evaluate(`JSON.stringify({
      innerW: window.innerWidth|0,
      innerH: window.innerHeight|0,
      outerW: window.outerWidth|0,
      outerH: window.outerHeight|0,
      screenX: window.screenX|0,
      screenY: window.screenY|0
    })`);
    const geom = JSON.parse(geomText);

    const t = createLogicalWindowTransform(W, H);
    const pointer = new AbsPointerPeripheral(stack.pointerWriter);
    const results = [];
    let maxErr = 0;
    let failCount = 0;
    const wall0 = Date.now();

    for (const [tx, ty] of targets) {
      await page.evaluate(`window.__hits = []; document.getElementById('log').textContent = '[]'`);
      const abs = mapLogicalToAbs(t, tx, ty);
      const tClick0 = Date.now();
      pointer.moveTo(tx, ty);
      await new Promise((r) => setTimeout(r, settleMs));
      pointer.button('left', true);
      await new Promise((r) => setTimeout(r, 20));
      pointer.button('left', false);
      await new Promise((r) => setTimeout(r, 120));
      const clickMs = Date.now() - tClick0;

      const logText = await page.evaluate(`document.getElementById('log')?.textContent || '[]'`);
      let hits = [];
      try {
        hits = JSON.parse(logText);
      } catch {
        hits = [];
      }
      const hit = hits[hits.length - 1] || null;
      const errX = hit ? Math.abs(hit.x - tx) : Infinity;
      const errY = hit ? Math.abs(hit.y - ty) : Infinity;
      const err = Math.max(errX, errY);
      if (Number.isFinite(err)) maxErr = Math.max(maxErr, err);
      const ok = hit && errX <= tol && errY <= tol;
      if (!ok) failCount++;
      results.push({
        target: { x: tx, y: ty },
        abs,
        hit,
        errX: Number.isFinite(errX) ? errX : null,
        errY: Number.isFinite(errY) ? errY : null,
        ok: !!ok,
        clickMs,
      });
    }

    const wallMs = Date.now() - wall0;
    const report = {
      ok: failCount === 0,
      viewport: { w: W, h: H },
      tol,
      geom,
      transform: t,
      points: targets.length,
      failCount,
      maxErr: failCount === targets.length && maxErr === 0 ? null : maxErr,
      wallMs,
      avgClickMs: Math.round(wallMs / targets.length),
      results,
    };
    console.log(JSON.stringify(report, null, 2));

    if (failCount > 0) {
      console.error(`FAIL D-UI-20: ${failCount}/${targets.length} points outside ±${tol}px (maxErr=${maxErr})`);
      process.exit(1);
    }
    // Soft perf signal (not SLO): multi-point sequence should finish in a few seconds, not tens.
    if (wallMs > 30_000) {
      console.error(`FAIL D-UI-20: wall ${wallMs}ms too slow for ${targets.length} points`);
      process.exit(1);
    }
    console.log(`PASS D-UI-20 (${targets.length} points, maxErr=${maxErr}px, ${wallMs}ms)`);
  } finally {
    if (chrome) await closeChrome(chrome).catch(() => {});
    if (display) await display.dispose().catch(() => {});
    if (stack) stack.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
