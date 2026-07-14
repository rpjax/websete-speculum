import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWheelDeltas } from '../input/wheel-defaults';
import { decodeMessage } from '../protocol/wire-protocol';

test('normalizeWheelDeltas defaults missing deltaX to 0', () => {
    assert.deepEqual(normalizeWheelDeltas({ deltaY: 120 }), { deltaX: 0, deltaY: 120 });
});

test('normalizeWheelDeltas treats NaN as 0', () => {
    assert.deepEqual(normalizeWheelDeltas({ deltaX: Number.NaN, deltaY: 40 }), { deltaX: 0, deltaY: 40 });
});

test('decodeMessage wheel without deltaX is normalized before dispatch contract', () => {
    const msg = decodeMessage(JSON.stringify({ type: 'wheel', x: 1, y: 2, deltaY: 90 }));
    assert.ok(msg && msg.type === 'wheel');
    if (msg && msg.type === 'wheel') {
        const n = normalizeWheelDeltas(msg);
        assert.equal(n.deltaX, 0);
        assert.equal(n.deltaY, 90);
    }
});
