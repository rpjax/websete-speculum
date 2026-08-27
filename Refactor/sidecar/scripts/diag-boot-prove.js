'use strict';
/**
 * Prove lab browse boot: Display+Chrome+navigate, then clean dispose.
 */
const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

async function main() {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  let frames = 0;
  const session = factory.create('diag-boot-prove', {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: () => {},
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: () => {
      frames++;
    },
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  console.log('launch…');
  await session.launch(labLaunchOptions({ width: 638, height: 315, cpuProfiling: false }));
  console.log('navigate…');
  await session.navigate('https://www.eneba.com');
  await new Promise((r) => setTimeout(r, 5000));

  const census = {
    contexts: [{ contextId: 1, positions: [{ nodeId: null, scrollX: 0, scrollY: 0 }] }],
  };
  const t0 = Date.now();
  const scroll = await session.measureApplyScrollCensus(census);
  console.log(
    JSON.stringify({
      boot: 'ok',
      frames,
      scroll,
      scrollWallMs: Date.now() - t0,
    }),
  );

  await session.dispose();
  console.log('disposed');
}

main().catch((e) => {
  console.error('BOOT_FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
