import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeviceProfile } from '../protocol/device-profile';
import { decodeMessage } from '../protocol/wire-protocol';

test('normalizeDeviceProfile caps DPR and enables touch for mobile', () => {
    const d = normalizeDeviceProfile({
        mobile: true,
        deviceScaleFactor: 4,
        maxTouchPoints: 0,
    });
    assert.equal(d.mobile, true);
    assert.equal(d.touch, true);
    assert.equal(d.deviceScaleFactor, 2);
    assert.equal(d.maxTouchPoints, 5);
    assert.equal(d.userAgentProfile, 'mobile');
});

test('decodeMessage touch start payload', () => {
    const msg = decodeMessage(JSON.stringify({
        type: 'touch',
        phase: 'start',
        points: [{ id: 1, x: 10, y: 20, force: 0.5 }],
        changedIds: [1],
    }));
    assert.ok(msg && msg.type === 'touch');
    if (msg && msg.type === 'touch') {
        assert.equal(msg.phase, 'start');
        assert.equal(msg.points.length, 1);
        assert.deepEqual(msg.changedIds, [1]);
    }
});

test('normalizeDeviceProfile preserves screenOrientation', () => {
    const d = normalizeDeviceProfile({
        mobile: true,
        deviceScaleFactor: 2,
        maxTouchPoints: 5,
        screenOrientation: 'landscape-primary',
    });
    assert.equal(d.screenOrientation, 'landscape-primary');
});

test('decodeMessage text payload', () => {
    const msg = decodeMessage(JSON.stringify({ type: 'text', text: 'hi', source: 'insert' }));
    assert.ok(msg && msg.type === 'text');
    if (msg && msg.type === 'text') {
        assert.equal(msg.text, 'hi');
    }
});

test('partial touch end keeps remaining points on wire for sidecar re-assert', () => {
    const msg = decodeMessage(JSON.stringify({
        type: 'touch',
        phase: 'end',
        points: [{ id: 2, x: 20, y: 30 }],
        changedIds: [1],
    }));
    assert.ok(msg && msg.type === 'touch');
    if (msg && msg.type === 'touch') {
        assert.equal(msg.phase, 'end');
        assert.equal(msg.points.length, 1);
        assert.equal(msg.points[0]?.id, 2);
    }
});
