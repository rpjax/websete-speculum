'use strict';
/**
 * Controlled extension-plane establish proof (local HTTP fixture — not Binance).
 * Proves: bind + factory + bilateral isEstablished + applyScrollSet, zero page LNA.
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-extension-plane');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_DIAG_CSP = process.env.SPECULUM_DIAG_CSP || '1';
  fs.mkdirSync(OUT, { recursive: true });

  const pad = 'x'.repeat(50_000);
  const html = `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'">
<title>ext-plane</title></head>
<body><h1 id="title">ext-plane</h1><pre>${pad}</pre>
<script>console.info('[fixture] boot');</script>
</body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const origin = `http://127.0.0.1:${addr.port}`;

  const consoleLines = [];
  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  chassis.setConsoleRelay((ev) => {
    consoleLines.push({ t: ev.t, level: ev.level, text: String(ev.text) });
  });

  const report = { url: origin, phases: [] };
  try {
    await chassis.boot({
      mode: 'browse',
      url: origin,
      frameRateHz: 10,
      blueprintId: 'diag-extension-plane',
      slug: 'diag-extension-plane',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });
    const session = chassis.browser;
    if (!session) throw new Error('no session');

    await wait(2000);
    const loopback =
      typeof session.probeLoopbackStatus === 'function'
        ? await session.probeLoopbackStatus()
        : null;

    const cdp = session.cdpSession;
    const ev = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const cfg = globalThis.__SPECULUM_PROJECTION__;
        const rt = globalThis.__speculumProjection;
        const ft = rt && rt.frameTransport;
        return {
          loopbackCarrier: cfg?.loopbackCarrier ?? null,
          hasToken: !!(cfg && cfg.planeBridgeToken),
          hasFactory: typeof globalThis.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__ === 'function',
          hasRuntime: !!rt,
          virtualEstablished: ft ? ft.isEstablished === true : null,
          title: document.getElementById('title')?.textContent ?? null,
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const probe = ev.result?.value ?? ev.result;

    const plane = await session.measureApplyScrollSet({
      contextId: 1,
      nodeId: null,
      scrollX: 0,
      scrollY: 8,
    });

    const planeDiag = consoleLines.filter((l) => /speculum-plane-diag/i.test(l.text));
    const lna = consoleLines.filter((l) =>
      /ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS/i.test(l.text),
    );
    const pageWs = consoleLines.filter((l) =>
      /WebSocket connection to 'ws:\/\/127\.0\.0\.1/i.test(l.text),
    );

    const nodeEst = loopback?.nodeEstablished === true;
    const virtualEst = loopback?.virtualEstablished === true || probe?.virtualEstablished === true;
    const ok =
      nodeEst &&
      virtualEst &&
      plane?.ok === true &&
      probe?.loopbackCarrier === 'extension' &&
      probe?.hasFactory === true &&
      lna.length === 0;

    report.verdict = ok ? 'PASS' : 'FAIL';
    report.summary = {
      nodeEstablished: nodeEst,
      virtualEstablished: virtualEst,
      planeOk: plane?.ok === true,
      planeError: plane?.error ?? null,
      probe,
      loopback,
      lnaCount: lna.length,
      pageWsConsoleCount: pageWs.length,
      planeDiag: planeDiag.map((l) => l.text.slice(0, 200)),
      consoleTail: consoleLines.slice(-30).map((l) => l.text.slice(0, 200)),
    };
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    report.verdict = 'ERROR';
    report.consoleTail = consoleLines.slice(-30).map((l) => l.text.slice(0, 200));
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await new Promise((resolve) => server.close(() => resolve()));
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary ?? report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
