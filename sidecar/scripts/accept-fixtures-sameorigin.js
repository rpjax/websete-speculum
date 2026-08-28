'use strict';
/**
 * Same-origin fixture accept — loopback only (sanitize gate).
 */
process.env.SPECULUM_INPUT_BACKEND = process.env.SPECULUM_INPUT_BACKEND || 'os';
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');
const { chromium } = require('patchright');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sessionCase(target) {
  let frames = 0;
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const session = factory.create('fix-' + Date.now(), {
    onCrash: () => undefined,
    onConsole: () => undefined,
    onVideoFrame: () => undefined,
    onAudioFrame: () => undefined,
    onPageProjectionFrame: () => {
      frames += 1;
    },
    onLocationChanged: () => undefined,
    onTitleChanged: () => undefined,
  });
  try {
    await session.launch(
      labLaunchOptions({ width: 1280, height: 720, cpuProfiling: false, projectionDataPlane: 'loopback' }),
    );
    await session.navigate(target);
    await wait(8000);

    // Patchright page.evaluate runs outside MAIN — probe via CDP so we see Virtual globals.
    const cdp = session.cdpSession;
    if (!cdp) {
      return { kind: 'session', target, ok: false, frames, error: 'no cdpSession' };
    }
    const ev = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rt = globalThis.__speculumProjection;
        const ft = rt && rt.frameTransport;
        const cfg = globalThis.__SPECULUM_PROJECTION__;
        const sock = ft && ft.dataPlane && ft.dataPlane.socket;
        return {
          hasRuntime: !!rt,
          tableSize: rt && rt.table ? rt.table.size : null,
          wsOpen: ft ? ft.isOpen : null,
          wsReadyState: sock ? sock.readyState : null,
          transport: cfg && cfg.transport,
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const parsed = ev && ev.result && ev.result.value ? ev.result.value : null;
    const ok =
      frames > 0 &&
      parsed &&
      parsed.hasRuntime === true &&
      parsed.wsOpen === true &&
      parsed.wsReadyState === 1 &&
      parsed.transport === 'loopback';
    return { kind: 'session', target, ok, frames, probe: parsed, evalEx: ev && ev.exceptionDetails };
  } catch (e) {
    return { kind: 'session', target, ok: false, frames, error: e.message || String(e) };
  } finally {
    await session.dispose().catch(() => undefined);
  }
}

async function uiBrowse(target) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto('http://127.0.0.1:4103/', { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /ws open|connected/i.test(document.getElementById('chipWs')?.textContent ?? ''),
      null,
      { timeout: 20_000 },
    );
    await page.fill('#url', target);
    await page.click('#browseStart');
    const deadline = Date.now() + 45_000;
    let frames = 0;
    while (Date.now() < deadline) {
      frames = Number((await page.textContent('#streamFrames')) || '0');
      if (frames >= 1) break;
      await wait(400);
    }
    const dump = await page.evaluate(() => {
      const host = document.querySelector('#surfaceHost iframe');
      const doc = host && host.contentDocument;
      return {
        frames: document.getElementById('streamFrames')?.textContent,
        phase: document.getElementById('chipPhase')?.textContent,
        htmlLen: doc?.documentElement?.outerHTML?.length ?? 0,
        title: doc?.title ?? '',
      };
    });
    await page.click('#browseStop').catch(() => undefined);
    return {
      kind: 'ui',
      target,
      ok: frames >= 1 && dump.htmlLen > 50,
      frames,
      dump,
    };
  } catch (e) {
    return { kind: 'ui', target, ok: false, error: e.message || String(e) };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  const cases = [];
  for (const t of [
    'http://127.0.0.1:4103/fixtures/input-click.html',
    'http://127.0.0.1:4103/fixtures/input-forms.html',
  ]) {
    const r = await sessionCase(t);
    cases.push(r);
    console.log('SESSION', JSON.stringify(r));
    await wait(2000);
  }
  for (const t of [
    'http://127.0.0.1:4103/fixtures/input-click.html',
    'http://127.0.0.1:4103/fixtures/input-forms.html',
  ]) {
    const r = await uiBrowse(t);
    cases.push(r);
    console.log('UI', JSON.stringify(r));
    await wait(2000);
  }
  const failed = cases.filter((c) => !c.ok);
  console.log('REPORT', JSON.stringify({ pass: failed.length === 0, failed }, null, 2));
  process.exit(failed.length === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
