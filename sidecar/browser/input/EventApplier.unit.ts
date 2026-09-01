import assert from 'assert';
import { EventApplier } from './EventApplier';
import { SidecarBuffer } from './SidecarBuffer';
import { liveNodeResolveClickDelivery } from './clickDelivery';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';
import { mapLocalHitToRootPoint } from '@speculum/page-projection/core/input/localHit';

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

  // nodeId + local → delivery gets local; CDP at mapped point
  const moves3: Array<{ x: number; y: number }> = [];
  const buttons3: Array<{ btn: string; down: boolean }> = [];
  const resolveCalls: Array<{
    contextId: number;
    nodeId: number;
    localX: number | undefined;
    localY: number | undefined;
  }> = [];
  const applierResolve = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: (x, y) => moves3.push({ x, y }),
      button: (btn, down) => buttons3.push({ btn, down }),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    clickDelivery: liveNodeResolveClickDelivery(async (contextId, nodeId, localX, localY) => {
      resolveCalls.push({ contextId, nodeId, localX, localY });
      const mapped = mapLocalHitToRootPoint(
        { left: 100, top: 200, right: 200, bottom: 300 },
        localX ?? 0.5,
        localY ?? 0.5,
      );
      assert.ok(mapped);
      return { ok: true, x: mapped!.x, y: mapped!.y };
    }),
  });
  applierResolve.enqueue({
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 10,
    y: 20,
    localX: 1,
    localY: 0.5,
    button: 'left',
    contextId: 3,
    nodeId: 42,
  });
  await applierResolve.flush();
  assert.deepStrictEqual(resolveCalls, [{ contextId: 3, nodeId: 42, localX: 1, localY: 0.5 }]);
  assert.deepStrictEqual(moves3[0], { x: 200, y: 250 }, 'local 1,0.5 → right edge center of rect');
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
    localX: 0.5,
    localY: 0.5,
    button: 'left',
    contextId: 1,
    nodeId: 99,
  });
  await applierResolveFail.flush();
  assert.ok(rejects2.includes('resolve_click_failed:node_not_found'));

  // missing nodeId → reject fail-closed, no dispatch
  const rejects3: string[] = [];
  const applierNoTarget = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: () => assert.fail('missing nodeId must not move'),
      button: () => assert.fail('missing nodeId must not click'),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    clickDelivery: liveNodeResolveClickDelivery(async () => assert.fail('must not call resolve when nodeId is null')),
    onReject: (code) => rejects3.push(code),
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
  assert.ok(rejects3.includes('missing_node_id'));

  // invalid local → reject
  const rejectsLocal: string[] = [];
  const applierBadLocal = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: {
      moveTo: () => assert.fail('bad local must not move'),
      button: () => assert.fail('bad local must not click'),
      sanitize: () => {},
    },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    clickDelivery: liveNodeResolveClickDelivery(async () => assert.fail('must not resolve bad local')),
    onReject: (code) => rejectsLocal.push(code),
  });
  applierBadLocal.enqueue({
    schemaVersion: 1,
    type: 'down',
    viewportW: 800,
    viewportH: 600,
    x: 1,
    y: 1,
    localX: 1.5,
    localY: 0.5,
    nodeId: 1,
  });
  await applierBadLocal.flush();
  assert.ok(rejectsLocal.includes('invalid_local'));

  // keyboard prefers intent.key over intent.code (KeyA → a)
  const keys: string[] = [];
  const applierKey = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: { moveTo: () => {}, button: () => {}, sanitize: () => {} },
    keyboard: {
      key: (k) => keys.push(k),
      sanitize: () => {},
    },
    activeViewport: () => ({ w: 800, h: 600 }),
    clickDelivery: liveNodeResolveClickDelivery(async () => ({ ok: true, x: 0, y: 0 })),
  });
  applierKey.enqueue({
    schemaVersion: 1,
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
  });
  await applierKey.flush();
  assert.deepStrictEqual(keys, ['a'], 'must dispatch key not UIEvent.code');

  keys.length = 0;
  applierKey.enqueue({
    schemaVersion: 1,
    type: 'keyDown',
    key: ' ',
    code: 'Space',
  });
  await applierKey.flush();
  assert.deepStrictEqual(keys, ['Space'], 'Space must not be trimmed away');

  // historyNav → applyHistoryNav
  const navCalls: string[] = [];
  const applierNav = new EventApplier({
    buffer: new SidecarBuffer(),
    pointer: { moveTo: () => {}, button: () => {}, sanitize: () => {} },
    keyboard: { key: () => {}, sanitize: () => {} },
    activeViewport: () => ({ w: 800, h: 600 }),
    clickDelivery: liveNodeResolveClickDelivery(async () => ({ ok: true, x: 0, y: 0 })),
    applyHistoryNav: async (direction) => {
      navCalls.push(direction);
      return { ok: true };
    },
  });
  applierNav.enqueue({
    schemaVersion: 1,
    type: 'historyNav',
    direction: 'back',
  });
  await applierNav.flush();
  assert.deepStrictEqual(navCalls, ['back']);

  console.log('[unit] EventApplier live-node-resolve ok');
}
