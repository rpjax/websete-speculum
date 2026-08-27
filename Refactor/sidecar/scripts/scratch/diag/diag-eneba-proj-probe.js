'use strict';
/**
 * Probe whether Virtual producer is alive on Eneba + applyScrollCensus.
 */
const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

async function main() {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const session = factory.create('diag-eneba-proj', {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: (level, msg) => {
      const t = String(msg);
      if (/MIME|virtual\.js|Refused|CSP|input_reject|apply_scroll|Speculum|producer/i.test(t)) {
        console.log('[c]', level, t.slice(0, 300));
      }
    },
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: (f) => {
      if (!globalThis.__diagFrames) globalThis.__diagFrames = 0;
      globalThis.__diagFrames++;
      if (globalThis.__diagFrames <= 3) console.log('[frame]', globalThis.__diagFrames, f?.byteLength ?? '?');
    },
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  await session.launch(labLaunchOptions({ width: 638, height: 315, cpuProfiling: false }));
  await session.navigate('https://www.eneba.com');
  await new Promise((r) => setTimeout(r, 10000));

  const probe = await session.evaluate(`(() => {
    const scripts = [...document.scripts]
      .map((s) => ({ src: s.src, type: s.type }))
      .filter((s) => /speculum|virtual/i.test(s.src || ''));
    return {
      href: location.href,
      hasProj: !!globalThis.__speculumProjection,
      keys: Object.keys(globalThis).filter((k) => /speculum/i.test(k)),
      scripts,
      ready: document.readyState,
      vw: innerWidth,
      vh: innerHeight,
    };
  })()`);
  console.log('probe', JSON.stringify(probe, null, 2));

  const census = {
    contexts: [{ contextId: 1, positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }] }],
  };
  const t0 = Date.now();
  const r = await session.measureApplyScrollCensus(census);
  console.log('census', JSON.stringify({ ...r, wallMs: Date.now() - t0 }));

  try {
    await session.dispose();
  } catch {
    /* */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
