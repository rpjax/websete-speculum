/**
 * D-UI-20 spike — ABS uinput → Xorg → Chromium hit-test (Docker / Linux only).
 * PASS: moveTo + click lands at stamped coords (DOM probe 1:1).
 * Fail policy: no REL fallback.
 *
 * Usage: node scripts/spike-abs-pointer.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

async function main() {
  const { uinputAvailable } = require('../dist/browser/patchright/input/uinput');
  const { AbsOsInputStack } = require('../dist/browser/input/AbsOsInputStack');
  const { AbsPointerPeripheral } = require('../dist/browser/input/peripherals/AbsPointerPeripheral');
  const { Display, DisplayAllocator } = require('../dist/browser/patchright/Display');
  const { launchChrome, closeChrome } = require('../dist/browser/patchright/ChromeRuntime');

  if (!uinputAvailable()) {
    console.error('FAIL D-UI-20: /dev/uinput unavailable (run in Docker lab compose)');
    process.exit(2);
  }
  if (!process.env.CHROME_EXECUTABLE) {
    process.env.CHROME_EXECUTABLE = '/usr/bin/google-chrome';
  }

  const W = 800;
  const H = 600;
  const targetX = 240;
  const targetY = 180;
  const sessionId = `spike-abs-${Date.now()}`;
  const displays = new DisplayAllocator();
  let stack = null;
  let display = null;
  let chrome = null;

  try {
    stack = AbsOsInputStack.open({
      sessionId,
      displayWidth: W,
      displayHeight: H,
    });
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
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div id="hit" style="position:absolute;left:${targetX - 20}px;top:${targetY - 20}px;width:40px;height:40px;background:#0f0"></div>
      <pre id="log"></pre>
      <script>
        window.__hits = [];
        document.addEventListener('click', (e) => {
          window.__hits.push({ x: e.clientX, y: e.clientY, id: e.target && e.target.id });
          document.getElementById('log').textContent = JSON.stringify(window.__hits);
        }, true);
      </script>
    </body></html>`);

    const pointer = new AbsPointerPeripheral(stack.pointerWriter);
    // Settle Xorg/Chrome focus
    await new Promise((r) => setTimeout(r, 800));
    pointer.moveTo(targetX, targetY);
    await new Promise((r) => setTimeout(r, 50));
    pointer.button('left', true);
    await new Promise((r) => setTimeout(r, 30));
    pointer.button('left', false);
    await new Promise((r) => setTimeout(r, 200));

    const hits = await page.evaluate(() => window.__hits || []);
    const hit = hits[0];
    const ok =
      hit &&
      hit.id === 'hit' &&
      Math.abs(hit.x - targetX) <= 2 &&
      Math.abs(hit.y - targetY) <= 2;

    const report = {
      ok: !!ok,
      target: { x: targetX, y: targetY },
      hits,
      display: display.displayEnv,
      viewport: { w: W, h: H },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!ok) {
      console.error('FAIL D-UI-20: hit-test miss (no REL fallback)');
      process.exit(1);
    }
    console.log('PASS D-UI-20: ABS pointer hit-test 1:1');
    process.exit(0);
  } catch (err) {
    console.error('FAIL D-UI-20:', err && err.stack ? err.stack : err);
    process.exit(1);
  } finally {
    try {
      if (chrome) await closeChrome(chrome);
    } catch {
      /* */
    }
    try {
      if (display) await display.dispose();
    } catch {
      /* */
    }
    try {
      if (stack) stack.dispose();
    } catch {
      /* */
    }
  }
}

main();
