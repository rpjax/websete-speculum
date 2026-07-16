import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchMoveCoalescer } from '../input/TouchMoveCoalescer';
import type { TouchPoint } from '../protocol/wire-protocol';

test('TouchMoveCoalescer keeps only the latest sample', () => {
    const flushed: TouchPoint[][] = [];
    const scheduled: Array<() => void> = [];
    const c = new TouchMoveCoalescer(
        (points) => { flushed.push(points); },
        (fn) => { scheduled.push(fn); },
    );

    c.queue([{ id: 1, x: 1, y: 1 }]);
    c.queue([{ id: 1, x: 2, y: 2 }]);
    c.queue([{ id: 1, x: 3, y: 3 }]);
    assert.equal(flushed.length, 0);
    assert.equal(scheduled.length, 1);
    scheduled[0]!();
    assert.equal(flushed.length, 1);
    assert.deepEqual(flushed[0], [{ id: 1, x: 3, y: 3 }]);
});

test('TouchMoveCoalescer.takePending steals points before scheduled flush', () => {
    const scheduled: Array<() => void> = [];
    const flushed: TouchPoint[][] = [];
    const c = new TouchMoveCoalescer(
        (points) => { flushed.push(points); },
        (fn) => { scheduled.push(fn); },
    );

    c.queue([{ id: 1, x: 10, y: 20 }]);
    const pending = c.takePending();
    assert.deepEqual(pending, [{ id: 1, x: 10, y: 20 }]);
    scheduled[0]!();
    assert.equal(flushed.length, 0);
});
