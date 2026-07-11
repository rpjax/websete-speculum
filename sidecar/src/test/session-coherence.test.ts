import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncChain } from '../AsyncChain';
import { MouseMoveCoalescer } from '../MouseMoveCoalescer';
import { NavigationGeneration } from '../NavigationGeneration';
import { ResizeGuard } from '../ResizeGuard';
import { mergeProfiles } from '../ProfileMerger';
import { archiveProfile, extractProfile } from '../ProfileArchive';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

test('ResizeGuard ignores concurrent resize attempts', () => {
    const guard = new ResizeGuard();
    assert.equal(guard.tryBegin(), true);
    assert.equal(guard.tryBegin(), false);
    guard.end();
    assert.equal(guard.tryBegin(), true);
    guard.end();
});

test('mergeProfiles complements non-overlapping files', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-base-'));
    const incDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-inc-'));

    try {
        fs.mkdirSync(path.join(baseDir, 'Default'), { recursive: true });
        fs.mkdirSync(path.join(incDir, 'Default'), { recursive: true });
        fs.writeFileSync(path.join(baseDir, 'Default', 'a.txt'), 'from-base');
        fs.writeFileSync(path.join(incDir, 'Default', 'b.txt'), 'from-incoming');

        const baseBlob     = await archiveProfile(baseDir);
        const incomingBlob = await archiveProfile(incDir);
        const merged       = await mergeProfiles(baseBlob, incomingBlob);

        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-out-'));
        await extractProfile(outDir, merged);

        assert.equal(fs.readFileSync(path.join(outDir, 'Default', 'a.txt'), 'utf8'), 'from-base');
        assert.equal(fs.readFileSync(path.join(outDir, 'Default', 'b.txt'), 'utf8'), 'from-incoming');
        fs.rmSync(outDir, { recursive: true, force: true });
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
        fs.rmSync(incDir, { recursive: true, force: true });
    }
});

test('mergeProfiles resolves same-path conflicts by mtime LWW', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-base-'));
    const incDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-inc-'));

    try {
        fs.mkdirSync(path.join(baseDir, 'Default'), { recursive: true });
        fs.mkdirSync(path.join(incDir, 'Default'), { recursive: true });

        const baseFile = path.join(baseDir, 'Default', 'prefs.json');
        const incFile  = path.join(incDir, 'Default', 'prefs.json');
        fs.writeFileSync(baseFile, '{"from":"base"}');
        fs.writeFileSync(incFile, '{"from":"incoming"}');

        const older = new Date('2020-01-01T00:00:00Z');
        const newer = new Date('2025-06-01T00:00:00Z');
        fs.utimesSync(baseFile, older, older);
        fs.utimesSync(incFile, newer, newer);

        const baseBlob     = await archiveProfile(baseDir);
        const incomingBlob = await archiveProfile(incDir);
        const merged       = await mergeProfiles(baseBlob, incomingBlob);

        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-out-'));
        await extractProfile(outDir, merged);
        assert.equal(
            fs.readFileSync(path.join(outDir, 'Default', 'prefs.json'), 'utf8'),
            '{"from":"incoming"}',
        );
        fs.rmSync(outDir, { recursive: true, force: true });
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
        fs.rmSync(incDir, { recursive: true, force: true });
    }
});
