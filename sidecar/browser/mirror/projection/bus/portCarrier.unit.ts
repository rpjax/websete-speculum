/**
 * ContextBus MessagePort carrier — runtime-redesign.md §0 #1/#5 and §8.
 *
 * Proves the four normative properties of the parent↔child edge: the two-message port setup, that
 * directed traffic rides the port and never `postMessage(envelope, '*')`, that inner navigation
 * closes the dead install's port, and that a child which asks before its parent can answer is
 * queued rather than failed. Plus the identity answer itself: `initContext` states
 * `{ contextId, generation }`, one new generation per install at the same address.
 */

import assert from 'assert';
import { VirtualDomainBus } from '@speculum/page-projection/virtual/bus/virtualDomainBus';
import { CONTEXT_ID_PROVISIONAL } from '@speculum/page-projection/core/contextBusConstants';
import { CONTEXT_BUS_CHANNEL } from '@speculum/page-projection/virtual/bus/types';

type FakeWindow = {
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  fire: (event: { data: unknown; source?: unknown; ports?: unknown[] }) => void;
};

type Edge = {
  parentWin: FakeWindow;
  childWin: FakeWindow;
  /** What the parent sees as `event.source` / posts the ack to. */
  childProxy: { postMessage: (data: unknown, origin: string, transfer?: unknown[]) => void };
  parentProxy: { postMessage: (data: unknown, origin: string) => void };
  toChild: unknown[];
  toParent: unknown[];
};

function makeWindow(): FakeWindow {
  const listeners = new Set<(event: unknown) => void>();
  return {
    addEventListener: (type, fn) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (_type, fn) => {
      listeners.delete(fn);
    },
    fire: (event) => {
      for (const fn of [...listeners]) fn(event);
    },
  };
}

function makeEdge(): Edge {
  const parentWin = makeWindow();
  const childWin = makeWindow();
  const toChild: unknown[] = [];
  const toParent: unknown[] = [];

  const childProxy = {
    postMessage: (data: unknown, _origin: string, transfer?: unknown[]) => {
      toChild.push(data);
      childWin.fire({ data, source: parentProxy, ports: transfer ?? [] });
    },
  };
  const parentProxy = {
    postMessage: (data: unknown, _origin: string) => {
      toParent.push(data);
      parentWin.fire({ data, source: childProxy });
    },
  };

  return { parentWin, childWin, childProxy, parentProxy, toChild, toParent };
}

function makeParent(edge: Edge): VirtualDomainBus {
  return new VirtualDomainBus({
    window: edge.parentWin as never,
    role: 'root',
    contextId: 1,
    servesRuntime: true,
  });
}

function makeChild(edge: Edge): VirtualDomainBus {
  return new VirtualDomainBus({
    window: edge.childWin as never,
    parent: edge.parentProxy as never,
    role: 'nested',
    contextId: CONTEXT_ID_PROVISIONAL,
  });
}

/** Ports deliver on a macrotask; give the channel a few turns. */
async function beat(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 1));
}

function isSetupKind(data: unknown, kind: string): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { channel?: unknown; kind?: unknown };
  return msg.channel === CONTEXT_BUS_CHANNEL && msg.kind === kind;
}

type Identity = { contextId: number; generation: number };

function assertValidIdentity(
  identity: Identity | null | undefined,
  expectedContextId: number,
): asserts identity is Identity {
  assert.ok(identity, 'initContext must answer');
  assert.strictEqual(identity.contextId, expectedContextId);
  assert.ok(
    Number.isInteger(identity.generation) && identity.generation >= 1,
    `generation must be integer >= 1, got ${String(identity.generation)}`,
  );
}

/** Monotonic, never reused — property of authority mint (not a magic expected value). */
function assertStrictlyIncreasingUnique(gens: number[]): void {
  const seen = new Set<number>();
  let prev = 0;
  for (const g of gens) {
    assert.ok(g > prev, `monotonic: ${g} must be > ${prev}`);
    assert.ok(!seen.has(g), `never reused: ${g}`);
    seen.add(g);
    prev = g;
  }
}

export async function runPortCarrierUnitTests(): Promise<void> {
  await testPortSetupAnswersInitContext();
  await testDirectedTrafficNeverUsesWindowBroadcast();
  await testInnerNavClosesOldPort();
  await testChildAsksBeforeParentCanAnswer();
  await testGenerationIsPerInstall();
  await testRootReinstallDoesNotResetNestedGeneration();
  await testOpenPlusInvokePostsOneSetupWhenAckIsAsync();
  console.log('[unit] ContextBus MessagePort carrier ok');
}

/** §8 steps 1–3: one setup message each way, then identity is answered over the port. */
async function testPortSetupAnswersInitContext(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  const child = makeChild(edge);
  parent.setScopeLookup((source) => (source === (edge.childProxy as never) ? 7 : undefined));

  child.openUpwardChannel();
  const identity = await child.requestInitContext(1_000);

  assertValidIdentity(identity, 7);
  assert.strictEqual(edge.toParent.length, 1, 'child posts exactly one setup datagram');
  assert.ok(isSetupKind(edge.toParent[0], 'port-setup'));
  assert.strictEqual(edge.toChild.length, 1, 'parent answers with exactly one ack');
  assert.ok(isSetupKind(edge.toChild[0], 'port-setup-ack'));

  child.dispose();
  parent.dispose();
}

/**
 * §0 #4: no broadcast for directed traffic. Once the port exists, a parent→child unicast must
 * appear on the port and leave `window.postMessage` untouched.
 */
async function testDirectedTrafficNeverUsesWindowBroadcast(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  const child = makeChild(edge);
  parent.setScopeLookup(() => 7);

  child.openUpwardChannel();
  const firstId = await child.requestInitContext(1_000);
  assertValidIdentity(firstId, 7);
  child.setMine(7);

  const windowMessagesBefore = edge.toChild.length;
  const seen: unknown[] = [];
  child.onEvent('telemetry', (event) => {
    seen.push(event);
  });

  parent.emit('telemetry', { kind: 'ping' }, { destination: 7 });
  await beat();

  assert.deepStrictEqual(seen, [{ kind: 'ping' }], 'unicast must arrive over the port');
  assert.strictEqual(
    edge.toChild.length,
    windowMessagesBefore,
    'a bus envelope must never go through window.postMessage',
  );

  // Broadcast is an addressing mode, not a transport mode: still one write per held port.
  parent.emit('telemetry', { kind: 'all' }, { destination: '*' });
  await beat();
  assert.deepStrictEqual(seen[1], { kind: 'all' });
  assert.strictEqual(edge.toChild.length, windowMessagesBefore);

  child.dispose();
  parent.dispose();
}

/** §8 step 4: a second setup from the same browsing context fences the dead install's port. */
async function testInnerNavClosesOldPort(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  parent.setScopeLookup(() => 7);

  const firstChild = makeChild(edge);
  firstChild.openUpwardChannel();
  const firstId = await firstChild.requestInitContext(1_000);
  assertValidIdentity(firstId, 7);
  firstChild.setMine(7);

  const onFirst: unknown[] = [];
  firstChild.onEvent('telemetry', (event) => {
    onFirst.push(event);
  });

  // The replacement install of the same iframe: same WindowProxy, new port setup.
  const secondChild = makeChild(edge);
  secondChild.openUpwardChannel();
  const secondId = await secondChild.requestInitContext(1_000);
  assertValidIdentity(secondId, 7);
  assert.ok(
    secondId.generation > firstId.generation,
    'new install at same address must mint a strictly greater generation',
  );
  secondChild.setMine(7);

  const onSecond: unknown[] = [];
  secondChild.onEvent('telemetry', (event) => {
    onSecond.push(event);
  });

  parent.emit('telemetry', { kind: 'after-nav' }, { destination: 7 });
  await beat();

  assert.deepStrictEqual(onSecond, [{ kind: 'after-nav' }], 'live install receives');
  assert.deepStrictEqual(onFirst, [], 'dead install must be fenced off — its port was closed');

  firstChild.dispose();
  secondChild.dispose();
  parent.dispose();
}

/**
 * §0 #5 / §5: the listener is up before the parent can answer, and the request **queues**. A lost
 * request is a permanently dormant context, so this is the difference between working and not.
 */
async function testChildAsksBeforeParentCanAnswer(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  const child = makeChild(edge);

  let admitted = false;
  parent.setScopeLookup(() => (admitted ? 9 : undefined));

  child.openUpwardChannel();
  let settled: Identity | null | 'pending' = 'pending';
  const inflight = child.requestInitContext(3_000).then((value) => {
    settled = value;
  });

  await beat(20);
  assert.strictEqual(settled, 'pending', 'unanswerable request must wait, not fail');

  // Host row admitted — the queued question becomes answerable.
  admitted = true;
  parent.noteChildScopeChanged();
  await inflight;

  assert.ok(settled !== 'pending' && settled !== null, 'initContext must settle after admit');
  assertValidIdentity(settled, 9);

  child.dispose();
  parent.dispose();
}

/** §6: address stable; generation is which install — properties, not magic values. */
async function testGenerationIsPerInstall(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  parent.setScopeLookup(() => 7);

  const first = makeChild(edge);
  first.openUpwardChannel();
  const g0 = await first.requestInitContext(1_000);
  assertValidIdentity(g0, 7);
  // Same install / same port — retry must not consume another generation.
  const g0Retry = await first.requestInitContext(1_000);
  assertValidIdentity(g0Retry, 7);
  assert.strictEqual(g0Retry.generation, g0.generation, 'same-port retry is idempotent');

  const second = makeChild(edge);
  second.openUpwardChannel();
  const g1 = await second.requestInitContext(1_000);
  assertValidIdentity(g1, 7);
  assertStrictlyIncreasingUnique([g0.generation, g1.generation]);

  first.dispose();
  second.dispose();
  parent.dispose();
}

/**
 * Bug that packing papered over: parent bus survives a root document reinstall while a nested
 * address is still live. Nested mint must stay monotonic — never reset / collide.
 */
async function testRootReinstallDoesNotResetNestedGeneration(): Promise<void> {
  const edge = makeEdge();
  const parent = makeParent(edge);
  parent.setScopeLookup(() => 7);

  const childA = makeChild(edge);
  childA.openUpwardChannel();
  const before = await childA.requestInitContext(1_000);
  assertValidIdentity(before, 7);

  // Root document reinstall: parent VirtualDomainBus instance stays (session). Mint map
  // must not clear — there is no setRootGeneration pack hook anymore.
  const childB = makeChild(edge);
  childB.openUpwardChannel();
  const after = await childB.requestInitContext(1_000);
  assertValidIdentity(after, 7);
  assert.ok(
    after.generation > before.generation,
    `after root reinstall nested gen must be strictly greater (${after.generation} > ${before.generation})`,
  );

  const childC = makeChild(edge);
  childC.openUpwardChannel();
  const third = await childC.requestInitContext(1_000);
  assertValidIdentity(third, 7);
  assertStrictlyIncreasingUnique([before.generation, after.generation, third.generation]);

  // Independent contextId must not reset the other address's sequence.
  parent.setScopeLookup(() => 11);
  const other = makeChild(edge);
  other.openUpwardChannel();
  const otherId = await other.requestInitContext(1_000);
  assertValidIdentity(otherId, 11);
  assert.ok(otherId.generation >= 1);

  parent.setScopeLookup(() => 7);
  const childD = makeChild(edge);
  childD.openUpwardChannel();
  const cont = await childD.requestInitContext(1_000);
  assertValidIdentity(cont, 7);
  assert.ok(cont.generation > third.generation, 'context 7 mint unaffected by context 11');

  childA.dispose();
  childB.dispose();
  childC.dispose();
  other.dispose();
  childD.dispose();
  parent.dispose();
}

/**
 * Browser reality: `postMessage` ack is a macrotask, not sync. `openUpwardChannel` then
 * `requestInitContext` → `send` → `open` again must not emit a second setup — the parent would
 * treat it as inner-nav, close the first port, and drop the queued `initContext` (nested dormant).
 */
async function testOpenPlusInvokePostsOneSetupWhenAckIsAsync(): Promise<void> {
  const parentWin = makeWindow();
  const childWin = makeWindow();
  const toParent: unknown[] = [];
  const deferredAcks: Array<{ data: unknown; ports: unknown[] }> = [];

  const childProxy = {
    postMessage: (data: unknown, _origin: string, transfer?: unknown[]) => {
      deferredAcks.push({ data, ports: transfer ?? [] });
    },
  };
  const parentProxy = {
    postMessage: (data: unknown, _origin: string) => {
      toParent.push(data);
      parentWin.fire({ data, source: childProxy });
    },
  };

  const parent = new VirtualDomainBus({
    window: parentWin as never,
    role: 'root',
    contextId: 1,
    servesRuntime: true,
  });
  parent.setScopeLookup((source) => (source === (childProxy as never) ? 7 : undefined));

  const child = new VirtualDomainBus({
    window: childWin as never,
    parent: parentProxy as never,
    role: 'nested',
    contextId: CONTEXT_ID_PROVISIONAL,
  });

  child.openUpwardChannel();
  const identityP = child.requestInitContext(1_000);

  assert.strictEqual(toParent.length, 1, 'open+invoke must post exactly one setup before ack');
  assert.ok(isSetupKind(toParent[0], 'port-setup'));
  assert.strictEqual(deferredAcks.length, 1, 'parent accepted once');

  const ack = deferredAcks[0]!;
  childWin.fire({ data: ack.data, source: parentProxy, ports: ack.ports });

  const identity = await identityP;
  assertValidIdentity(identity, 7);
  assert.strictEqual(toParent.length, 1, 'no second setup after async ack');

  child.dispose();
  parent.dispose();
}
