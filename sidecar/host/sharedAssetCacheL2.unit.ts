import assert from 'node:assert';
import {
  SharedAssetCacheL2,
  type SharedAssetShareabilityDescriptor,
} from './SharedAssetCacheL2';

function cache(maxBytes = 1024, enabled = true): SharedAssetCacheL2 {
  const tier = new SharedAssetCacheL2();
  tier.configureOnce({ maxBytes, enabled });
  return tier;
}

export function runSharedAssetCacheL2UnitTests(): void {
  const tier = cache();
  assert.strictEqual(tier.tryAcquire('missing'), null);

  const written = tier.put('k1', Buffer.from([1, 2, 3]), 'text/css');
  const read = tier.tryAcquire('k1');
  assert.ok(read);
  assert.strictEqual(read!.body, written.body);
  assert.strictEqual(read!.contentType, 'text/css');
  written.release();
  read!.release();

  const first = tier.put('k1', Buffer.from([1, 2, 3]), 'text/css');
  const second = tier.put('k1', Buffer.from([9, 9, 9]), 'text/css');
  assert.strictEqual(first.body, second.body);
  assert.strictEqual(tier.count, 1);
  first.release();
  second.release();

  const evict = cache(10);
  evict.put('a', Buffer.from([1, 1, 1, 1]), 'application/octet-stream').release();
  evict.put('b', Buffer.from([2, 2, 2, 2]), 'application/octet-stream').release();
  evict.tryAcquire('a')?.release();
  evict.put('c', Buffer.from([3, 3, 3, 3]), 'application/octet-stream').release();
  assert.strictEqual(evict.tryAcquire('b'), null);
  assert.ok(evict.tryAcquire('a'));
  assert.ok(evict.tryAcquire('c'));

  const heldTier = cache(4);
  const held = heldTier.put('a', Buffer.from([1, 1, 1, 1]), 'application/octet-stream');
  heldTier.put('b', Buffer.from([2, 2, 2, 2]), 'application/octet-stream').release();
  assert.strictEqual(heldTier.tryAcquire('a'), null);
  assert.deepStrictEqual([...held.body], [1, 1, 1, 1]);
  held.release();

  assert.strictEqual(cache(1024, true).enabled, true);
  assert.strictEqual(cache(1024, false).enabled, false);

  const sub: SharedAssetShareabilityDescriptor = {
    requestHadCookie: false,
    requestHadAuthorization: false,
    cacheControlDirectives: [],
    varyValues: [],
    statusCode: 200,
    kind: 'subresource',
  };
  assert.strictEqual(SharedAssetCacheL2.isShareable(sub), true);
  assert.strictEqual(
    SharedAssetCacheL2.isShareable({ ...sub, requestHadCookie: true }),
    false,
  );
  assert.strictEqual(
    SharedAssetCacheL2.isShareable({ ...sub, requestHadAuthorization: true }),
    false,
  );
  assert.strictEqual(
    SharedAssetCacheL2.isShareable({ ...sub, cacheControlDirectives: ['private'] }),
    false,
  );
  assert.strictEqual(
    SharedAssetCacheL2.isShareable({ ...sub, varyValues: ['Cookie'] }),
    false,
  );
  assert.strictEqual(
    SharedAssetCacheL2.isShareable({ ...sub, kind: 'navigation_document' }),
    false,
  );
  assert.strictEqual(SharedAssetCacheL2.isShareable({ ...sub, statusCode: 404 }), false);

  const a = SharedAssetCacheL2.buildKey('https', 'cdn.test', 443, '/img.png', '?sig=1', [], 'none');
  const b = SharedAssetCacheL2.buildKey('https', 'cdn.test', 443, '/img.png', '?sig=2', [], 'none');
  const c = SharedAssetCacheL2.buildKey(
    'https',
    'cdn.test',
    443,
    '/img.png',
    '?sig=1',
    ['Accept-Encoding'],
    'none',
  );
  const d = SharedAssetCacheL2.buildKey('https', 'cdn.test', 443, '/img.png', '?sig=1', [], 'include');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(a, d);

  console.log('[unit] SharedAssetCacheL2 ok');
}
