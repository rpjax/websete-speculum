import assert from 'assert';
import { matchesAllowedDomain } from './browser/patchright/Navigation';
import { touchEmulationParams } from './browser/patchright/device-emulation';
import { validateLaunchViewport, validateResizeViewport } from './browser/patchright/viewport-bounds';
import { toLaunchOptions } from './grpc/mappers';

function testDomainMatch(): void {
  assert.strictEqual(matchesAllowedDomain('example.com', ['example.com']), true);
  assert.strictEqual(matchesAllowedDomain('www.example.com', ['*.example.com']), true);
  assert.strictEqual(matchesAllowedDomain('evil.com', ['example.com']), false);
  assert.strictEqual(matchesAllowedDomain('example.com', ['*.example.com']), false);
  console.log('[unit] domain match ok');
}

function testViewportBounds(): void {
  const invalidLaunch = validateLaunchViewport(0, 0);
  assert.strictEqual(invalidLaunch.ok, false);

  const validLaunch = validateLaunchViewport(800, 600);
  assert.strictEqual(validLaunch.ok, true);
  if (validLaunch.ok) {
    assert.strictEqual(validLaunch.width, 800);
    assert.strictEqual(validLaunch.height, 600);
  }

  const ok = validateResizeViewport(800, 600);
  assert.strictEqual(ok.ok, true);

  const tooSmall = validateResizeViewport(10, 10);
  assert.strictEqual(tooSmall.ok, false);

  const tooBig = validateResizeViewport(9000, 9000);
  assert.strictEqual(tooBig.ok, false);
  console.log('[unit] viewport bounds ok');
}

function testLaunchEnvironmentIsRequired(): void {
  assert.throws(
    () => toLaunchOptions({ width: 800, height: 600 }),
    /locale is required/,
  );

  const options = toLaunchOptions({
    width: 800,
    height: 600,
    locale: 'pt-BR',
    language: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    geolocation: {
      latitude: -23.55,
      longitude: -46.63,
      accuracy: 10,
    },
  });
  assert.strictEqual(options.locale, 'pt-BR');
  assert.strictEqual(options.geolocation?.accuracy, 10);
  console.log('[unit] launch environment ok');
}

function testTouchEmulationParams(): void {
  assert.deepStrictEqual(
    touchEmulationParams({ touch: false, mobile: false, maxTouchPoints: 0 }),
    { enabled: false },
  );
  assert.deepStrictEqual(
    touchEmulationParams({ touch: true, mobile: false, maxTouchPoints: 5 }),
    { enabled: true, maxTouchPoints: 5 },
  );
  assert.throws(
    () => touchEmulationParams({ touch: true, mobile: false, maxTouchPoints: 0 }),
    /between 1 and 16/,
  );
  console.log('[unit] touch emulation params ok');
}

testDomainMatch();
testViewportBounds();
testLaunchEnvironmentIsRequired();
testTouchEmulationParams();
console.log('[unit] all passed');
