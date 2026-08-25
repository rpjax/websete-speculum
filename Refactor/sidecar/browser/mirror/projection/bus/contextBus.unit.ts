/**
 * ContextBus unit tests — CB-01…CB-13 coverage.
 */

import assert from 'assert';
import { ContextBus } from '@speculum/page-projection/virtual/bus/contextBus';
import { VirtualDomainBus } from '@speculum/page-projection/virtual/bus/virtualDomainBus';
import { CONTEXT_BUS_RUNTIME } from '@speculum/page-projection/core/contextBusConstants';
import type { BusEnvelope } from '@speculum/page-projection/virtual/bus/types';

export async function runContextBusUnitTests(): Promise<void> {
  testEmitRequiresDestination();
  testEmitBroadcastExcludesSelf();
  testPublishControlInputUnicastToSelf();
  testProvisionalSourceEnvelopeAccepted();
  testInvokeUnicastRejectsBroadcast();
  await testLocalInvokeShortCircuit();
  await testNoHandlerResponse();
  await testInvocationIdMonotonic();
  await testDisposeRejectsPending();
  testNonCloneableThrows();
  await testSecondOnInvocationReplaces();
  console.log('ContextBus unit tests OK');
}

function testEmitRequiresDestination(): void {
  const sent: BusEnvelope[] = [];
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: (e) => sent.push(e) },
  });
  assert.throws(() => bus.emit('evt', {}, {} as never), TypeError);
  bus.emit('evt', { a: 1 }, { destination: 2 });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0]!.destination, 2);
  bus.dispose();
}

function testEmitBroadcastExcludesSelf(): void {
  let local = 0;
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => {} },
  });
  bus.onEvent('evt', () => {
    local += 1;
  });
  bus.emit('evt', {}, { destination: '*' });
  assert.strictEqual(local, 0);
  bus.dispose();
}

function testPublishControlInputUnicastToSelf(): void {
  let applied = false;
  const win = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: { querySelectorAll: () => [] },
  };
  const bus = new VirtualDomainBus({
    window: win as never,
    role: 'root',
    contextId: 1,
    servesRuntime: true,
    mint: () => 2,
  });
  bus.setMine(1);
  bus.onControlInput((req) => {
    if (req.contextId === 1 && req.intentType === 'input') applied = true;
  });
  bus.publishControlInput({ contextId: 1, intentType: 'input', nodeId: 1 });
  assert.strictEqual(applied, true, 'root Mode B control must apply on publisher context');
  bus.dispose();
}

function testProvisionalSourceEnvelopeAccepted(): void {
  const { isMalformedEnvelope } = require('@speculum/page-projection/virtual/bus/types') as {
    isMalformedEnvelope: (d: unknown) => boolean;
    CONTEXT_BUS_CHANNEL: string;
  };
  const { CONTEXT_BUS_CHANNEL, CONTEXT_BUS_RUNTIME } = require(
    '@speculum/page-projection/core/contextBusConstants',
  ) as { CONTEXT_BUS_CHANNEL: string; CONTEXT_BUS_RUNTIME: number };
  const req = {
    channel: CONTEXT_BUS_CHANNEL,
    source: 0,
    destination: CONTEXT_BUS_RUNTIME,
    type: 'request-invocation',
    event: { invocationId: 1, name: 'getScopeId', args: {} },
  };
  const res = {
    channel: CONTEXT_BUS_CHANNEL,
    source: 1,
    destination: 0,
    type: 'invocation-response',
    event: { invocationId: 1, result: 2 },
  };
  assert.strictEqual(isMalformedEnvelope(req), false, 'provisional source request must parse');
  assert.strictEqual(isMalformedEnvelope(res), false, 'provisional dest response must parse');
}

function testInvokeUnicastRejectsBroadcast(): void {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => {} },
  });
  assert.throws(
    () => bus.invoke('x', {}, { destination: '*' as never }),
    TypeError,
  );
  assert.throws(
    () => bus.invoke('x', {}, { destination: -1 }),
    TypeError,
  );
  bus.dispose();
}

function testLocalInvokeShortCircuit(): Promise<void> {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => assert.fail('carrier should not be used') },
  });
  bus.onInvocation('ping', () => 42);
  return bus.invoke<Record<string, never>, number>('ping', {}, { destination: CONTEXT_BUS_RUNTIME }).then((r) => {
    assert.strictEqual(r.ok, true);
    if (r.ok) assert.strictEqual(r.value, 42);
    bus.dispose();
  });
}

function testNoHandlerResponse(): Promise<void> {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => {} },
  });
  return bus.invoke('missing', {}, { destination: CONTEXT_BUS_RUNTIME }).then((r) => {
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.error.message, 'no_handler');
    bus.dispose();
  });
}

function testInvocationIdMonotonic(): Promise<void> {
  const sent: BusEnvelope[] = [];
  let src!: ContextBus;
  const dest = new ContextBus({
    contextId: 2,
    servesRuntime: false,
    carrier: {
      send: (e) => src.receive(e),
    },
  });
  dest.onInvocation('echo', (args: { v: string }) => args.v);

  src = new ContextBus({
    contextId: 1,
    servesRuntime: false,
    carrier: {
      send: (e) => {
        sent.push(e);
        dest.receive(e);
      },
    },
  });

  return src.invoke<{ v: string }, string>('echo', { v: 'hi' }, { destination: 2, timeoutMs: 500 }).then((r) => {
    assert.strictEqual(r.ok, true);
    if (r.ok) assert.strictEqual(r.value, 'hi');
    const req = sent.find((e) => e.type === 'request-invocation');
    assert.ok(req);
    assert.strictEqual((req!.event as { invocationId: number }).invocationId, 1);
    src.dispose();
    dest.dispose();
  });
}

function testDisposeRejectsPending(): Promise<void> {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: false,
    carrier: { send: () => {} },
  });
  const p = bus.invoke('x', {}, { destination: 2 });
  bus.dispose();
  return p.then((r) => {
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.error.name, 'BusDisposed');
  });
}

function testNonCloneableThrows(): void {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => {} },
  });
  const fn = (): void => {};
  assert.throws(() => bus.emit('evt', fn, { destination: 1 }), /clone|JSON/i);
  bus.dispose();
}

function testSecondOnInvocationReplaces(): Promise<void> {
  const bus = new ContextBus({
    contextId: 1,
    servesRuntime: true,
    carrier: { send: () => {} },
  });
  bus.onInvocation('x', () => 1);
  bus.onInvocation('x', () => 2);
  return bus.invoke<Record<string, never>, number>('x', {}, { destination: CONTEXT_BUS_RUNTIME }).then((r) => {
    assert.strictEqual(r.ok, true);
    if (r.ok) assert.strictEqual(r.value, 2);
    bus.dispose();
  });
}
