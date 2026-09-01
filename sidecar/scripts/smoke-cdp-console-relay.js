/**
 * Assert CDP console relay on PageProjectionBrowserSession.
 * From sidecar/: node scripts/smoke-cdp-console-relay.js
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const consoles = [];
  const factory = createPageProjectionBrowserSessionFactory({ headless: true });
  const session = factory.create('smoke-cdp-console', {
    onConsole: (level, text) => consoles.push({ level, text }),
    onCrash: () => undefined,
    onLocationChanged: () => undefined,
    onPageProjectionFrame: () => undefined,
    onPageProjectionTelemetry: () => undefined,
  });

  const fixture = pathToFileURL(
    path.join(__dirname, '../browser/mirror/projection/lab/fixtures/input-click.html'),
  ).href;

  await session.launch({
    mirrorMode: 'pageProjection',
    projectionDataPlane: 'loopback',
    width: 640,
    height: 360,
    viewportPolicy: { minWidth: 320, minHeight: 240, maxWidth: 1280, maxHeight: 720 },
    locale: 'en-US',
    language: 'en-US',
    timeZoneId: 'UTC',
    colorScheme: 'light',
    device: null,
  });
  await session.navigate(fixture);
  await new Promise((r) => setTimeout(r, 400));

  await session.evaluate(`(() => {
    console.log('smoke-log', 1);
    console.warn('smoke-warn', JSON.stringify({ ok: true }));
    console.error('smoke-error');
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  await session.stop();

  const hasLog = consoles.some((c) => c.text.includes('smoke-log') && c.text.includes('1'));
  const hasWarn = consoles.some(
    (c) => c.level === 2 && c.text.includes('smoke-warn') && c.text.includes('{"ok":true}'),
  );
  const hasErr = consoles.some((c) => c.level === 3 && c.text.includes('smoke-error'));

  console.log(JSON.stringify({ consoles: consoles.slice(-8), hasLog, hasWarn, hasErr }, null, 2));
  if (!hasLog || !hasWarn || !hasErr) {
    console.error('SMOKE FAIL — CDP console relay incomplete');
    process.exit(1);
  }
  console.log('SMOKE OK — CDP console relay');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
