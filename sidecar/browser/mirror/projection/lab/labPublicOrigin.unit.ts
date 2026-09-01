/**
 * Lab ngrok / public-origin helpers — unit tests.
 */

import assert from 'assert';
import {
  labLocalOrigin,
  resolveLabPublicOrigin,
  rewriteVirtualFixtureUrl,
} from './labPublicOrigin';

export async function runLabPublicOriginUnitTests(): Promise<void> {
  const local = labLocalOrigin('127.0.0.1', 4077);
  assert.strictEqual(local, 'http://127.0.0.1:4077');

  const pub = resolveLabPublicOrigin(local, {
    headers: {
      host: 'abc.ngrok-free.app',
      'x-forwarded-host': 'abc.ngrok-free.app',
      'x-forwarded-proto': 'https',
    },
  });
  assert.strictEqual(pub, 'https://abc.ngrok-free.app');

  const fixture = 'https://abc.ngrok-free.app/fixtures/demo.html';
  assert.strictEqual(
    rewriteVirtualFixtureUrl(fixture, pub, local),
    'http://127.0.0.1:4077/fixtures/demo.html',
  );
  assert.strictEqual(
    rewriteVirtualFixtureUrl('https://www.example.com/', pub, local),
    'https://www.example.com/',
  );

  console.log('[unit] labPublicOrigin ok');
}
