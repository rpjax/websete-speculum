'use strict';
/**
 * OBSOLETE (2026-08-27): PP inject is CDP-only — no stored-script Fetch fulfill.
 * Use inject/projectionRuntimeInstaller.unit.ts + projectionRuntimeInstaller.
 *
 * Prove whether installDocumentResponseHook fulfills /__speculum/virtual.js
 * when injected into a cross-origin iframe Document (CF-shaped).
 */
const http = require('node:http');
const { chromium } = require('patchright');
const {
  installDocumentResponseHook,
  cspDocumentMutator,
} = require('../dist/browser/mirror/projection/session/csp/documentResponseHook.js');
const {
  createProjectionProducerDocumentMutator,
  PROJECTION_VIRTUAL_SCRIPT_PATH,
} = require('../dist/browser/mirror/projection/session/csp/projectionProducerDocumentMutator.js');

const fs = require('node:fs');
const path = require('node:path');
const REAL_BUNDLE = fs.readFileSync(
  path.join(__dirname, '../dist/browser/mirror/projection/virtual.js'),
  'utf8',
);
// Marker prepended so we can detect execution without depending on full boot.
const BUNDLE =
  'document.documentElement.setAttribute("data-fulfill","1");' + REAL_BUNDLE;
const CONFIG =
  'document.documentElement.setAttribute("data-config","1"); window.__SPECULUM_CONFIG_OK__ = true;';

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function main() {
  const hits = [];

  const xo = await listen((req, res) => {
    hits.push({ host: 'xo', url: req.url, method: req.method });
    if (req.url === '/' || req.url?.startsWith('/challenge')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'nonce-abc' 'unsafe-inline'",
      });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>xo</title></head>` +
          `<body><h1>challenge-shell</h1>` +
          `<script nonce="abc">document.documentElement.setAttribute("data-cf","1");window.__CF_RAN__=true;</script>` +
          `</body></html>`,
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': '' });
    res.end('');
  });
  const xoPort = xo.address().port;

  let iframeSrc = '';
  const mainSrv = await listen((req, res) => {
    hits.push({ host: 'main', url: req.url, method: req.method });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><body>` +
        `<h1>main</h1>` +
        `<iframe id="cf" src="${iframeSrc}"></iframe>` +
        `</body></html>`,
    );
  });
  const mainPort = mainSrv.address().port;
  iframeSrc = `http://cf.test:${xoPort}/challenge`;
  const siteUrl = `http://site.test:${mainPort}/`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--host-resolver-rules=MAP site.test 127.0.0.1,MAP cf.test 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoles = [];
  page.on('console', (m) => consoles.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoles.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) =>
    consoles.push(`[reqfail] ${r.url()} ${r.failure()?.errorText ?? ''}`),
  );

  const cdp = await context.newCDPSession(page);
  const paused = [];
  const net = [];
  await cdp.send('Network.enable', {});
  cdp.on('Network.responseReceived', (ev) => {
    const url = ev?.response?.url ?? '';
    if (url.includes('/challenge') || url.includes('__speculum/virtual.js')) {
      net.push({
        url,
        status: ev.response.status,
        mime: ev.response.mimeType,
        csp:
          ev.response.headers?.['content-security-policy'] ??
          ev.response.headers?.['Content-Security-Policy'] ??
          null,
        ct:
          ev.response.headers?.['content-type'] ??
          ev.response.headers?.['Content-Type'] ??
          null,
      });
    }
  });
  await installDocumentResponseHook(cdp, {
    mutators: [
      cspDocumentMutator,
      createProjectionProducerDocumentMutator({ configPreScript: CONFIG }),
    ],
    storedScripts: [{ file: PROJECTION_VIRTUAL_SCRIPT_PATH, content: BUNDLE }],
  });
  cdp.on('Fetch.requestPaused', (ev) => {
    paused.push({
      stage: ev.responseStatusCode === undefined ? 'Request' : 'Response',
      url: ev.request?.url,
      type: ev.resourceType,
      status: ev.responseStatusCode,
    });
  });

  await page.goto(siteUrl, { waitUntil: 'networkidle' });
  await new Promise((r) => setTimeout(r, 2000));

  const frames = page.frames().map((f) => f.url());
  const child = page.frames().find((f) => f.url().includes('cf.test'));
  let childProbe = null;
  if (child) {
    try {
      childProbe = await child.evaluate(() => {
        const virtual = [...performance.getEntriesByType('resource')].filter((r) =>
          r.name.includes('__speculum/virtual.js'),
        );
        return {
          href: location.href,
          readyState: document.readyState,
          // DOM attrs survive isolated-world evaluate; window flags may not.
          dataConfig: document.documentElement.getAttribute('data-config'),
          dataFulfill: document.documentElement.getAttribute('data-fulfill'),
          dataCf: document.documentElement.getAttribute('data-cf'),
          configWin: typeof window.__SPECULUM_CONFIG_OK__,
          scripts: [...document.scripts].map((sc) => ({
            src: sc.src || null,
            inline: sc.src ? null : (sc.textContent || '').slice(0, 100),
            nonce: sc.nonce || null,
          })),
          virtualPerf: virtual.map((r) => ({
            name: r.name,
            transferSize: r.transferSize,
            encodedBodySize: r.encodedBodySize,
          })),
        };
      });
      const fetchProbe = await child.evaluate(async () => {
        try {
          const r = await fetch('/__speculum/virtual.js');
          const t = await r.text();
          return { status: r.status, ct: r.headers.get('content-type'), body: t.slice(0, 80) };
        } catch (e) {
          return { err: String(e) };
        }
      });
      childProbe.fetchProbe = fetchProbe;
    } catch (e) {
      childProbe = { err: String(e) };
    }
  }

  console.log(
    JSON.stringify(
      {
        siteUrl,
        iframeSrc,
        frames,
        childProbe,
        xoVirtualHits: hits.filter(
          (h) => h.host === 'xo' && String(h.url).includes('__speculum/virtual.js'),
        ),
        pausedVirtual: paused.filter((p) => String(p.url).includes('__speculum/virtual.js')),
        net,
        consoles,
      },
      null,
      2,
    ),
  );

  await browser.close();
  mainSrv.close();
  xo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
