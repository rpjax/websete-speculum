import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncChain } from '../AsyncChain';
import { MouseMoveCoalescer } from '../MouseMoveCoalescer';
import { NavigationGeneration } from '../NavigationGeneration';

test('AsyncChain serializes overlapping runs', async () => {
    const chain = new AsyncChain();
    const order: number[] = [];

    const first = chain.run(async () => {
        await new Promise(r => setTimeout(r, 30));
        order.push(1);
    });
    const second = chain.run(async () => {
        order.push(2);
    });

    await Promise.all([first, second]);
    assert.deepEqual(order, [1, 2]);
});

test('MouseMoveCoalescer flushes only the latest position', () => {
    const flushed: Array<{ x: number; y: number }> = [];
    const pendingFlushes: Array<() => void> = [];

    const coalescer = new MouseMoveCoalescer(
        (x, y) => flushed.push({ x, y }),
        fn => { pendingFlushes.push(fn); },
    );

    for (let i = 0; i < 100; i++) {
        coalescer.queue(i, i);
    }

    assert.equal(pendingFlushes.length, 1);
    pendingFlushes[0]!();
    assert.deepEqual(flushed, [{ x: 99, y: 99 }]);
});

test('NavigationGeneration invalidates stale generations', () => {
    const nav = new NavigationGeneration();
    const first = nav.begin();
    nav.begin();
    assert.equal(nav.isCurrent(first), false);
    assert.equal(nav.isCurrent(2), true);
});

test('NavigationGeneration stale completion is a no-op after superseded', async () => {
    const nav = new NavigationGeneration();
    let completed = 0;
    const first = nav.begin();
    nav.begin();

    const stale = (async () => {
        await new Promise(r => setTimeout(r, 20));
        if (nav.isCurrent(first)) completed++;
    })();

    await stale;
    assert.equal(completed, 0);
});
