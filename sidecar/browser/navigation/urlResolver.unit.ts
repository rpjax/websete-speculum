import assert from 'assert';
import type { BrowserUrlMatchRule } from '../BrowserSession';
import { UrlResolver } from './urlResolver';

function exactDomain(...labels: string[]): BrowserUrlMatchRule['domain'] {
  return {
    scope: 'Pattern',
    labels: labels.map((value) => ({ match: 'Exact', value })),
  };
}

function wildcardDomain(...apexLabels: string[]): BrowserUrlMatchRule['domain'] {
  return {
    scope: 'Pattern',
    labels: [{ match: 'Any', value: '' }, ...apexLabels.map((value) => ({ match: 'Exact', value }))],
  };
}

function encodeNavigationState(host: string): string {
  const json = JSON.stringify({ v: 1, h: host });
  return encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'));
}

function decodeNavigationStateHost(query: string): string {
  const part = query.split('&').find((p) => p.startsWith('_w7s_nso='));
  if (!part) return '';
  const encoded = part.slice('_w7s_nso='.length);
  const json = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
  return (JSON.parse(json) as { h: string }).h;
}

function policy(
  defaultTargetHost: string,
  requestHost: string,
  allowedMainFrameUrls: BrowserUrlMatchRule[],
  domains: { domain: string; isSubdomainMirroringEnabled: boolean }[],
) {
  return {
    requestHost,
    defaultTargetHost,
    allowedMainFrameUrls,
    domains,
    navigationStateParam: '_w7s_nso',
  };
}

export function runUrlResolverUnitTests(): void {
  testResolveBootstrapHost();
  testResolveOpaqueNavigationStateFails();
  testResolveApexNavigationState();
  testResolveMirroredSubdomain();
  testResolveMirroredMultiLabelSubdomain();
  testResolveWwwSessionWithMirroring();
  testProjectToClientApexDefaultHost();
  testProjectToClientApexLabelHostRoundTrips();
  testProjectToClientMirroredSubdomain();
  testProjectToClientMalformedTargetFails();
}

function testResolveBootstrapHost(): void {
  const resolver = new UrlResolver(
    policy(
      'www.target.test',
      'bootstrap.speculum.test:443',
      [
        { domain: exactDomain('target', 'test'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('target', 'test'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: false }],
    ),
  );

  const result = resolver.resolve('/search', `q=1&_w7s_nso=${encodeNavigationState('')}`, 'bootstrap.speculum.test:443');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://www.target.test/search?q=1');
  }
}

function testResolveOpaqueNavigationStateFails(): void {
  const resolver = new UrlResolver(
    policy('www.target.test', 'bootstrap.speculum.test', [], []),
  );
  const result = resolver.resolve('/search', 'q=1&_w7s_nso=opaque', 'bootstrap.speculum.test:443');
  assert.strictEqual(result.ok, false);
}

function testResolveApexNavigationState(): void {
  const resolver = new UrlResolver(
    policy(
      'www.olx.com.br',
      'speculum.test',
      [
        { domain: exactDomain('www', 'olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: false }],
    ),
  );

  const result = resolver.resolve('/listing', `q=1&_w7s_nso=${encodeNavigationState('cars')}`, 'speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://cars.olx.com.br/listing?q=1');
  }
}

function testResolveMirroredSubdomain(): void {
  const resolver = new UrlResolver(
    policy(
      'olx.com.br',
      'cars.speculum.test',
      [
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: true }],
    ),
  );

  const result = resolver.resolve('/listing', '', 'cars.speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://cars.olx.com.br/listing');
  }
}

function testResolveMirroredMultiLabelSubdomain(): void {
  const resolver = new UrlResolver(
    policy(
      'olx.com.br',
      'api.v2.speculum.test',
      [
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: true }],
    ),
  );

  const result = resolver.resolve('/api', '', 'api.v2.speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://api.v2.olx.com.br/api');
  }
}

function testResolveWwwSessionWithMirroring(): void {
  const resolver = new UrlResolver(
    policy(
      'olx.com.br',
      'www.speculum.test',
      [
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: true }],
    ),
  );

  const result = resolver.resolve('/', `_w7s_nso=${encodeNavigationState('cars')}`, 'www.speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://www.olx.com.br/');
  }
}

function testProjectToClientApexDefaultHost(): void {
  const resolver = new UrlResolver(
    policy(
      'www.target.test',
      'speculum.test',
      [
        { domain: exactDomain('target', 'test'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('target', 'test'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: false }],
    ),
  );

  const result = resolver.projectToClient('https://www.target.test/search?q=1', 'speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    const uri = new URL(result.value);
    assert.strictEqual(uri.hostname, 'speculum.test');
    assert.strictEqual(uri.pathname, '/search');
    assert.ok(uri.search.includes('q=1'));
    assert.ok(uri.search.includes('_w7s_nso='));
    assert.strictEqual(decodeNavigationStateHost(uri.search.slice(1)), '');
  }
}

function testProjectToClientApexLabelHostRoundTrips(): void {
  const resolver = new UrlResolver(
    policy(
      'www.olx.com.br',
      'speculum.test',
      [
        { domain: exactDomain('www', 'olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: false }],
    ),
  );

  const projected = resolver.projectToClient('https://cars.olx.com.br/listing?q=1', 'speculum.test');
  assert.strictEqual(projected.ok, true);
  if (!projected.ok) return;

  const clientUri = new URL(projected.value);
  const query = clientUri.search.slice(1);
  const resolved = resolver.resolve(clientUri.pathname, query, 'speculum.test');
  assert.strictEqual(resolved.ok, true);
  if (resolved.ok) {
    assert.strictEqual(resolved.value, 'https://cars.olx.com.br/listing?q=1');
    assert.strictEqual(decodeNavigationStateHost(query), 'cars');
  }
}

function testProjectToClientMirroredSubdomain(): void {
  const resolver = new UrlResolver(
    policy(
      'olx.com.br',
      'cars.speculum.test',
      [
        { domain: exactDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
        { domain: wildcardDomain('olx', 'com', 'br'), path: { scope: 'Any', matchType: 'Prefix', segments: [] } },
      ],
      [{ domain: 'speculum.test', isSubdomainMirroringEnabled: true }],
    ),
  );

  const result = resolver.projectToClient('https://cars.olx.com.br/listing?q=1', 'cars.speculum.test');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, 'https://cars.speculum.test/listing?q=1');
  }
}

function testProjectToClientMalformedTargetFails(): void {
  const resolver = new UrlResolver(
    policy('www.target.test', 'speculum.test', [], []),
  );
  assert.strictEqual(resolver.projectToClient('not-a-url', 'speculum.test').ok, false);
  assert.strictEqual(resolver.projectToClient('ftp://example.test/', 'speculum.test').ok, false);
}
