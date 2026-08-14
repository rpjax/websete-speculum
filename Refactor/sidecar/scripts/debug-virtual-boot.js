const { launchVirtualBrowser } = require('../dist/browser/mirror/projection/lab/virtualBrowser');

(async () => {
  const handle = await launchVirtualBrowser({
    dataPlaneUrl: 'ws://127.0.0.1:4098/lab/virtual/debug1',
    startUrl: 'http://127.0.0.1:4098/fixtures/demo.html',
    headless: true,
    frameRateHz: 30,
    telemetry: { enabled: true, frameEmitted: true },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const before = await handle.page.evaluate(() => ({
    hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
    generation: globalThis.__speculumProjection ? globalThis.__speculumProjection.domNodes.generation : -1,
    config: globalThis.__SPECULUM_PROJECTION__,
  }));
  console.log('before navigate', before);

  await handle.navigate('http://127.0.0.1:4098/fixtures/static-dom.html');
  await new Promise((r) => setTimeout(r, 1500));
  const after = await handle.page.evaluate(() => ({
    hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
    generation: globalThis.__speculumProjection ? globalThis.__speculumProjection.domNodes.generation : -1,
    config: globalThis.__SPECULUM_PROJECTION__,
    title: document.title,
  }));
  console.log('after navigate', after);

  await handle.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
