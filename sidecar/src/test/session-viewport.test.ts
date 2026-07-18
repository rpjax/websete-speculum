import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionViewport } from '../browser/SessionViewport';
import { DEFAULT_DEVICE_PROFILE } from '../protocol/device-profile';

test('SessionViewport rejects invalid resize without mutating confirmed size', async () => {
    const vp = new SessionViewport(1280, 720, DEFAULT_DEVICE_PROFILE);
    const outcome = await vp.applyResize({
        requestId: 'r1',
        width: 50,
        height: 50,
        device: DEFAULT_DEVICE_PROFILE,
        display: {} as never,
        page: {} as never,
        cdp: {} as never,
        sameSizeOnly: async () => { throw new Error('should not run'); },
        recreateAtSize: async () => { throw new Error('should not run'); },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
        assert.equal(outcome.errorCode, 'invalid_viewport');
        assert.equal(outcome.phase, 'validate');
    }
    assert.equal(vp.width, 1280);
    assert.equal(vp.height, 720);
});

test('SessionViewport reports busy while resizing', async () => {
    const vp = new SessionViewport(1280, 720, DEFAULT_DEVICE_PROFILE);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const first = vp.applyResize({
        requestId: 'r1',
        width: 1024,
        height: 768,
        device: DEFAULT_DEVICE_PROFILE,
        display: {
            readActiveGeometry: async () => ({ width: 1024, height: 768 }),
        } as never,
        page: {} as never,
        cdp: {} as never,
        sameSizeOnly: async () => {},
        recreateAtSize: async () => {
            await gate;
            return {
                display: {
                    readActiveGeometry: async () => ({ width: 1024, height: 768 }),
                } as never,
                page: {
                    evaluate: async () => ({ width: 1024, height: 768 }),
                } as never,
                cdp: {} as never,
            };
        },
    });

    // Allow first call to enter _resizing
    await new Promise((r) => setTimeout(r, 10));

    const busy = await vp.applyResize({
        requestId: 'r2',
        width: 800,
        height: 600,
        device: DEFAULT_DEVICE_PROFILE,
        display: {} as never,
        page: {} as never,
        cdp: {} as never,
        sameSizeOnly: async () => {},
        recreateAtSize: async () => { throw new Error('should not run'); },
    });
    assert.equal(busy.ok, false);
    if (!busy.ok) assert.equal(busy.errorCode, 'resize_busy');

    release();
    const done = await first;
    assert.equal(done.ok, true);
    assert.equal(vp.width, 1024);
    assert.equal(vp.height, 768);
});
