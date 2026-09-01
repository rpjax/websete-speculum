/**
 * Child-scope index + VirtualDomainBus O(1) fabric routing (no DOM querySelectorAll).
 */

import assert from 'assert';
import { ChildScopeIndex } from '@speculum/page-projection/virtual/dom/childScopes';
import { VirtualDomainBus } from '@speculum/page-projection/virtual/bus/virtualDomainBus';
import {
  CONTEXT_BUS_CHANNEL,
  type BusEnvelope,
} from '@speculum/page-projection/virtual/bus/types';

export async function runChildScopeBusRouteUnitTests(): Promise<void> {
  testChildScopeIndexReverseAndWindowLookup();
  testChildScopeDropRemovesContext();
  testChildScopeRebindsWindowAfterReplace();
  await testBusUnicastUsesFabricNotQuerySelector();
  await testBusDeadContextFailClosedFast();
  console.log('[unit] child-scope bus O(1) route ok');
}

function testChildScopeIndexReverseAndWindowLookup(): void {
  let next = 2;
  const index = new ChildScopeIndex(() => next++);
  const winA = { tag: 'A' };
  const hostA = { nodeType: 1, isConnected: true, localName: 'iframe', contentWindow: winA };
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
  const hostA = { nodeType: 1, isConnected: true, localName: 'iframe', contentWindow: winA };
  const nodes = new Map<number, object>([[10, hostA]]);
  index.admit(10, hostA as never);
  index.drop(10);
  assert.strictEqual(index.hasContext(2), false);
  assert.strictEqual(index.windowOf(2, (id) => nodes.get(id) as never), null);
}

/** After iframe nav, contentWindow identity changes — WeakMap must rebind via windowOf / lookup. */
function testChildScopeRebindsWindowAfterReplace(): void {
  let next = 2;
  const index = new ChildScopeIndex(() => next++);
  const winOld = { tag: 'old' };
  const winNew = { tag: 'new' };
  const hostA = { nodeType: 1, isConnected: true, localName: 'iframe', contentWindow: winOld as object | null };
  const nodes = new Map<number, object>([[10, hostA]]);
  index.admit(10, hostA as never);

  hostA.contentWindow = winNew;
  assert.strictEqual(index.windowOf(2, (id) => nodes.get(id) as never), winNew);
  assert.strictEqual(index.lookupByContentWindow(winNew, (id) => nodes.get(id) as never), 2);
  // Stale WeakMap key must not win once reverse index is live for the new window.
  assert.strictEqual(index.lookupByContentWindow(winOld, (id) => nodes.get(id) as never), undefined);
}

/**
 * Unicast resolves the target through the live child fabric, never a DOM scan — and lands on that
 * child's MessagePort (`portCarrier.unit.ts` covers the handshake itself).
 */
async function testBusUnicastUsesFabricNotQuerySelector(): Promise<void> {
  let queryCalls = 0;
  const received: BusEnvelope[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const childWin = {
    postMessage: (_data: unknown, _origin: string, transfer?: unknown[]) => {
      const port = (transfer?.[0] ?? null) as { onmessage: unknown } | null;
      if (port === null) return;
      port.onmessage = (event: { data: unknown }) => {
        received.push(event.data as BusEnvelope);
      };
    },
  };
  const win = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (_type: string, fn: (event: unknown) => void) => {
      listeners.delete(fn);
    },
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
    windowOf: (id: number) => (id === 7 ? childWin : null),
    forEachLive: (fn: (w: unknown, contextId: number) => void) => fn(childWin, 7),
  } as never);
  bus.setDeliverableCheck((id) => id === 1 || id === 7);

  // The child opens its channel; the parent transfers the port back through postMessage.
  for (const fn of [...listeners]) {
    fn({ data: { channel: CONTEXT_BUS_CHANNEL, kind: 'port-setup' }, source: childWin });
  }

  bus.emit('telemetry', { kind: 'ping' }, { destination: 7 });
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 1));

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
    windowOf: (_id: number) => null,
    forEachLive: (_fn: (w: unknown, contextId: number) => void) => undefined,
  } as never);
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
