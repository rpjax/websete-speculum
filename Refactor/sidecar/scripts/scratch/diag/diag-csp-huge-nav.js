'use strict';
/**
 * Prove: huge Document + strict CSP keeps loopback data plane open after fix.
 * - header-only CSP (HTTP header, no meta)
 * - meta-only CSP (meta http-equiv, no header) — Binance-class
 *
 * Docker: node scripts/scratch/diag/diag-csp-huge-nav.js
 */
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-csp-huge-nav');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const STRICT =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.binance.com; img-src 'self' https:";

function htmlHeaderOnly(title, next, padBytes) {
  const pad = 'x'.repeat(padBytes);
  const link = next ? `<a id="go" href="${next}">go</a>` : `<span id="landed">ok</span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1 id="title">${title}</h1>${link}<pre>${pad}</pre></body></html>`;
}

function htmlMetaOnly(title, next, padBytes) {
  const pad = 'x'.repeat(padBytes);
  const link = next ? `<a id="go" href="${next}">go</a>` : `<span id="landed">ok</span>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STRICT}">
<title>${title}</title></head>
<body><h1 id="title">${title}</h1>${link}<pre>${pad}</pre></body></html>`;
}

async function runScenario({ LabChassis, pad, origin, slug, outSubdir }) {
  const outDir = path.join(OUT, outSubdir);
  fs.mkdirSync(outDir, { recursive: true });
  const chassis = new LabChassis({ headless: false, outDir });
  const consoleLines = [];
  chassis.setConsoleRelay((ev) => consoleLines.push(ev));
  const report = { slug, pad, phases: [] };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${origin}/a`,
      frameRateHz: 10,
      blueprintId: `diag-csp-huge-${slug}`,
      slug: `diag-csp-huge-${slug}`,
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });
    await wait(1200);
    const session = chassis.browser;

    async function probe(label) {
      const title = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
      const plane = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 1,
      });
      const cspHits = consoleLines
        .filter((l) => /Content Security Policy|ws:\/\/127\.0\.0\.1/i.test(l.text))
        .map((l) => l.text.slice(0, 180));
      return {
        label,
        title: title.value,
        plane,
        cspHits: cspHits.slice(0, 5),
      };
    }

    report.phases.push(await probe('cold-a'));
    consoleLines.length = 0;
    await session.evaluate(`document.getElementById('go').click()`);
    await wait(2500);
    report.phases.push(await probe('after-nav-b'));
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
  }

  const after = report.phases.find((p) => p.label === 'after-nav-b');
  report.verdict =
    after && after.plane && after.plane.ok && after.title === 'B' ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  fs.mkdirSync(OUT, { recursive: true });

  const pad = Number(process.env.HUGE_PAD || 4_500_000);
  const only = String(process.env.DIAG_CSP_MODE || 'both').toLowerCase();

  const server = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    const baseHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    if (p === '/header/a') {
      res.writeHead(200, { ...baseHeaders, 'Content-Security-Policy': STRICT });
      res.end(htmlHeaderOnly('A', '/header/b', pad));
      return;
    }
    if (p === '/header/b') {
      res.writeHead(200, { ...baseHeaders, 'Content-Security-Policy': STRICT });
      res.end(htmlHeaderOnly('B', null, pad));
      return;
    }
    if (p === '/meta/a') {
      res.writeHead(200, baseHeaders);
      res.end(htmlMetaOnly('A', '/meta/b', pad));
      return;
    }
    if (p === '/meta/b') {
      res.writeHead(200, baseHeaders);
      res.end(htmlMetaOnly('B', null, pad));
      return;
    }
    // Legacy paths
    if (p === '/a') {
      res.writeHead(200, { ...baseHeaders, 'Content-Security-Policy': STRICT });
      res.end(htmlHeaderOnly('A', '/b', pad));
      return;
    }
    if (p === '/b') {
      res.writeHead(200, { ...baseHeaders, 'Content-Security-Policy': STRICT });
      res.end(htmlHeaderOnly('B', null, pad));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const results = {};

  try {
    if (only === 'both' || only === 'header') {
      results.header = await runScenario({
        LabChassis,
        pad,
        origin: `${origin}/header`,
        slug: 'header',
        outSubdir: 'header-only',
      });
    }
    if (only === 'both' || only === 'meta') {
      results.meta = await runScenario({
        LabChassis,
        pad,
        origin: `${origin}/meta`,
        slug: 'meta',
        outSubdir: 'meta-only',
      });
    }
  } finally {
    await new Promise((r) => server.close(r));
  }

  const summary = {
    pad,
    mode: only,
    results,
    verdict:
      Object.values(results).every((r) => r.verdict === 'PASS') && Object.keys(results).length > 0
        ? 'PASS'
        : 'FAIL',
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
