'use strict';
/**
 * Repro: after in-page location change under strict connect-src, data plane must reopen.
 * Mimics Binance locale popup → BR page (Document nav with enforcing CSP).
 *
 * Docker (stop the interactive lab first — one Chrome on :99):
 *   docker compose -f docker-compose.lab.yml stop lab
 *   docker compose -f docker-compose.lab.yml run --rm --no-deps \
 *     -v "$PWD/scripts:/app/scripts" -v "$PWD/lab-runs:/app/lab-runs" \
 *     lab node scripts/scratch/diag/diag-csp-nav-plane.js
 */
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-csp-nav-plane');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Binance-shaped connect-src — allowlist without * / ws: (surgery must widen). */
const STRICT_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://bin.bnbstatic.com https://accounts.google.com; " +
  "connect-src 'self' https://*.binance.com https://accounts.google.com wss://stream.binance.com; " +
  "img-src 'self' https: data: blob:";

function pageHtml(title, nextHref) {
  const link = nextHref
    ? `<p><a id="go-br" href="${nextHref}">Go BR</a></p>`
    : `<p id="landed">landed</p>`;
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}">
<title>${title}</title>
</head><body>
<h1 id="title">${title}</h1>
${link}
<div id="scroll-box" style="height:200px;overflow:auto"><div style="height:800px">pad</div></div>
</body></html>`;
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': STRICT_CSP,
      'Cache-Control': 'no-store',
    };
    if (pathname === '/' || pathname === '/en') {
      res.writeHead(200, headers);
      res.end(pageHtml('EN', '/br'));
      return;
    }
    if (pathname === '/br') {
      res.writeHead(200, headers);
      res.end(pageHtml('BR', null));
      return;
    }
    if (pathname === '/br-xo') {
      res.writeHead(200, headers);
      res.end(pageHtml('BR-XO', null));
      return;
    }
    res.writeHead(404).end('missing');
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  const port = server.address().port;
  return {
    port,
    originLoopback: `http://127.0.0.1:${port}`,
    originLocalhost: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitPlane(session, timeoutMs = 15_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await session.measureApplyScrollSet({
      contextId: 1,
      nodeId: null,
      scrollX: 0,
      scrollY: 1,
    });
    last = r;
    if (r && r.ok) return { ok: true, ms: Date.now() - t0, last };
    const reason = r?.error ?? r?.reason ?? JSON.stringify(r);
    if (reason && !/data plane not open|not_open/i.test(String(reason))) {
      return { ok: true, ms: Date.now() - t0, last, note: reason };
    }
    await wait(100);
  }
  return { ok: false, ms: Date.now() - t0, last };
}

async function readCspMeta(session) {
  return session.evaluate(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`,
  );
}

function assertConnectWidened(content, label) {
  const text = typeof content === 'string' ? content : '';
  const ok = /\bconnect-src\b[^;]*\*/.test(text) || /\bconnect-src\b[^;]*\bws:/.test(text);
  return {
    label,
    ok,
    hasStar: /\bconnect-src\b[^;]*\*/.test(text),
    hasWs: /\bconnect-src\b[^;]*\bws:/.test(text),
    snippet: text.slice(0, 280),
  };
}

async function main() {
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  fs.mkdirSync(OUT, { recursive: true });

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));

  const srv = await startServer();
  const consoleLines = [];
  const chassis = new LabChassis({
    headless: false,
    outDir: OUT,
  });
  chassis.setConsoleRelay((ev) => {
    consoleLines.push({ level: ev.level, text: ev.text, t: Date.now() });
  });
  const report = { phases: [] };

  try {
    await chassis.boot({
      mode: 'run',
      url: `${srv.originLoopback}/en`,
      frameRateHz: 10,
      blueprintId: 'diag-csp-nav',
      slug: 'diag-csp-nav',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });
    await wait(1000);
    const session = chassis.browser;
    if (!session) throw new Error('no session');

    // --- Phase A: cold /en ---
    const coldMeta = await readCspMeta(session);
    const coldCsp = assertConnectWidened(coldMeta.value ?? '', 'cold-meta');
    const coldPlane = await waitPlane(session);
    report.phases.push({ name: 'cold-/en', csp: coldCsp, plane: coldPlane, metaOk: coldMeta.ok });

    // --- Phase B: in-page click → /br ---
    consoleLines.length = 0;
    const click = await session.evaluate(`(() => {
      const a = document.getElementById('go-br');
      if (!a) throw new Error('missing #go-br');
      a.click();
      return 'clicked';
    })()`);
    await wait(1800);
    const titleBr = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
    const brMeta = await readCspMeta(session);
    const brCsp = assertConnectWidened(brMeta.value ?? '', 'post-nav-meta');
    const brPlane = await waitPlane(session);
    report.phases.push({
      name: 'in-page-/br',
      click,
      title: titleBr.value,
      url: chassis.sessionRecord?.url,
      csp: brCsp,
      plane: brPlane,
      cspViolations: consoleLines
        .filter((l) => /Content Security Policy|ws:\/\/127\.0\.0\.1|data plane not open/i.test(l.text))
        .slice(0, 10),
    });

    // --- Phase C: cross-site 127.0.0.1 → localhost (in-page; no session.navigate) ---
    consoleLines.length = 0;
    // Return to /en first via in-page assign (same Document hook path as user click).
    await session.evaluate(`location.href = ${JSON.stringify(`${srv.originLoopback}/en`)}`);
    await wait(1500);
    const midTitle = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
    const xoHref = `${srv.originLocalhost}/br-xo`;
    await session.evaluate(`location.href = ${JSON.stringify(xoHref)}`);
    await wait(2500);
    const xoTitle = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
    const xoMeta = await readCspMeta(session);
    const xoCsp = assertConnectWidened(xoMeta.value ?? '', 'xo-meta');
    const xoPlane = await waitPlane(session);
    report.phases.push({
      name: 'cross-site-localhost',
      midTitle: midTitle.value,
      title: xoTitle.value,
      href: xoHref,
      csp: xoCsp,
      plane: xoPlane,
      cspViolations: consoleLines
        .filter((l) => /Content Security Policy|ws:\/\/127\.0\.0\.1/i.test(l.text))
        .slice(0, 10),
    });

    // --- Phase D: target=_blank ---
    await session.evaluate(`location.href = ${JSON.stringify(`${srv.originLoopback}/en`)}`);
    await wait(1500);
    consoleLines.length = 0;
    await session.evaluate(`(() => {
      const a = document.createElement('a');
      a.id = 'go-blank';
      a.target = '_blank';
      a.rel = 'noopener';
      a.href = '/br';
      a.textContent = 'blank';
      document.body.appendChild(a);
      a.click();
      return 'blank-clicked';
    })()`);
    await wait(2500);
    const blankTitle = await session.evaluate(`document.getElementById('title')?.textContent ?? ''`);
    const blankMeta = await readCspMeta(session);
    const blankCsp = assertConnectWidened(blankMeta.value ?? '', 'blank-primary-meta');
    const blankPlane = await waitPlane(session, 5_000);
    report.phases.push({
      name: 'target-blank',
      title: blankTitle.value,
      csp: blankCsp,
      plane: blankPlane,
      cspViolations: consoleLines
        .filter((l) => /Content Security Policy|ws:\/\/127\.0\.0\.1/i.test(l.text))
        .slice(0, 10),
      note: 'Expect BR on primary only if single-tab rewrite exists',
    });
  } catch (err) {
    report.error = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    await srv.close();
  }

  const failing = report.phases.filter((p) => {
    if (p.csp && !p.csp.ok) return true;
    if (p.plane && !p.plane.ok) return true;
    if (p.name === 'in-page-/br' && p.title !== 'BR') return true;
    if (p.name === 'cross-site-localhost' && p.title !== 'BR-XO') return true;
    return false;
  });
  report.verdict = failing.length === 0 ? 'PASS' : 'FAIL';
  report.failing = failing.map((p) => p.name);

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
