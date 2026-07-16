import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualDisplay } from '../browser/VirtualDisplay';

test('snapSize rounds odd viewport dims to multiples of 8', () => {
    assert.deepEqual(VirtualDisplay.snapSize(1432, 715), { width: 1432, height: 712 });
    assert.deepEqual(VirtualDisplay.snapSize(757, 715), { width: 760, height: 712 });
    assert.deepEqual(VirtualDisplay.snapSize(1280, 720), { width: 1280, height: 720 });
});
