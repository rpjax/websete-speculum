/**
 * Throwaway: capture the byte breakdown console.log (binaryFrameEncoder.ts
 * DEBUG_FIRST_FRAME_BYTES) for the seq=1 resync frame against demo.html, to answer the
 * "48KB for 34 nodes" question with evidence instead of guessing. Run:
 *   node scripts/diag-first-frame.js
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('patchright');
const { loadInpageScript } = require('../dist/browser/mirror/projection/inject/loadInpageScript');
const { buildConfigPreScript } = require('../dist/browser/mirror/projection/inject/buildConfigPreScript');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function serveFixture(fixturePath) {
  const html = fs.readFileSync(fixturePath);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function main() {
  const fixturePath = path.join(
    __dirname,
    '..',
    'browser',
    'mirror',
    'projection',
    'lab',
    'static',
    'fixtures',
    'demo.html',
  );
  const { server: fixtureServer, url: fixtureUrl } = await serveFixture(fixturePath);

  const configPre = buildConfigPreScript({
    transport: 'discard',
    frameRateHz: 30,
    telemetry: { enabled: false },
  });
  const mainScript = loadInpageScript();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript({ content: configPre });
  await page.addInitScript({ content: mainScript });

  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await wait(1500);

  const diag = await page.evaluate(() => globalThis.__speculumDiag ?? null);
  console.log(JSON.stringify(diag, null, 2));

  await browser.close();
  fixtureServer.close();
}

main().catch((err) => {
  console.error('DIAG FAIL', err);
  process.exitCode = 1;
});
