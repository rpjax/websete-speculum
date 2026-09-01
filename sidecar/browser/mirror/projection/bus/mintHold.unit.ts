/**
 * Mint cardinality + frame hold — runtime-redesign.md §0 #4 / §6 "Mint granularity".
 *
 * Two rules, both load-bearing for depth >= 2:
 *   1. **Exactly one id per RPC.** Block allocation is rejected — an id the parent never issued is
 *      not an address, so the port must not hand out a second id from one answer.
 *   2. **No frame while a nested-host mint is pending.** Emitting the tick anyway ships a frame
 *      whose nested host is simply absent, which is the K4 hole that made depth >= 2 look broken.
 *      Waiting is the protocol.
 */

import assert from 'assert';
import { ChildScopeIndex, createMintPort } from '@speculum/page-projection/virtual/dom/childScopes';
import { FrameEmitter } from '@speculum/page-projection/virtual/frame/frameEmitter';
import { createFrame, DOCUMENT_ID, type Frame } from '@speculum/page-projection/core';
import { OpCode } from '@speculum/page-projection/core/opcodes';
import type {
  FrameBuilder,
  FrameBuilderContext,
} from '@speculum/page-projection/virtual/frame/frameBuilder';

export async function runMintHoldUnitTests(): Promise<void> {
  await testOneIdPerRpc();
  await testPendingAdmitIsNotAnId();
  await testHeldFrameConsumesNoSequenceThenEmits();
  testResyncRequestStaysArmedWhileHeld();
  console.log('[unit] mint 1/RPC + frame hold ok');
}

/** One answer = one id. The second `take()` must start a *new* RPC, not reuse a cached block. */
async function testOneIdPerRpc(): Promise<void> {
  let rpcs = 0;
  let next = 2;
  const port = createMintPort({
    requestMint: async () => {
      rpcs += 1;
      return next++;
    },
  });

  assert.strictEqual(port(), null, 'first take opens the RPC and answers null');
  await port.whenSettled();
  assert.strictEqual(port(), 2);
  assert.strictEqual(rpcs, 1);

  assert.strictEqual(port(), null, 'the granted id is consumed — no second id from one RPC');
  await port.whenSettled();
  assert.strictEqual(port(), 3);
  assert.strictEqual(rpcs, 2, 'exactly one RPC per id');
}

/** A pending mint must surface as `pending`, never as a fabricated contextId. */
async function testPendingAdmitIsNotAnId(): Promise<void> {
  const gate: { resolve: (id: number) => void } = { resolve: () => {} };
  const port = createMintPort({
    requestMint: () =>
      new Promise<number>((resolve) => {
        gate.resolve = resolve;
      }),
  });
  const index = new ChildScopeIndex(port);
  const host = {
    nodeType: 1,
    isConnected: true,
    localName: 'iframe',
    contentWindow: { tag: 'child' },
  };

  assert.strictEqual(index.admit(10, host as never).kind, 'pending');
  assert.strictEqual(index.hasContext(2), false, 'nothing may be indexed while pending');

  gate.resolve(2);
  await port.whenSettled();

  const admitted = index.admit(10, host as never);
  assert.strictEqual(admitted.kind, 'host');
  if (admitted.kind === 'host') assert.strictEqual(admitted.contextId, 2);
}

/**
 * The pipe contract behind the hold: a builder that answers `null` because it is holding must not
 * consume a sequence number, and the emitter must come back for it without new mutations.
 */
async function testHeldFrameConsumesNoSequenceThenEmits(): Promise<void> {
  let mintPending = true;
  let buildCalls = 0;
  // The real builder carries the withheld ops, so it keeps reporting held work until it emits.
  let heldWork = false;
  const builder: FrameBuilder = {
    build: (_records: never[], ctx: FrameBuilderContext): Frame | null => {
      buildCalls += 1;
      if (mintPending) {
        heldWork = true;
        return null;
      }
      heldWork = false;
      return createFrame({
        generation: ctx.generation,
        sequence: ctx.sequence,
        ops: [{ op: OpCode.NodeDrop, ids: [] }],
        preTableHash: 0n,
      });
    },
    hasHeldWork: () => heldWork,
  };

  // Mutations arrived on the first tick and were drained into the held build.
  let bufferWork = true;
  const sent: Uint8Array[] = [];
  const emitter = new FrameEmitter({
    clock: { start: () => {}, stop: () => {}, rateHz: 60, setRate: () => {} } as never,
    buffer: {
      hasWork: () => bufferWork,
      drain: () => {
        bufferWork = false;
        return [];
      },
      reclaim: () => {},
    } as never,
    builder,
    encoder: { encode: () => [new Uint8Array([1])] } as never,
    transport: {
      send: (bytes: Uint8Array) => {
        sent.push(bytes);
        return 'sent' as const;
      },
    } as never,
    census: () => ({ generation: 1, tableSize: 0, identitySize: 0 }),
  });

  emitter.flushNow();
  assert.strictEqual(buildCalls, 1);
  assert.strictEqual(emitter.currentSequence, 0, 'a held tick consumes no sequence');
  assert.strictEqual(sent.length, 0, 'nothing may go out while the host has no id');

  // No new mutations — only the held work. The pipe must still give it a boundary.
  mintPending = false;
  emitter.flushNow();
  assert.strictEqual(buildCalls, 2, 'held work must get a boundary with no new mutations');
  assert.strictEqual(emitter.currentSequence, 1, 're-drive emits once the id exists');
  assert.strictEqual(sent.length, 1);
}

/**
 * A resync frame *is* the surface — shipping it with a host omitted would establish a hole. The
 * request must stay armed and rebuild, not be dropped.
 */
function testResyncRequestStaysArmedWhileHeld(): void {
  let mintPending = true;
  let builds = 0;
  const sent: Uint8Array[] = [];
  const emitter = new FrameEmitter({
    clock: { start: () => {}, stop: () => {}, rateHz: 60, setRate: () => {} } as never,
    buffer: { hasWork: () => false, drain: () => [], reclaim: () => {} } as never,
    builder: { build: () => null } as never,
    encoder: { encode: () => [new Uint8Array([1])] } as never,
    transport: {
      send: (bytes: Uint8Array) => {
        sent.push(bytes);
        return 'sent' as const;
      },
    } as never,
    census: () => ({ generation: 1, tableSize: 0, identitySize: 0 }),
  });

  emitter.requestResync((seq) => {
    builds += 1;
    if (mintPending) return null;
    return createFrame({
      generation: 1,
      sequence: seq,
      ops: [{ op: OpCode.Check, scope: 0, lo: 0, hi: 0, hash: 0n }],
      preTableHash: 0n,
      resync: true,
      contextId: DOCUMENT_ID,
    });
  });

  emitter.flushNow();
  assert.strictEqual(builds, 1);
  assert.strictEqual(sent.length, 0, 'incomplete resync must not be emitted');
  assert.strictEqual(emitter.currentSequence, 0);

  mintPending = false;
  emitter.flushNow();
  assert.strictEqual(builds, 2, 'the request stayed armed and rebuilt');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(emitter.currentSequence, 1);
}
