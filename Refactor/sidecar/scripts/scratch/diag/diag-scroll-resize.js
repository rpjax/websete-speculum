'use strict';
/**
 * Diagnose applyScrollCensus failure + resize on live PP session (Eneba).
 */
const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

async function main() {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const consoles = [];
  const session = factory.create('diag-scroll-resize', {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: (level, msg) => {
      const t = String(msg);
      consoles.push({ level, t: t.slice(0, 200) });
      if (/input_reject|apply_scroll|error/i.test(t)) console.log('[c]', level, t.slice(0, 200));
    },
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: () => {},
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  await session.launch(
    labLaunchOptions({ width: 638, height: 315, cpuProfiling: false }),
  );
  await session.navigate('https://www.eneba.com');
  await new Promise((r) => setTimeout(r, 8000));

  const census = {
    contexts: [{ contextId: 1, positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }] }],
  };

  console.log('--- applyScrollCensus ---');
  const t0 = Date.now();
  let censusResult;
  try {
    censusResult = await session.measureApplyScrollCensus(census);
  } catch (e) {
    censusResult = { ok: false, error: String(e), ms: Date.now() - t0 };
  }
  console.log(JSON.stringify({ ...censusResult, wallMs: Date.now() - t0 }));

  console.log('--- applyScrollSet ---');
  const t1 = Date.now();
  let setResult;
  try {
    // private — use enqueue path via public if any; fall back to evaluate probe
    setResult = await session.resolveAndScrollViewportDomInput(0, 0, 1);
  } catch (e) {
    setResult = { err: String(e) };
  }
  console.log(JSON.stringify({ setResult, wallMs: Date.now() - t1 }));

  console.log('--- resize 1280x720 ---');
  const t2 = Date.now();
  let resizeResult;
  try {
    resizeResult = await session.resize({ width: 1280, height: 720 });
  } catch (e) {
    resizeResult = { err: String(e), stack: e?.stack?.slice(0, 500) };
  }
  console.log(JSON.stringify({ resizeResult, wallMs: Date.now() - t2 }));

  let probe = null;
  try {
    probe = await session.evaluate(`(() => ({
      href: location.href,
      hasProj: !!globalThis.__speculumProjection,
      vw: window.innerWidth,
      vh: window.innerHeight,
      ready: document.readyState,
    }))()`);
  } catch (e) {
    probe = { err: String(e) };
  }
  console.log('probe', JSON.stringify(probe));
  console.log('rejects', consoles.filter((c) => /reject|scroll/i.test(c.t)));

  await session.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
