import assert from 'assert';
import { matchesAllowedDomain } from './browser/patchright/Navigation';
import { normalizeStartViewport, validateResizeViewport } from './browser/patchright/viewport-bounds';

function testDomainMatch(): void {
  assert.strictEqual(matchesAllowedDomain('example.com', ['example.com']), true);
  assert.strictEqual(matchesAllowedDomain('www.example.com', ['*.example.com']), true);
  assert.strictEqual(matchesAllowedDomain('evil.com', ['example.com']), false);
  assert.strictEqual(matchesAllowedDomain('example.com', ['*.example.com']), false);
  console.log('[unit] domain match ok');
}

function testViewportBounds(): void {
  const start = normalizeStartViewport(0, 0);
  assert.strictEqual(start.width, 1280);
  assert.strictEqual(start.height, 720);

  const ok = validateResizeViewport(800, 600);
  assert.strictEqual(ok.ok, true);

  const tooSmall = validateResizeViewport(10, 10);
  assert.strictEqual(tooSmall.ok, false);

  const tooBig = validateResizeViewport(9000, 9000);
  assert.strictEqual(tooBig.ok, false);
  console.log('[unit] viewport bounds ok');
}

testDomainMatch();
testViewportBounds();
console.log('[unit] all passed');
