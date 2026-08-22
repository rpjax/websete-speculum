const { createPageProjectionBrowserSessionFactory } = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { v4LabLaunchOptions } = require('../dist/browser/mirror/projection/session/v4LabLaunch');

function events() {
  return {
    onVideoFrame() {},
    onAudioFrame() {},
    onPageProjectionFrame() {},
    onConsole() {},
    onLocationChanged() {},
    onMainFrameNavigationBlocked() {},
    onEditableFocusChanged() {},
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
    onCrash() {},
  };
}

(async () => {
  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('debug1', events());
  await session.launch(v4LabLaunchOptions({ frameRateHz: 30 }));
  await session.navigate('http://127.0.0.1:4098/fixtures/demo.html');
  await new Promise((r) => setTimeout(r, 1500));
  const before = await session.evaluate(`({
    hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
    generation: globalThis.__speculumProjection ? globalThis.__speculumProjection.domNodes.generation : -1,
  })`);
  console.log('before navigate', before);

  await session.navigate('http://127.0.0.1:4098/fixtures/static-dom.html');
  await new Promise((r) => setTimeout(r, 1500));
  const after = await session.evaluate(`({
    hasProjection: typeof globalThis.__speculumProjection !== 'undefined',
    generation: globalThis.__speculumProjection ? globalThis.__speculumProjection.domNodes.generation : -1,
    title: document.title,
  })`);
  console.log('after navigate', after);
  await session.dispose();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
