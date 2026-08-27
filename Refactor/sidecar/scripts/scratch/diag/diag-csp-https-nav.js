'use strict';
/**
 * HTTPS page + strict connect-src + in-page nav — mirrors Binance (https origin + loopback WS).
 * Docker: node scripts/scratch/diag/diag-csp-https-nav.js
 */
const path = require('node:path');
const https = require('node:https');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-csp-https-nav');
const CERT_DIR = path.join(OUT, 'certs');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const STRICT =
  "default-src 'self'; script-src 'self' 'unsafe-inline' *; connect-src 'self' https://*.binance.com wss://stream.binance.com; img-src 'self' https: data:";

function ensureCerts() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync(
      'openssl',
      [
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
      ],
      { stdio: 'ignore' },
    );
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function page(title, next) {
  const link = next ? `<a id="go" href="${next}">go</a>` : `<span id="landed">ok</span>`;
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STRICT}">
<title>${title}</title></head>
<body><h1 id="title">${title}</h1>${link}</body></html>`;
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  fs.mkdirSync(OUT, { recursive: true });
  const tls = ensureCerts();

  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `https://127.0.0.1:${port}`;

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  const consoleLines = [];
  chassis.setConsoleRelay((ev) => consoleLines.push(ev));
  const report = { origin, phases: [] };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${origin}/en`,
      frameRateHz: 10,
      blueprintId: 'diag-csp-https',
      slug: 'diag-csp-https',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });
    await wait(1500);
    const session = chassis.browser;

    async function probe(label) {
      const title = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
      const meta = await session.evaluate(
        `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`,
      );
      const plane = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 1,
      });
      const hits = consoleLines
        .filter((l) =>
          /Content Security Policy|Mixed Content|ws:\/\/127\.0\.0\.1|data plane not open|data plane open failed/i.test(
            l.text,
          ),
        )
        .map((l) => l.text.slice(0, 240));
      return {
        label,
        title: title.value,
        metaWidened: /\bconnect-src\b[^;]*(\*|ws:)/.test(meta.value ?? ''),
        metaSnippet: (meta.value ?? '').slice(0, 200),
        plane,
        hits: hits.slice(0, 8),
      };
    }

    report.phases.push(await probe('cold-https-en'));
    consoleLines.length = 0;
    await session.evaluate(`document.getElementById('go').click()`);
    await wait(2500);
    report.phases.push(await probe('after-nav-br'));
  } catch (err) {
    report.error = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await new Promise((r) => server.close(r));
  }

  const failing = report.phases.filter((p) => !p.plane?.ok || !p.metaWidened);
  report.verdict = report.error || failing.length ? 'FAIL' : 'PASS';
  report.failing = failing.map((p) => p.label);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
