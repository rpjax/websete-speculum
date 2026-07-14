import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeCookieForCdp,
    sanitizeCookieBatch,
    importBrowserState,
    type BrowserCookieState,
    type BrowserStatePayload,
    type ImportCookieStats,
} from '../BrowserState';
import { mapSidecarErrorCode, mapStateExportErrorCode } from '../transport/WsSessionHost';

// --- sanitizeCookieForCdp: comprehensive matrix ---

test('sanitize: omits empty sameSite and non-positive expires (-1)', () => {
    const dirty: BrowserCookieState = {
        name: 'sf_marker', value: 'state-cookie',
        domain: 'fixture.test', path: '/',
        expires: -1, httpOnly: false, secure: true, sameSite: '',
    };
    const clean = sanitizeCookieForCdp(dirty);
    assert.ok(clean);
    assert.equal(clean.name, 'sf_marker');
    assert.equal('expires' in clean, false);
    assert.equal('sameSite' in clean, false);
});

test('sanitize: omits expires = 0 (session cookie)', () => {
    const c: BrowserCookieState = {
        name: 'a', value: '1', domain: 'x.com', path: '/',
        expires: 0, httpOnly: false, secure: false,
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal('expires' in clean, false);
});

test('sanitize: omits undefined expires', () => {
    const c: BrowserCookieState = {
        name: 'a', value: '1', domain: 'x.com', path: '/',
        httpOnly: false, secure: false,
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal('expires' in clean, false);
});

test('sanitize: keeps valid positive expires in seconds', () => {
    const c: BrowserCookieState = {
        name: 'a', value: '1', domain: 'example.com', path: '/',
        expires: 1_900_000_000, httpOnly: true, secure: true, sameSite: 'Lax',
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal(clean.expires, 1_900_000_000);
    assert.equal(clean.sameSite, 'Lax');
});

test('sanitize: converts millisecond timestamps to seconds', () => {
    const msTimestamp = 1_700_000_000_000; // clearly ms
    const c: BrowserCookieState = {
        name: 'ms', value: 'v', domain: 'd.com', path: '/',
        expires: msTimestamp, httpOnly: false, secure: false,
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal(clean.expires, 1_700_000_000);
});

test('sanitize: normalizes sameSite case-insensitively', () => {
    for (const [input, expected] of [
        ['strict', 'Strict'], ['STRICT', 'Strict'],
        ['lax', 'Lax'], ['LAX', 'Lax'],
        ['none', 'None'], ['NONE', 'None'], ['None', 'None'],
    ] as const) {
        const c: BrowserCookieState = {
            name: 'x', value: '1', domain: 'd.com', path: '/',
            httpOnly: false, secure: true, sameSite: input,
        };
        const clean = sanitizeCookieForCdp(c)!;
        assert.equal(clean.sameSite, expected, `input "${input}" → "${expected}"`);
    }
});

test('sanitize: omits unrecognized sameSite values', () => {
    for (const bad of ['', '  ', 'invalid', 'lax2', 'Secure']) {
        const c: BrowserCookieState = {
            name: 'x', value: '1', domain: 'd.com', path: '/',
            httpOnly: false, secure: false, sameSite: bad,
        };
        const clean = sanitizeCookieForCdp(c)!;
        assert.equal('sameSite' in clean, false, `"${bad}" should be omitted`);
    }
});

test('sanitize: SameSite=None forces secure=true', () => {
    const c: BrowserCookieState = {
        name: 'x', value: '1', domain: 'd.com', path: '/',
        httpOnly: false, secure: false, sameSite: 'none',
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal(clean.sameSite, 'None');
    assert.equal(clean.secure, true);
});

test('sanitize: returns null for empty name', () => {
    const c: BrowserCookieState = {
        name: '', value: '1', domain: 'd.com', path: '/',
        httpOnly: false, secure: false,
    };
    assert.equal(sanitizeCookieForCdp(c), null);
});

test('sanitize: returns null for whitespace-only name', () => {
    const c: BrowserCookieState = {
        name: '   ', value: '1', domain: 'd.com', path: '/',
        httpOnly: false, secure: false,
    };
    assert.equal(sanitizeCookieForCdp(c), null);
});

test('sanitize: omits empty domain (let CDP infer)', () => {
    const c: BrowserCookieState = {
        name: 'a', value: '1', domain: '', path: '/',
        httpOnly: false, secure: false,
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal('domain' in clean, false);
});

test('sanitize: trims name and domain whitespace', () => {
    const c: BrowserCookieState = {
        name: '  x  ', value: '1', domain: ' example.com ', path: '/',
        httpOnly: false, secure: false,
    };
    const clean = sanitizeCookieForCdp(c)!;
    assert.equal(clean.name, 'x');
    assert.equal(clean.domain, 'example.com');
});

// --- sanitizeCookieBatch ---

test('batch: filters out invalid cookies and counts skipped', () => {
    const cookies: BrowserCookieState[] = [
        { name: 'good', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        { name: '', value: 'bad', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        { name: '  ', value: 'bad2', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        { name: 'ok', value: '2', domain: 'd.com', path: '/', httpOnly: false, secure: false },
    ];
    const { valid, skippedCount } = sanitizeCookieBatch(cookies);
    assert.equal(valid.length, 2);
    assert.equal(skippedCount, 2);
    assert.equal(valid[0].name, 'good');
    assert.equal(valid[1].name, 'ok');
});

// --- importBrowserState mock: fallback path ---

test('import: batch success applies all cookies', async () => {
    let batchCalled = false;
    const fakeCdp = {
        send: async (method: string, params?: unknown) => {
            if (method === 'Network.setCookies') {
                batchCalled = true;
                return {};
            }
            throw new Error('unexpected');
        },
    };

    const state: BrowserStatePayload = {
        cookies: [
            { name: 'a', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
            { name: 'b', value: '2', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        ],
        localStorage: [],
        idbRecords: [],
        history: [],
    };

    const stats = await importBrowserState(fakeCdp as any, {} as any, state);
    assert.equal(batchCalled, true);
    assert.equal(stats.total, 2);
    assert.equal(stats.applied, 2);
    assert.equal(stats.skipped, 0);
    assert.equal(stats.failedIndividual, 0);
});

test('import: batch failure triggers per-cookie fallback', async () => {
    let batchAttempts = 0;
    let individualAttempts = 0;
    const fakeCdp = {
        send: async (method: string, params?: any) => {
            if (method === 'Network.setCookies') {
                const cookies = params?.cookies ?? [];
                if (cookies.length > 1) {
                    batchAttempts++;
                    throw new Error('batch failed');
                }
                individualAttempts++;
                if (cookies[0]?.name === 'bad') {
                    throw new Error('rejected by CDP');
                }
                return {};
            }
            throw new Error('unexpected');
        },
    };

    const state: BrowserStatePayload = {
        cookies: [
            { name: 'good', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
            { name: 'bad', value: '2', domain: 'd.com', path: '/', httpOnly: false, secure: false },
            { name: 'ok', value: '3', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        ],
        localStorage: [],
        idbRecords: [],
        history: [],
    };

    const stats = await importBrowserState(fakeCdp as any, {} as any, state);
    assert.equal(batchAttempts, 1);
    assert.equal(individualAttempts, 3);
    assert.equal(stats.applied, 2);
    assert.equal(stats.failedIndividual, 1);
    assert.equal(stats.total, 3);
});

test('import: all cookies skipped by sanitize does not throw', async () => {
    const fakeCdp = { send: async () => ({}) };
    const state: BrowserStatePayload = {
        cookies: [
            { name: '', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
            { name: '  ', value: '2', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        ],
        localStorage: [],
        idbRecords: [],
        history: [],
    };

    const stats = await importBrowserState(fakeCdp as any, {} as any, state);
    assert.equal(stats.skipped, 2);
    assert.equal(stats.applied, 0);
});

test('import: all cookies rejected by CDP throws', async () => {
    const fakeCdp = {
        send: async (method: string) => {
            if (method === 'Network.setCookies') throw new Error('rejected');
            return {};
        },
    };

    const state: BrowserStatePayload = {
        cookies: [
            { name: 'a', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        ],
        localStorage: [],
        idbRecords: [],
        history: [],
    };

    await assert.rejects(
        () => importBrowserState(fakeCdp as any, {} as any, state),
        /cookie_import_invalid/,
    );
});

test('import: skipped cookies counted separately from CDP rejections', async () => {
    let calls = 0;
    const fakeCdp = {
        send: async (method: string, params?: any) => {
            if (method === 'Network.setCookies') {
                calls++;
                return {};
            }
            return {};
        },
    };

    const state: BrowserStatePayload = {
        cookies: [
            { name: '', value: 'skip', domain: 'd.com', path: '/', httpOnly: false, secure: false },
            { name: 'ok', value: '1', domain: 'd.com', path: '/', httpOnly: false, secure: false },
        ],
        localStorage: [],
        idbRecords: [],
        history: [],
    };

    const stats = await importBrowserState(fakeCdp as any, {} as any, state);
    assert.equal(stats.total, 2);
    assert.equal(stats.skipped, 1);
    assert.equal(stats.sanitized, 1);
    assert.equal(stats.applied, 1);
    assert.equal(calls, 1);
});

// --- Wire error code mapping ---

test('mapSidecarErrorCode maps Network.setCookies to cookie_import_invalid', () => {
    assert.equal(
        mapSidecarErrorCode('Protocol error (Network.setCookies): Invalid parameters'),
        'cookie_import_invalid',
    );
    assert.equal(mapSidecarErrorCode('display failed'), 'sidecar_session_create_failed');
});

test('mapStateExportErrorCode maps closed sessions', () => {
    assert.equal(mapStateExportErrorCode('session disposed'), 'export_session_gone');
    assert.equal(mapStateExportErrorCode('boom'), 'export_failed');
});
