import assert from 'assert';
import { EventApplier } from './EventApplier';
import { SidecarBuffer } from './SidecarBuffer';
import { censusCoordinatedClickDelivery, liveNodeResolveClickDelivery } from './clickDelivery';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

export async function runEventApplierUnitTests(): Promise<void> {
  const moves: Array<{ x: number; y: number }> = [];
  const buttons: Array<{ btn: string; down: boolean }> = [];
  const buffer = new SidecarBuffer();
  const applier = new EventApplier({
    buffer,
    pointer: {
      moveTo: (x, y) => moves.push({ x, y }),
      button: (btn, down) => buttons.push({ btn, down }),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    clickDelivery: censusCoordinatedClickDelivery(async () => ({ ok: false, error: 'fail' })),
    onReject: () => {},
  });

  const down: UnifiedIntent = {
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 10,
    y: 20,
    button: 'left',
    census: { contexts: [] },
  };
  applier.enqueue(down);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(moves.length, 0, 'Phase A fail must skip Phase B');
  assert.strictEqual(buttons.length, 0, 'Phase A fail must not press');

  const moves2: Array<{ x: number; y: number }> = [];
  const buttons2: Array<{ btn: string; down: boolean }> = [];
  const applierOk = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves2.push({ x, y }),
      button: (btn, down) => buttons2.push({ btn, down }),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    clickDelivery: censusCoordinatedClickDelivery(async () => ({ ok: true })),
  });
  applierOk.enqueue({ ...down, type: 'move' });
  applierOk.enqueue({ ...down, type: 'down' });
  await applierOk.flush();
  assert.deepStrictEqual(moves2[0], { x: 10, y: 20 });
  assert.ok(moves2.some((m) => m.x === 10 && m.y === 20));
  assert.ok(buttons2.some((b) => b.btn === 'left' && b.down === true));

  // Stale viewport stamp → drop
  const rejects: string[] = [];
  const applierStale = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: () => assert.fail('stale must not move'),
      button: () => assert.fail('stale must not click'),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => false,
    clickDelivery: censusCoordinatedClickDelivery(async () => assert.fail('move must not reach click delivery')),
    onReject: (code) => rejects.push(code),
  });
  applierStale.enqueue({
    schemaVersion: 1,
    type: 'move',
    viewportW: 1024,
    viewportH: 600,
    x: 1,
    y: 1,
  });
  await applierStale.flush();
  assert.ok(rejects.includes('stale_viewport'));

  // `sparse-cdp` alternate pipeline (decision-log.md 2026-08-27) — resolveClickTarget wired
  // instead of applyScrollCensus: nodeId resolves to a live point, no census involved at all.
  const moves3: Array<{ x: number; y: number }> = [];
  const buttons3: Array<{ btn: string; down: boolean }> = [];
  const resolveCalls: Array<{ contextId: number; nodeId: number }> = [];
  const applierResolve = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves3.push({ x, y }),
      button: (btn, down) => buttons3.push({ btn, down }),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    clickDelivery: liveNodeResolveClickDelivery(async (contextId, nodeId) => {
      resolveCalls.push({ contextId, nodeId });
      return { ok: true, x: 111, y: 222 };
    }),
  });
  applierResolve.enqueue({
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 10,
    y: 20,
    button: 'left',
    contextId: 3,
    nodeId: 42,
  });
  await applierResolve.flush();
  assert.deepStrictEqual(resolveCalls, [{ contextId: 3, nodeId: 42 }]);
  assert.deepStrictEqual(moves3[0], { x: 111, y: 222 }, 'must dispatch at the resolved point, not the raw hit-test coord');
  assert.ok(buttons3.some((b) => b.btn === 'left' && b.down === true));

  // resolveClickTarget failure (dead/removed node) → reject, no dispatch, no census fallback.
  const rejects2: string[] = [];
  const applierResolveFail = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: () => assert.fail('unresolved nodeId must not move'),
      button: () => assert.fail('unresolved nodeId must not click'),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    clickDelivery: liveNodeResolveClickDelivery(async () => ({ ok: false, reason: 'node_not_found' })),
    onReject: (code) => rejects2.push(code),
  });
  applierResolveFail.enqueue({
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 10,
    y: 20,
    button: 'left',
    contextId: 1,
    nodeId: 99,
  });
  await applierResolveFail.flush();
  assert.ok(rejects2.includes('resolve_click_failed:node_not_found'));

  // No nodeId (empty-space hit-test miss) → dispatch at the raw client coordinate, unresolved,
  // no Virtual round trip at all — the documented fallback trade-off for `sparse-cdp`.
  const moves4: Array<{ x: number; y: number }> = [];
  const applierNoTarget = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves4.push({ x, y }),
      button: () => {},
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    isPageProjection: () => true,
    clickDelivery: liveNodeResolveClickDelivery(async () => assert.fail('must not call resolve when nodeId is null')),
  });
  applierNoTarget.enqueue({
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 50,
    y: 60,
    button: 'left',
    contextId: 1,
    nodeId: null,
  });
  await applierNoTarget.flush();
  assert.deepStrictEqual(moves4[0], { x: 50, y: 60 });

  console.log('[unit] EventApplier Phase A/B + sparse-cdp resolveClickTarget ok');
}
