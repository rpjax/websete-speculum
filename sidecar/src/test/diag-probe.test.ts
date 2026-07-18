import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMessage } from '../protocol/wire-protocol';
import { capProbeData, isProcessAlive } from '../browser/DiagProbe';

test('decodeMessage parses diagProbe request', () => {
    const raw = JSON.stringify({
        type:               'diagProbe',
        requestId:          'req-1',
        ops:                ['process', 'tabs'],
        evaluateExpression: '1 + 1',
        domSelector:        '#app',
    });

    const msg = decodeMessage(raw);
    assert.ok(msg);
    assert.equal(msg.type, 'diagProbe');
    if (msg.type !== 'diagProbe') return;

    assert.equal(msg.requestId, 'req-1');
    assert.deepEqual(msg.ops, ['process', 'tabs']);
    assert.equal(msg.evaluateExpression, '1 + 1');
    assert.equal(msg.domSelector, '#app');
});

test('decodeMessage parses diagResult response shape', () => {
    const raw = JSON.stringify({
        type:      'diagResult',
        requestId: 'req-2',
        ok:        true,
        data:      { tabs: { tabCount: 1, urls: ['https://example.com/'] } },
    });

    const msg = decodeMessage(raw);
    assert.ok(msg);
    assert.equal(msg.type, 'diagResult');
});

test('decodeMessage returns null for invalid JSON', () => {
    assert.equal(decodeMessage('{not json'), null);
});

test('isProcessAlive returns true for current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive returns false for invalid pid', () => {
    assert.equal(isProcessAlive(null), false);
    assert.equal(isProcessAlive(-1), false);
});

test('capProbeData trims oversized payloads within budget', () => {
    const huge = 'x'.repeat(8_000);
    const capped = capProbeData({
        cookies: [{ name: 'a', value: huge, domain: 'x', path: '/', httpOnly: false, secure: false }],
        storage: Array.from({ length: 100 }, (_, i) => ({ origin: 'https://a', key: `k${i}`, value: 'v' })),
        dom:     { outerHTML: huge, text: 't' },
        process: { display: ':100', xvfbPid: 1, wmPid: 2, chromePid: 3, userDataDirExists: true, activeWidth: 1280, activeHeight: 720 },
    }, 16_384);

    assert.ok(Buffer.byteLength(JSON.stringify(capped), 'utf8') <= 16_384);
    assert.ok(capped.process);
    assert.ok(capped.dom?.outerHTML && capped.dom.outerHTML.length < huge.length);
});

test('capProbeData throws response_too_large when evidence cannot fit', () => {
    const huge = 'x'.repeat(600_000);
    assert.throws(
        () => capProbeData({
            cookies: [{ name: 'a', value: huge, domain: 'x', path: '/', httpOnly: false, secure: false }],
            storage: Array.from({ length: 100 }, (_, i) => ({ origin: 'https://a', key: `k${i}`, value: 'v' })),
            dom:     { outerHTML: huge, text: 't' },
            process: { display: ':100', xvfbPid: 1, wmPid: 2, chromePid: 3, userDataDirExists: true, activeWidth: 1280, activeHeight: 720 },
        }, 256),
        (err: Error) => err.message.includes('response_too_large'),
    );
});
