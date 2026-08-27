import assert from 'assert';
import { EventApplier } from './EventApplier';
import { SidecarBuffer } from './SidecarBuffer';
import { liveNodeResolveClickDelivery } from './clickDelivery';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';

export async function runEventApplierUnitTests(): Promise<void> {
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
    clickDelivery: liveNodeResolveClickDelivery(async () => assert.fail('move must not reach click delivery')),
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

  // nodeId resolves to a live point
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

  // resolve failure → reject, no dispatch
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

  // No nodeId → dispatch at raw client coordinate
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
    clickDelivery: liveNodeResolveClickDelivery(async () => assert.fail('must not call resolve when nodeId is null')),
  });
  const downNull: UnifiedIntent = {
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 50,
    y: 60,
    button: 'left',
    contextId: 1,
    nodeId: null,
  };
  applierNoTarget.enqueue(downNull);
  await applierNoTarget.flush();
  assert.deepStrictEqual(moves4[0], { x: 50, y: 60 });

  console.log('[unit] EventApplier live-node-resolve ok');
}
