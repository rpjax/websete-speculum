import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreencastPipeline } from '../browser/ScreencastPipeline';
import { encodeScreencastFrame, MSG_SCREENCAST } from '../protocol/wire-protocol';

test('shouldEmitIdleFrame after IDLE_MS silence', () => {
    const t0 = 1_000_000;
    assert.equal(ScreencastPipeline.shouldEmitIdleFrame(t0, t0 + 100), false);
    assert.equal(ScreencastPipeline.shouldEmitIdleFrame(t0, t0 + ScreencastPipeline.IDLE_MS), true);
    assert.equal(ScreencastPipeline.shouldEmitIdleFrame(t0, t0 + ScreencastPipeline.IDLE_MS + 1), true);
});

test('idle path would produce a second screencast frame encoding', () => {
    const first = encodeScreencastFrame(Buffer.from([0xff, 0xd8, 0x01]));
    const second = encodeScreencastFrame(Buffer.from([0xff, 0xd8, 0x02]));
    assert.equal(first[0], MSG_SCREENCAST);
    assert.equal(second[0], MSG_SCREENCAST);
    assert.notDeepEqual(first, second);
    // Contract: after idle decision true, captureScreenshot encodes another MSG_SCREENCAST.
    assert.equal(ScreencastPipeline.shouldEmitIdleFrame(0, ScreencastPipeline.IDLE_MS), true);
});
