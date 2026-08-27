'use strict';
/**
 * Raw Patchright: HTTPS + Fetch CSP surgery + loopback WS after in-page nav.
 */
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { WebSocketServer } = require('ws');
const { chromium } = require('patchright');

const root = path.join(__dirname, '..', '..', '..');
const {
  installDocumentResponseHook,
  cspDocumentMutator,
} = require(path.join(root, 'dist/browser/mirror/projection/session/csp/documentResponseHook'));
const { createProjectionProducerDocumentMutator } = require(path.join(
  root,
  'dist/browser/mirror/projection/session/csp/projectionProducerDocumentMutator',
));

const OUT = path.join(root, 'lab-runs', 'diag-csp-https-raw');
const CERT_DIR = path.join(OUT, 'certs');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const STRICT =
  "default-src 'self'; script-src 'self' 'unsafe-inline' *; connect-src 'self' https://*.binance.com; img-src https:";

function ensureCerts() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ]);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function page(title, next) {
  const link = next ? `<a id="go" href="${next}">go</a>` : '<span id="landed">ok</span>';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STRICT}">
<title>${title}</title></head><body><h1 id="title">${title}</h1>${link}</body></html>`;
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });
  const tls = ensureCerts();

  // Loopback data-plane target
  const planeServer = http.createServer((_req, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ noServer: true });
  let planeAccepts = 0;
  planeServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      planeAccepts += 1;
      ws.close();
    });
  });
  await new Promise((r) => planeServer.listen(0, '127.0.0.1', r));
  const planeUrl = `ws://127.0.0.1:${planeServer.address().port}/`;

  const site = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const p = (req.url || '/').split('?')[0];
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': STRICT,
      'Cache-Control': 'no-store',
    };
    if (p === '/en') {
      res.writeHead(200, headers);
      res.end(page('EN', '/br'));
      return;
    }
    if (p === '/br') {
      res.writeHead(200, headers);
      res.end(page('BR', null));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const origin = `https://127.0.0.1:${site.address().port}`;

  const configPre = `window.__speculumProjectionConfig=${JSON.stringify({
    transport: 'loopback',
    dataPlaneUrl: planeUrl,
    generation: 1,
    frameRateHz: 10,
  })};`;

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageObj = await context.newPage();
  const consoleLines = [];
  pageObj.on('console', (msg) => consoleLines.push(msg.text()));
  pageObj.on('pageerror', (err) => consoleLines.push(String(err)));

  await pageObj.addInitScript({ content: configPre });
  await pageObj.addInitScript({
    content: `(() => { try { const c = window.__speculumProjectionConfig; if (!c?.dataPlaneUrl) return; const ws = new WebSocket(c.dataPlaneUrl); ws.binaryType='arraybuffer'; window.__plane = ws; } catch (e) { console.error('plane_open_fail', e); } })();`,
  });

  const cdp = await context.newCDPSession(pageObj);
  await installDocumentResponseHook(cdp, {
    mutators: [
      cspDocumentMutator,
      createProjectionProducerDocumentMutator({ configPreScript: configPre }),
    ],
    storedScripts: [{ file: '/__speculum/virtual.js', content: '/* stub */' }],
    context,
    page: pageObj,
  });

  const report = { origin, planeUrl, phases: [] };

  async function probe(label) {
    await wait(500);
    const title = await pageObj.evaluate(() => document.getElementById('title')?.textContent ?? '');
    const meta = await pageObj.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
    );
    const ready = await pageObj.evaluate(
      () => window.__plane && window.__plane.readyState === 1 /* OPEN */,
    );
    return {
      label,
      title,
      metaWidened: /\bconnect-src\b[^;]*(\*|ws:)/.test(meta),
      metaSnippet: meta.slice(0, 220),
      planeReady: !!ready,
      planeAccepts,
      hits: consoleLines.filter((t) => /CSP|Content Security|Mixed Content|plane_open/i.test(t)).slice(0, 8),
    };
  }

  try {
    await pageObj.goto(`${origin}/en`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    report.phases.push(await probe('cold'));
    consoleLines.length = 0;
    const beforeAccepts = planeAccepts;
    await pageObj.click('#go');
    await pageObj.waitForFunction(() => document.getElementById('title')?.textContent === 'BR', null, {
      timeout: 15_000,
    });
    report.phases.push(await probe('after-nav'));
    report.planeAcceptsDelta = planeAccepts - beforeAccepts;
  } catch (err) {
    report.error = String(err && err.message ? err.message : err);
  } finally {
    await browser.close();
    await new Promise((r) => site.close(r));
    await new Promise((r) => planeServer.close(r));
  }

  const after = report.phases.find((p) => p.label === 'after-nav');
  report.verdict =
    after && after.title === 'BR' && after.metaWidened && after.planeReady ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
