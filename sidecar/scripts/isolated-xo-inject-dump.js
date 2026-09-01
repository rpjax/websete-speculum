/**
 * Isolated XO injection dump — no lab host, no websocket, no LabChassis.
 * Launches Chromium + extension, opens noredirect fixture, waits 3s,
 * dumps Page.getFrameTree + heap markers per frame via CDP, prints JSON, exits.
 *
 * Usage (from sidecar/, after build):
 *   node scripts/isolated-xo-inject-dump.js
 *   SPECULUM_ISOLATED_HEADED=1 node scripts/isolated-xo-inject-dump.js
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  launchChrome,
  closeChrome,
  materializeSpeculumPpForSession,
} = require('../dist/browser/patchright/ChromeRuntime');
const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const { createCrossOriginFixtureServer } = require('../dist/browser/mirror/projection/lab/crossOriginFixtureServer');
const { pipeFixtureFile } = require('../dist/browser/mirror/projection/lab/fixtureServe');

const WAIT_MS = 3000;
const FIXTURE = 'input-iframe-xo-noredirect.html';
const HEAP_EXPR = `(() => ({
  upward: typeof globalThis.__speculumProjectionUpward,
  config: typeof globalThis.__SPECULUM_PROJECTION__,
  configReady: typeof globalThis.__SPECULUM_PROJECTION_READY__,
  projection: !!globalThis.__speculumProjection,
  bootOutcome: globalThis.__speculumBootOutcome ?? null,
  contextId: globalThis.__speculumProjection?.contextId ?? null,
  href: location.href,
}))()`;

async function heapFromPlaywrightFrame(frame) {
  try {
    return await frame.evaluate(() => ({
      upward: typeof globalThis.__speculumProjectionUpward,
      config: typeof globalThis.__SPECULUM_PROJECTION__,
      configReady: typeof globalThis.__SPECULUM_PROJECTION_READY__,
      projection: !!globalThis.__speculumProjection,
      bootOutcome: globalThis.__speculumBootOutcome ?? null,
      contextId: globalThis.__speculumProjection?.contextId ?? null,
      href: location.href,
    }));
  } catch (err) {
    return {
      error: 'frame_evaluate_failed',
      message: err instanceof Error ? err.message : String(err),
      href: frame.url(),
    };
  }
}

async function waitForXoFrame(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = page.frames();
    const xo = frames.find((f) => /4078|input-xo\/inner/i.test(f.url()));
    if (xo && !xo.url().startsWith('chrome-error:')) return frames;
    await new Promise((r) => setTimeout(r, 200));
  }
  return page.frames();
}

function walkFrameTree(node, out) {
  out.push(node.frame);
  for (const c of node.childFrames || []) walkFrameTree(c, out);
}

async function heapForFrame(cdp, frame, contextsByFrame) {
  const contexts = contextsByFrame.get(frame.id) || [];
  const mainCtx =
    contexts.find((c) => c.auxData?.isDefault === true) ||
    contexts.find((c) => c.auxData?.type === 'default') ||
    contexts[0];
  if (!mainCtx) {
    return { frameId: frame.id, url: frame.url, error: 'no_execution_context' };
  }
  try {
    const ev = await cdp.send('Runtime.evaluate', {
      expression: HEAP_EXPR,
      contextId: mainCtx.id,
      returnByValue: true,
    });
    return {
      frameId: frame.id,
      url: frame.url,
      executionContextId: mainCtx.id,
      heap: ev.result?.value ?? null,
      exception: ev.exceptionDetails ?? null,
    };
  } catch (err) {
    return {
      frameId: frame.id,
      url: frame.url,
      error: 'evaluate_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const headed = process.env.SPECULUM_ISOLATED_HEADED === '1';
  const sessionId = `isolated-xo-${crypto.randomUUID()}`;
  const { fixturesDir } = labAssetRoots();

  let xo = null;
  let xoOrigin = '';
  let xoOwned = false;
  for (const port of [4079, 4080, 4081, 0]) {
    try {
      xo = await createCrossOriginFixtureServer('127.0.0.1', port || undefined);
      xoOrigin = xo.origin;
      xoOwned = true;
      break;
    } catch (err) {
      if (!(err && err.code === 'EADDRINUSE')) throw err;
    }
  }
  if (!xoOrigin) throw new Error('could not start XO fixture server');

  const noredirectHtml = fs
    .readFileSync(path.join(fixturesDir, FIXTURE), 'utf8')
    .replace(/http:\/\/127\.0\.0\.1:4078/g, xoOrigin);

  const srv = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    const pathname = urlPath.split('?')[0];
    if (pathname === `/fixtures/${FIXTURE}`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(noredirectHtml);
      return;
    }
    if (!urlPath.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    pipeFixtureFile(res, path.join(fixturesDir, decodeURIComponent(urlPath.slice('/fixtures/'.length))));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const hostPort = srv.address().port;
  const fixtureUrl = `http://127.0.0.1:${hostPort}/fixtures/${FIXTURE}`;

  const consoleBuf = [];
  const contextsByFrame = new Map();
  const onCtx = (params) => {
    const ctx = params.context;
    const frameId = ctx.auxData?.frameId;
    if (!frameId) return;
    if (!contextsByFrame.has(frameId)) contextsByFrame.set(frameId, []);
    contextsByFrame.get(frameId).push(ctx);
  };

  const extPath = materializeSpeculumPpForSession(sessionId);
  let chrome = null;
  try {
    chrome = await launchChrome({
      sessionId,
      headless: !headed,
      width: 1280,
      height: 720,
      locale: 'en-US',
      language: 'en-US',
      timeZoneId: 'UTC',
      colorScheme: 'light',
      extensionPaths: [extPath],
    });

    const { page, cdp } = chrome;
    page.on('console', (msg) => consoleBuf.push(msg.text()));

    cdp.on('Runtime.executionContextCreated', onCtx);
    cdp.on('Runtime.consoleAPICalled', (ev) => {
      const parts = (ev.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleBuf.push(parts);
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // No addInitScript — it breaks cross-origin iframe load (chrome-error). Extension
    // content scripts still inject; config comes from SW storage when C2 is wired.

    await page.goto(fixtureUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    const pwFrames = await waitForXoFrame(page, 5000);
    await new Promise((r) => setTimeout(r, 1000));

    let frameTree;
    try {
      ({ frameTree } = await cdp.send('Page.getFrameTree'));
    } catch (err) {
      console.log(
        JSON.stringify(
          {
            error: 'browser_closed_before_dump',
            message: err instanceof Error ? err.message : String(err),
            consoleLines: consoleBuf.slice(-20),
            patchrightFrames: page.isClosed() ? [] : page.frames().map((f) => f.url()),
          },
          null,
          2,
        ),
      );
      return;
    }

    const frames = [];
    walkFrameTree(frameTree, frames);
    const heaps = [];
    for (const frame of frames) {
      heaps.push(await heapForFrame(cdp, frame, contextsByFrame));
    }
    const pwHeaps = [];
    for (const frame of pwFrames) {
      pwHeaps.push({ url: frame.url(), heap: await heapFromPlaywrightFrame(frame) });
    }

    const innerLabel = pwFrames
      .find((f) => /input-xo\/inner/i.test(f.url()))
      ?.evaluate(() => document.getElementById('inner-label')?.textContent ?? null)
      .catch(() => null);

    const aliveLines = consoleBuf.filter((t) => t.includes('[xo-inner] alive'));
    const speculumLines = consoleBuf.filter((t) => /speculum-context|speculum-boot-diag/i.test(t));

    const out = {
      probe: 'isolated-xo-inject-dump',
      headed,
      fixtureUrl,
      xoOrigin,
      xoOwned,
      waitMs: WAIT_MS,
      pageUrl: page.url(),
      patchrightFrameUrls: pwFrames.map((f) => f.url()),
      consoleAliveCount: aliveLines.length,
      consoleAliveLines: aliveLines.slice(0, 5),
      innerLabel: await innerLabel,
      consoleSpeculumLines: speculumLines.slice(-10),
      frameTreeUrls: frames.map((f) => f.url),
      cdpHeaps: heaps,
      playwrightHeaps: pwHeaps,
    };

    console.log(JSON.stringify(out, null, 2));
    const outPath = path.join(__dirname, '..', 'lab-runs', 'isolated-xo-inject-dump-last.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.error('[isolated-xo-inject-dump] wrote', outPath);

    if (headed) {
      console.error('[isolated-xo-inject-dump] headed — DevTools: inspect iframe 4078, chrome://extensions Errors');
      await new Promise((r) => setTimeout(r, 120_000));
    }
  } finally {
    if (chrome?.cdp) chrome.cdp.off('Runtime.executionContextCreated', onCtx);
    if (chrome) await closeChrome(chrome).catch(() => undefined);
    await xo?.close().catch(() => undefined);
    await new Promise((r) => srv.close(r));
  }
}

main().catch((e) => {
  console.error('[isolated-xo-inject-dump] fatal', e);
  process.exit(1);
});
