/**
 * B4 A/B — same session, static iframe (A) vs JS-inserted after load (B).
 * Decides: config-gate race vs content-script inject failure on cross-port frame.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const {
  createCrossOriginFixtureServer,
  labConfigJson,
} = require('../dist/browser/mirror/projection/lab/crossOriginFixtureServer');
const { pipeFixtureFile } = require('../dist/browser/mirror/projection/lab/fixtureServe');
const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

const WAIT_MS = 9000;

function parseJson(raw) {
  if (raw == null || raw === 'null' || raw === 'none') return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return raw;
  }
}

async function probeVariant(session, label, consoleBuf) {
  const nestedOutcomeRaw = await session.evaluateVirtualExpression?.(
    'JSON.stringify(globalThis.__speculumBootOutcome ?? null)',
    2,
  );
  const nestedCtx = await session.evaluateVirtualExpression?.(
    'String(globalThis.__speculumProjection?.contextId ?? "none")',
    2,
  );
  const click = await session.resolveAndClickDomInputByNodeId?.('#inner-click', 2);
  const nestedOutcome = parseJson(nestedOutcomeRaw);
  const bootEstablished = nestedOutcome?.ok === true && nestedOutcome?.reason === 'established';
  const contextUp = nestedCtx != null && nestedCtx !== 'none' && nestedCtx !== 'null';
  const lines4078 = consoleBuf.filter(
    (t) => /4078|input-xo\/inner/i.test(t) || /boot_established|scope_admitted|deliverable_miss|speculum-context/i.test(t),
  );
  const first4078 = consoleBuf.find((t) => /4078|input-xo\/inner/i.test(t)) ?? null;
  return {
    label,
    nestedBootEstablished: bootEstablished,
    nestedContextId: nestedCtx,
    nestedBootOutcome: nestedOutcome,
    resolveAndClick: click,
    deliverable: click?.status === 'enqueued',
    firstConsole4078: first4078,
    contextConsoleLines: lines4078.slice(-12),
  };
}

async function runVariant(chassis, baseUrl, fixture, consoleBuf, opts = {}) {
  consoleBuf.length = 0;
  const url = `${baseUrl}/fixtures/${fixture}`;
  console.log(`\n[lab-xo-ab-b4] === ${fixture} ===`);
  if (!opts.skipNavigate) {
    console.log('[lab-xo-ab-b4] navigate', url);
    await chassis.navigate(url);
  } else {
    console.log('[lab-xo-ab-b4] skip navigate (already on page)');
  }
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const session = chassis.browser;
  if (!session) throw new Error('no session');
  const st = await session.evaluate("document.getElementById('state')?.textContent ?? ''");
  const src = await session.evaluate("document.getElementById('xo-child')?.getAttribute('src') ?? ''");
  console.log('[lab-xo-ab-b4] page state', st.value, 'iframeSrc', src.value);
  return probeVariant(session, fixture, consoleBuf);
}

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const { fixturesDir } = labAssetRoots();
  let xo = null;
  let xoOrigin = 'http://127.0.0.1:4078';
  try {
    xo = await createCrossOriginFixtureServer('127.0.0.1');
    xoOrigin = xo.origin;
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.log('[lab-xo-ab-b4] reusing existing XO server at', xoOrigin);
    } else {
      throw err;
    }
  }
  const srv = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    const pathname = urlPath.split('?')[0];
    if (pathname === '/lab/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(labConfigJson(xoOrigin)));
      return;
    }
    if (!urlPath.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    pipeFixtureFile(res, path.join(fixturesDir, decodeURIComponent(urlPath.slice('/fixtures/'.length))));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  console.log('[lab-xo-ab-b4] fixture host', baseUrl, 'xo', xoOrigin);

  const consoleBuf = [];
  const chassis = new LabChassis({ headless: true });
  chassis.setConsoleRelay((ev) => {
    if (ev?.text) consoleBuf.push(ev.text);
  });

  try {
    await chassis.boot({
      mode: 'run',
      url: `${baseUrl}/fixtures/input-iframe-xo.html`,
      frameRateHz: 30,
      telemetry: { enabled: true, diagBoot: true },
    });

    const resultA = await runVariant(chassis, baseUrl, 'input-iframe-xo.html', consoleBuf, {
      skipNavigate: true,
    });
    const resultB = await runVariant(chassis, baseUrl, 'input-iframe-xo-dynamic.html', consoleBuf);

    const verdict =
      resultB.nestedBootEstablished && !resultA.nestedBootEstablished
        ? 'B4_RACE_CONFIRMED'
        : resultB.nestedBootEstablished && resultA.nestedBootEstablished
          ? 'BOTH_UP'
          : !resultB.nestedBootEstablished && !resultA.nestedBootEstablished
            ? 'BOTH_DOWN_INJECT_SUSPECT'
            : 'A_UP_B_DOWN_UNEXPECTED';

    const summary = { verdict, A: resultA, B: resultB, xoOrigin };
    console.log('\n[lab-xo-ab-b4] RESULT', JSON.stringify(summary, null, 2));

    const outPath = path.join(__dirname, '..', 'lab-runs', 'xo-ab-b4-last.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log('[lab-xo-ab-b4] wrote', outPath);
  } finally {
    await chassis.dispose().catch(() => undefined);
    await xo?.close().catch(() => undefined);
    await new Promise((r) => srv.close(r));
  }
}

main().catch((e) => {
  console.error('[lab-xo-ab-b4] fatal', e);
  process.exit(1);
});
