/**
 * Opus probe 1–3: console collector validation, CDP heap on 4078 frame, noredirect fixture.
 * Raw values only — no interpretation in output.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const {
  createCrossOriginFixtureServer,
  labConfigJson,
} = require('../dist/browser/mirror/projection/lab/crossOriginFixtureServer');
const { pipeFixtureFile } = require('../dist/browser/mirror/projection/lab/fixtureServe');
const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

const WAIT_MS = 9000;
const HEAP_EXPR = `(() => ({
  upward: typeof globalThis.__speculumProjectionUpward,
  config: typeof globalThis.__SPECULUM_PROJECTION__,
  configReady: typeof globalThis.__SPECULUM_PROJECTION_READY__,
  projection: !!globalThis.__speculumProjection,
  bootOutcome: globalThis.__speculumBootOutcome ?? null,
  href: location.href,
}))()`;

async function cdpHeapOn4078(cdp, contextsByFrame) {
  if (!cdp) return { error: 'no_main_cdp' };

  let frameTree;
  try {
    ({ frameTree } = await cdp.send('Page.getFrameTree'));
  } catch (err) {
    return { error: 'getFrameTree_failed', message: err instanceof Error ? err.message : String(err) };
  }

  function walk(node, out) {
    out.push(node.frame);
    for (const c of node.childFrames || []) walk(c, out);
  }
  const allFrames = [];
  walk(frameTree, allFrames);
  const xoFrame = allFrames.find((f) => /4078|input-xo\/inner/i.test(f.url || ''));

  if (!xoFrame) {
    return {
      error: 'xo_frame_not_in_tree',
      frameUrls: allFrames.map((f) => f.url),
    };
  }

  const contexts = contextsByFrame.get(xoFrame.id) || [];
  const mainCtx =
    contexts.find((c) => c.auxData?.isDefault === true) ||
    contexts.find((c) => c.auxData?.type === 'default') ||
    contexts[0];

  if (!mainCtx) {
    return {
      error: 'no_execution_context',
      xoFrameUrl: xoFrame.url,
      xoFrameId: xoFrame.id,
      knownContextFrameIds: [...contextsByFrame.keys()],
    };
  }

  let ev;
  try {
    ev = await cdp.send('Runtime.evaluate', {
      expression: HEAP_EXPR,
      contextId: mainCtx.id,
      returnByValue: true,
    });
  } catch (err) {
    return {
      error: 'evaluate_failed',
      message: err instanceof Error ? err.message : String(err),
      xoFrameUrl: xoFrame.url,
      executionContextId: mainCtx.id,
    };
  }

  return {
    xoFrameUrl: xoFrame.url,
    xoFrameId: xoFrame.id,
    executionContextId: mainCtx.id,
    heap: ev.result?.value ?? null,
    exception: ev.exceptionDetails ?? null,
  };
}

async function probeFixture(chassis, baseUrl, fixture, consoleBuf, xoOrigin, contextsByFrame, cdp) {
  consoleBuf.length = 0;
  const url = `${baseUrl}/fixtures/${fixture}`;
  await chassis.navigate(url);
  await new Promise((r) => setTimeout(r, WAIT_MS));

  const session = chassis.browser;
  if (!session) throw new Error('no session');

  const cfgRaw = await session.evaluate(
    `(() => fetch('/lab/config.json').then(r => r.ok ? r.json() : null).catch(() => null))()`,
  );
  const iframeSrc = await session.evaluate("document.getElementById('xo-child')?.src ?? ''");
  const state = await session.evaluate("document.getElementById('state')?.textContent ?? ''");

  const nestedOutcomeRaw = await session.evaluateVirtualExpression?.(
    'JSON.stringify(globalThis.__speculumBootOutcome ?? null)',
    2,
  );
  const nestedCtx = await session.evaluateVirtualExpression?.(
    'String(globalThis.__speculumProjection?.contextId ?? "none")',
    2,
  );
  const click = await session.resolveAndClickDomInputByNodeId?.('#inner-click', 2);
  const heap = await cdpHeapOn4078(cdp, contextsByFrame);
  const page = session['chrome']?.page;
  const patchrightFrameUrls = page ? page.frames().map((f) => f.url()) : null;
  const pageUrl = page ? page.url() : null;

  const aliveLines = consoleBuf.filter((t) => t.includes('[xo-inner] alive'));
  const contextLines = consoleBuf.filter((t) => /speculum-context|speculum-boot-diag/i.test(t));

  return {
    fixture,
    labConfigCrossOrigin: cfgRaw.ok ? cfgRaw.value?.crossOriginOrigin ?? null : null,
    iframeSrc: iframeSrc.ok ? iframeSrc.value : null,
    pageState: state.ok ? state.value : null,
    consoleAliveCount: aliveLines.length,
    consoleAliveLines: aliveLines.slice(0, 5),
    consoleContextLines: contextLines.slice(-8),
    nestedBootOutcomeRaw: nestedOutcomeRaw,
    nestedContextId: nestedCtx,
    resolveAndClick: click,
    pageUrl,
    patchrightFrameUrls,
    cdpHeap4078: heap,
  };
}

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const { fixturesDir } = labAssetRoots();
  let xoOrigin = 'http://127.0.0.1:4078';
  let xo = null;
  try {
    xo = await createCrossOriginFixtureServer('127.0.0.1');
    xoOrigin = xo.origin;
  } catch (err) {
    if (!(err && err.code === 'EADDRINUSE')) throw err;
  }

  const srv = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    const pathname = urlPath.split('?')[0];
    if (pathname === '/lab/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(labConfigJson(xoOrigin)));
      return;
    }
    if (!urlPath.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    pipeFixtureFile(res, path.join(fixturesDir, decodeURIComponent(urlPath.slice('/fixtures/'.length))));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;

  const consoleBuf = [];
  const contextsByFrame = new Map();
  let cdpRef = null;
  const onCtx = (params) => {
    const ctx = params.context;
    const frameId = ctx.auxData?.frameId;
    if (!frameId) return;
    if (!contextsByFrame.has(frameId)) contextsByFrame.set(frameId, []);
    contextsByFrame.get(frameId).push(ctx);
  };

  const chassis = new LabChassis({ headless: true });
  chassis.setConsoleRelay((ev) => {
    if (ev?.text) consoleBuf.push(ev.text);
  });

  try {
    await chassis.boot({
      mode: 'run',
      url: `${baseUrl}/fixtures/input-iframe-xo.html`,
      frameRateHz: 30,
      telemetry: { enabled: true, diagBoot: true },
    });

    cdpRef = chassis.browser?.['chrome']?.cdp ?? null;
    if (cdpRef) {
      try {
        cdpRef.on('Runtime.executionContextCreated', onCtx);
        await cdpRef.send('Runtime.enable');
        await cdpRef.send('Page.enable');
      } catch (err) {
        console.error('[xo-inject-probe] cdp_enable_failed', err instanceof Error ? err.message : String(err));
        cdpRef = null;
      }
    }

    const withRedirect = await probeFixture(
      chassis,
      baseUrl,
      'input-iframe-xo.html',
      consoleBuf,
      xoOrigin,
      contextsByFrame,
      cdpRef,
    );
    const noRedirect = await probeFixture(
      chassis,
      baseUrl,
      'input-iframe-xo-noredirect.html',
      consoleBuf,
      xoOrigin,
      contextsByFrame,
      cdpRef,
    );

    const out = {
      xoOrigin,
      fixtureHost: baseUrl,
      withRedirect,
      noRedirect,
    };
    console.log(JSON.stringify(out, null, 2));

    const outPath = path.join(__dirname, '..', 'lab-runs', 'xo-inject-probe-last.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.error('[xo-inject-probe] wrote', outPath);
  } finally {
    if (cdpRef) cdpRef.off('Runtime.executionContextCreated', onCtx);
    await chassis.dispose().catch(() => undefined);
    await xo?.close().catch(() => undefined);
    await new Promise((r) => srv.close(r));
  }
}

main().catch((e) => {
  console.error('[xo-inject-probe] fatal', e);
  process.exit(1);
});
