/**
 * One-shot: does Virtual boot contextId=2 on lab XO fixture?
 * Prints boot_established / scope_admitted / deliverable lines from console + iframe probe.
 */
const http = require('node:http');
const path = require('node:path');
const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const {
  createCrossOriginFixtureServer,
  labConfigJson,
} = require('../dist/browser/mirror/projection/lab/crossOriginFixtureServer');
const { pipeFixtureFile } = require('../dist/browser/mirror/projection/lab/fixtureServe');
const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

const BOOT_RE = /\[speculum-context\]/;
const BOOT_DIAG_RE = /\[speculum-boot-diag\].*boot_established/;

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const bootLines = [];
  const { fixturesDir } = labAssetRoots();
  const xo = await createCrossOriginFixtureServer('127.0.0.1');
  const srv = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    const pathname = urlPath.split('?')[0];
    if (pathname === '/lab/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(labConfigJson(xo.origin)));
      return;
    }
    if (!urlPath.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    pipeFixtureFile(res, path.join(fixturesDir, decodeURIComponent(urlPath.slice('/fixtures/'.length))));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/fixtures/input-iframe-xo.html`;
  console.log('[lab-xo-context-log] url', url, 'xo', xo.origin);

  const chassis = new LabChassis({ headless: true });
  const contextLines = [];
  const origEvents = chassis.browserEvents?.bind(chassis);
  try {
    await chassis.boot({
      mode: 'run',
      url,
      frameRateHz: 30,
      telemetry: { enabled: true, diagBoot: true },
    });

    const session = chassis.browser;
    if (!session) throw new Error('no session');

    await new Promise((r) => setTimeout(r, 9000));

    const rootOutcome = await session.evaluateVirtualExpression?.(
      'JSON.stringify(globalThis.__speculumBootOutcome ?? null)',
      1,
    );
    const nestedOutcome = await session.evaluateVirtualExpression?.(
      'JSON.stringify(globalThis.__speculumBootOutcome ?? null)',
      2,
    );
    const nestedCtx = await session.evaluateVirtualExpression?.(
      'String(globalThis.__speculumProjection?.contextId ?? "none")',
      2,
    );

    console.log('[lab-xo-context-log] virtual root bootOutcome', rootOutcome);
    console.log('[lab-xo-context-log] virtual nested bootOutcome', nestedOutcome);
    console.log('[lab-xo-context-log] virtual nested contextId', nestedCtx);

    const st = await session.evaluate("document.getElementById('state')?.textContent ?? ''");
    const src = await session.evaluate("document.getElementById('xo-child')?.getAttribute('src') ?? ''");
    console.log('[lab-xo-context-log] page state', st.value, 'iframeSrc', src.value);

    const click = await session.resolveAndClickDomInputByNodeId?.('#inner-click', 2);
    console.log('[lab-xo-context-log] resolveAndClick', click);
  } finally {
    await chassis.dispose().catch(() => undefined);
    await xo.close().catch(() => undefined);
    await new Promise((r) => srv.close(r));
  }
}

main().catch((e) => {
  console.error('[lab-xo-context-log] fatal', e);
  process.exit(1);
});
