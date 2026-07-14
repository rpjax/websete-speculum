import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationGuard } from '../navigation/NavigationGuard';

test('matchesAllowedDomain: apex exact', () => {
    assert.equal(NavigationGuard.matchesAllowedDomain('fixture.test', ['fixture.test']), true);
    assert.equal(NavigationGuard.matchesAllowedDomain('evil.test', ['fixture.test']), false);
});

test('matchesAllowedDomain: wildcard matches subdomain only', () => {
    const patterns = ['fixture.test', '*.fixture.test'];
    assert.equal(NavigationGuard.matchesAllowedDomain('www.fixture.test', patterns), true);
    assert.equal(NavigationGuard.matchesAllowedDomain('a.b.fixture.test', patterns), true);
    assert.equal(NavigationGuard.matchesAllowedDomain('fixture.test', patterns), true);
    assert.equal(NavigationGuard.matchesAllowedDomain('notfixture.test', patterns), false);
    assert.equal(NavigationGuard.matchesAllowedDomain('evil-fixture.test', patterns), false);
});

test('matchesAllowedDomain: main-frame asset hosts differ — Document guard vs fetch assets', () => {
    // Contract reminder: NavigationGuard blocks main-frame Document hosts via matchesAllowedDomain;
    // subresource fetches to off-allowlist hosts are not rejected by this helper alone.
    assert.equal(
        NavigationGuard.matchesAllowedDomain('cdn.evil.test', ['fixture.test', '*.fixture.test']),
        false,
    );
});
