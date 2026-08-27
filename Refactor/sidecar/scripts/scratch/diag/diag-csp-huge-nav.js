'use strict';
/**
 * Prove: huge Document + header-only CSP → current hook may skip surgery (silent catch).
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

function html(title, next, padBytes) {
  const pad = 'x'.repeat(padBytes);
  const link = next ? `<a id="go" href="${next}">go</a>` : `<span id="landed">ok</span>`;
  // HEADER-ONLY CSP (no meta) — mirrors sites that enforce solely via HTTP header.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1 id="title">${title}</h1>${link}<pre>${pad}</pre></body></html>`;
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  fs.mkdirSync(OUT, { recursive: true });

  const pad = Number(process.env.HUGE_PAD || 4_500_000);
  const server = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': STRICT,
      'Cache-Control': 'no-store',
    };
    if (p === '/a') {
      res.writeHead(200, headers);
      res.end(html('A', '/b', pad));
      return;
    }
    if (p === '/b') {
      res.writeHead(200, headers);
      res.end(html('B', null, pad));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  const consoleLines = [];
  chassis.setConsoleRelay((ev) => consoleLines.push(ev));
  const report = { pad, phases: [] };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${origin}/a`,
      frameRateHz: 10,
      blueprintId: 'diag-csp-huge',
      slug: 'diag-csp-huge',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });
    await wait(1200);
    const session = chassis.browser;

    async function probe(label) {
      const title = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
      const wsProbe = await session.evaluate(`(() => {
        try {
          const u = (globalThis.__speculumProjection && false) || null;
          // Try a throwaway WS to same origin pattern as data plane (loopback).
          return new Promise((resolve) => {
            const cfg = document.documentElement.innerHTML.includes('dataPlaneUrl');
            let settled = false;
            const done = (v) => { if (!settled) { settled = true; resolve(v); } };
            try {
              // Read data plane URL from injected config if present
              const m = document.documentElement.innerHTML.match(/"dataPlaneUrl"\\s*:\\s*"([^"]+)"/);
              const url = m ? m[1].replace(/\\\\\\//g, '/') : null;
              if (!url) return done({ ok: false, reason: 'no_dataPlaneUrl_in_dom' });
              const ws = new WebSocket(url);
              const t = setTimeout(() => { try { ws.close(); } catch {} done({ ok: false, reason: 'timeout' }); }, 3000);
              ws.addEventListener('open', () => { clearTimeout(t); ws.close(); done({ ok: true, url }); });
              ws.addEventListener('error', () => { clearTimeout(t); done({ ok: false, reason: 'error', url }); });
            } catch (e) {
              done({ ok: false, reason: String(e && e.message || e) });
            }
          });
        } catch (e) {
          return { ok: false, reason: String(e && e.message || e) };
        }
      })()`);
      const plane = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 1,
      });
      const cspHits = consoleLines
        .filter((l) => /Content Security Policy|ws:\/\/127\\.0\\.0\\.1/i.test(l.text))
        .map((l) => l.text.slice(0, 180));
      return {
        label,
        title: title.value,
        wsProbe: wsProbe.value ?? wsProbe,
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
    await new Promise((r) => server.close(r));
  }

  const after = report.phases.find((p) => p.label === 'after-nav-b');
  report.verdict =
    after && after.plane && after.plane.ok && after.title === 'B' ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
