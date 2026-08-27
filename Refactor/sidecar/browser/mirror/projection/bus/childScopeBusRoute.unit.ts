/**
 * Child-scope index + VirtualDomainBus O(1) fabric routing (no DOM querySelectorAll).
 */

import assert from 'assert';
import { ChildScopeIndex } from '@speculum/page-projection/virtual/dom/childScopes';
import { VirtualDomainBus } from '@speculum/page-projection/virtual/bus/virtualDomainBus';
import type { BusEnvelope } from '@speculum/page-projection/virtual/bus/types';

export async function runChildScopeBusRouteUnitTests(): Promise<void> {
  testChildScopeIndexReverseAndWindowLookup();
  testChildScopeDropRemovesContext();
  await testBusUnicastUsesFabricNotQuerySelector();
  await testBusDeadContextFailClosedFast();
  console.log('[unit] child-scope bus O(1) route ok');
}

function testChildScopeIndexReverseAndWindowLookup(): void {
  let next = 2;
  const index = new ChildScopeIndex(() => next++);
  const winA = { tag: 'A' };
  const hostA = { nodeType: 1, isConnected: true, contentWindow: winA };
  const nodes = new Map<number, object>([[10, hostA]]);

  const admit = index.admit(10, hostA as never);
  assert.strictEqual(admit.kind, 'host');
  if (admit.kind !== 'host') return;
  assert.strictEqual(admit.contextId, 2);
  assert.strictEqual(index.hasContext(2), true);
  assert.strictEqual(index.nodeIdOf(2), 10);
  assert.strictEqual(index.windowOf(2, (id) => nodes.get(id) as never), winA);
  assert.strictEqual(index.lookupByContentWindow(winA, (id) => nodes.get(id) as never), 2);

  let live = 0;
  index.forEachLiveWindow(
    (id) => nodes.get(id) as never,
    (w, ctx) => {
      live += 1;
      assert.strictEqual(w, winA);
      assert.strictEqual(ctx, 2);
    },
  );
  assert.strictEqual(live, 1);
}

function testChildScopeDropRemovesContext(): void {
  let next = 2;
  const index = new ChildScopeIndex(() => next++);
  const winA = { tag: 'A' };
  const hostA = { nodeType: 1, isConnected: true, contentWindow: winA };
  const nodes = new Map<number, object>([[10, hostA]]);
  index.admit(10, hostA as never);
  index.drop(10);
  assert.strictEqual(index.hasContext(2), false);
  assert.strictEqual(index.windowOf(2, (id) => nodes.get(id) as never), null);
}

async function testBusUnicastUsesFabricNotQuerySelector(): Promise<void> {
  let queryCalls = 0;
  const received: BusEnvelope[] = [];
  const childWin = {
    postMessage: (env: BusEnvelope) => {
      received.push(env);
    },
  };
  const win = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: {
      querySelectorAll: () => {
        queryCalls += 1;
        return [];
      },
    },
  };
  const bus = new VirtualDomainBus({
    window: win as never,
    role: 'root',
    contextId: 1,
    servesRuntime: true,
  });
  bus.setChildFabric({
    windowOf: (id) => (id === 7 ? (childWin as never) : null),
    forEachLive: (fn) => fn(childWin as never, 7),
    hasContext: (id) => id === 7,
  });
  bus.setDeliverableCheck((id) => id === 1 || id === 7);

  bus.emit('telemetry', { kind: 'ping' }, { destination: 7 });
  assert.strictEqual(queryCalls, 0, 'must not scan DOM');
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0]!.destination, 7);
  bus.dispose();
}

async function testBusDeadContextFailClosedFast(): Promise<void> {
  const win = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: {
      querySelectorAll: () => {
        throw new Error('querySelectorAll must not run');
      },
    },
  };
  const bus = new VirtualDomainBus({
    window: win as never,
    role: 'root',
    contextId: 1,
    servesRuntime: true,
    isDeliverableDestination: (id) => id === 1,
  });
  bus.setChildFabric({
    windowOf: () => null,
    forEachLive: () => undefined,
    hasContext: () => false,
  });
  bus.setDeliverableCheck((id) => id === 1);

  const t0 = performance.now();
  const r = await bus.requestApplyScroll(99, [{ nodeId: null, scrollX: 0, scrollY: 0 }]);
  const wall = performance.now() - t0;
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.reason === 'context_not_found' || String(r.reason).includes('context_not_found'),
    `expected context_not_found, got ${JSON.stringify(r)}`,
  );
  assert.ok(wall < 200, `fail-closed must be fast, wall=${wall}`);
  bus.dispose();
}
