/**
 * Assertive: iframe-anim depth-2 must keep MAIN responsive and nested producers live.
 *   node scripts/assert-iframe-nested-boot.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

function contentType(file) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/html; charset=utf-8';
}
function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}:${ms}`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const raw = req.url ?? '/';
    if (!raw.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const rel = decodeURIComponent(raw.split('?')[0].slice('/fixtures/'.length));
    const file = path.join(fixturesDir, rel);
    if (!fs.existsSync(file) || !file.startsWith(fixturesDir)) {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/fixtures/iframe-anim.html`;

  const chassis = new LabChassis({ headless: true });
  try {
    await withTimeout(
      chassis.boot({
        mode: 'browse',
        url,
        frameRateHz: 60,
        telemetry: { enabled: true, frameEmitted: true, applyResult: true, aggregate: true },
      }),
      25_000,
      'boot',
    );
    await new Promise((r) => setTimeout(r, 4000));

    const cdpPing = await withTimeout(
      chassis.session.cdpSession.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }),
      2_000,
      'cdpPing',
    ).then((r) => r.result?.value);

    const snap = await withTimeout(
      chassis.session.cdpSession.send('Runtime.evaluate', {
        expression: `(() => {
          const peek = (w) => w ? {
            outcome: w.__speculumBootOutcome || null,
            hasProj: !!w.__speculumProjection,
            ctx: w.__speculumProjection?.contextId ?? null,
          } : null;
          const left = document.querySelector('#left')?.contentWindow;
          const right = document.querySelector('#right')?.contentWindow;
          let nested = null;
          try { nested = right?.document?.querySelector('iframe')?.contentWindow; } catch (_) {}
          return {
            root: peek(window),
            left: peek(left),
            right: peek(right),
            nested: peek(nested),
            accepts: globalThis.__speculumPortSetupAccepts||0,
            replaces: globalThis.__speculumPortSetupReplaces||0,
          };
        })()`,
        returnByValue: true,
      }),
      3_000,
      'snap',
    ).then((r) => r.result?.value);

    let invoke = null;
    for (let i = 0; i < 3; i++) {
      try {
        invoke = await withTimeout(
          chassis.session.dataPlane.invoke('keyOfSelector', { selector: 'html', contextId: 1 }),
          5_000,
          'invoke',
        );
        if (invoke?.ok === true) break;
      } catch (e) {
        invoke = { ok: false, error: String(e.message || e) };
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const need = ['left', 'right', 'nested'];
    const dead = need.filter((k) => !(snap && snap[k] && snap[k].hasProj === true && snap[k].outcome?.reason === 'established'));
    const report = {
      verdict: cdpPing === 2 && invoke?.ok === true && dead.length === 0 ? 'PASS' : 'FAIL',
      reason:
        cdpPing !== 2
          ? 'main_thread_wedged'
          : invoke?.ok !== true
            ? 'invoke_dead'
            : dead.length
              ? 'nested_producer_missing'
              : 'ok',
      cdpPing,
      invokeOk: invoke?.ok === true,
      dead,
      snap,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.verdict === 'PASS' ? 0 : 1;
  } finally {
    try {
      await withTimeout(chassis.disposeVirtual(), 4_000, 'dv').catch(() => {});
    } catch (_) {}
    try {
      await withTimeout(chassis.dispose(), 4_000, 'd').catch(() => {});
    } catch (_) {}
    await new Promise((r) => server.close(r));
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ verdict: 'FAIL', reason: 'throw', message: String(e && e.stack ? e.stack : e) }));
  process.exit(1);
});

