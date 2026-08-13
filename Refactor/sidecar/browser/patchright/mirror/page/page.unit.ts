import assert from 'assert';
import { IdentitySpace, NONE_NODE_ID } from './identity';
import {
  isPlaceholderTag,
  publishElementSnapshot,
  stripDeniedAttrs,
  PROJECTED_TAG_ATTR,
  STATE_ATTR_KEYS,
  type FNode,
} from './fmap';
import {
  createDirtyState,
  markMutation,
  markNewId,
  discardNonPublished,
  VIEWPORT_SCROLL_TARGET,
} from './observe';
import { FrameAccumulator, type ChildRef, type FrameOp, type FrameTreeQuery } from './frame';
import { FrameClock, RATE_LADDER, type FrameClockScheduler } from './clock';
import { encodeFrame, DEFAULT_MAX_FRAME_BYTES, type WireOp } from './encode';
import { OpCode, opCodePlane } from './opcodes';
import {
  EstablishChecksum,
  computeEstablishChecksum,
  createEstablishHandoff,
  openEstablishEpoch,
  accumulateDuringEstablish,
  markSnapshotTaken,
  drainForEmitAfterEnd,
  splitHtmlIntoChunks,
  buildEstablishBegin,
} from './establish';
import { CssomCoalescer, type CssomSheetDescriptor } from './cssom';
import { pushChunked, pushFrameParts, createBindingChannel } from './channel';
import { NodeMirror, MirrorDesyncError } from './node/mirror';
import { UrlRewriter } from './node/rewrite';
import { EventBridge } from '../../../../host/EventBridge';
import { runCdpPierceUnit } from './cdpPierce.unit';
import { AssetPriorityQueue } from './assetPriority';
import { splitCssTopLevelRules } from './cssomCdp';

import { runPageProjectionWireUnitTests } from './page.unit.wire';

// ------------------------------------------------------------ identity.ts

function testIdentitySpaceAllocateResolveRelease(): void {
  const space = new IdentitySpace<{ tag: string }>();
  const a = { tag: 'a' };
  const b = { tag: 'b' };
  const idA = space.allocate(a);
  const idB = space.allocate(b);
  assert.strictEqual(idA, 1);
  assert.strictEqual(idB, 2);
  assert.strictEqual(space.allocate(a), idA, 'allocate is idempotent for a known node');
  assert.strictEqual(space.idOf(a), idA);
  assert.strictEqual(space.resolve(idA), a);
  assert.strictEqual(space.resolve(NONE_NODE_ID), undefined, '0 never resolves');
  assert.strictEqual(space.resolve(999), undefined, 'unknown id never resolves');

  const clone = { tag: 'a' };
  assert.strictEqual(space.idOf(clone), NONE_NODE_ID, 'a distinct object has no id (PP-ID-2)');
  const idClone = space.allocate(clone);
  assert.notStrictEqual(idClone, idA, 'cloning yields a distinct id — never a duplicate');

  space.release(b);
  assert.strictEqual(space.idOf(b), NONE_NODE_ID);
  assert.strictEqual(space.resolve(idB), undefined);
  console.log('[unit] page/identity allocate/resolve/release ok');
}

function testIdentitySpaceGenerationBump(): void {
  const space = new IdentitySpace<{ tag: string }>();
  const a = { tag: 'a' };
  const idA = space.allocate(a);
  assert.strictEqual(space.generation, 1);
  const gen2 = space.bumpGeneration();
  assert.strictEqual(gen2, 2);
  assert.strictEqual(space.reverseSize, 0, 'bump releases the reverse map (PP-ID-4)');
  assert.strictEqual(space.resolve(idA), undefined, 'a pre-bump id never resolves after bump');
  const b = { tag: 'b' };
  const idB = space.allocate(b);
  assert.notStrictEqual(idB, idA, 'ids are never reused across a generation bump');
  console.log('[unit] page/identity generation bump ok');
}

// ------------------------------------------------------------ fmap.ts

function testFmapPlaceholderAndDenyList(): void {
  assert.strictEqual(isPlaceholderTag('SCRIPT'), true);
  assert.strictEqual(isPlaceholderTag('iframe'), true);
  assert.strictEqual(isPlaceholderTag('div'), false);

  const attrs = stripDeniedAttrs([
    ['onclick', 'alert(1)'],
    ['href', 'javascript:alert(1)'],
    ['integrity', 'sha256-x'],
    ['class', 'ok'],
  ]);
  assert.deepStrictEqual(attrs, { class: 'ok' });

  const scriptSnapshot = publishElementSnapshot({
    id: 5,
    rawTag: 'SCRIPT',
    rawAttrs: [['src', '/a.js']],
    children: [{ kind: 'text', id: 6, value: 'ignored' }],
  });
  assert.strictEqual(scriptSnapshot.tag, 'div', 'placeholder rewrites to a safe host tag');
  assert.strictEqual(scriptSnapshot.attrs[PROJECTED_TAG_ATTR], 'script');
  assert.deepStrictEqual(scriptSnapshot.children, [], 'non-iframe placeholder publishes empty interior (T13)');

  const iframeChild: FNode = { kind: 'text', id: 9, value: 'pierced' };
  const iframeSnapshot = publishElementSnapshot({
    id: 7,
    rawTag: 'iframe',
    rawAttrs: [],
    children: [iframeChild],
    iframeHost: true,
  });
  assert.deepStrictEqual(iframeSnapshot.children, [iframeChild], 'iframe keeps its pierced interior');
  console.log('[unit] page/fmap placeholder + deny-list ok');
}

function testFmapStateAttrs(): void {
  const snapshot = publishElementSnapshot({
    id: 1,
    rawTag: 'input',
    rawAttrs: [['type', 'checkbox']],
    children: [],
    state: { inputChecked: 'true' },
  });
  assert.strictEqual(snapshot.attrs[STATE_ATTR_KEYS.inputChecked], 'true');
  console.log('[unit] page/fmap state attrs ok');
}

// ------------------------------------------------------------ observe.ts

function testObserveDirtyStateAndMutations(): void {
  const identity = new IdentitySpace<{ id: number }>();
  const parent = { id: 1 };
  const child = { id: 2 };
  identity.allocate(parent);
  identity.allocate(child);

  const state = createDirtyState();
  markMutation(state, identity, { type: 'childList', target: parent });
  markMutation(state, identity, { type: 'attributes', target: child });
  markMutation(state, identity, { type: 'characterData', target: { id: 99 } }); // never published
  assert.strictEqual(state.dirtyParents.has(identity.idOf(parent)), true);
  assert.strictEqual(state.attrDirty.has(identity.idOf(child)), true);
  assert.strictEqual(state.textDirty.size, 0, 'a record for an unpublished node is discarded (PP-FR-5)');

  assert.strictEqual(discardNonPublished(parent, () => false), true);
  assert.strictEqual(discardNonPublished(parent, () => true), false);

  markNewId(state, 42);
  assert.ok(state.newIds.has(42));
  assert.strictEqual(state.scrollDirty.size, 0);
  assert.strictEqual(VIEWPORT_SCROLL_TARGET, 0);
  console.log('[unit] page/observe dirty state + mutations ok');
}

// ------------------------------------------------------------ frame.ts

type TestNode = { id: number; connected: boolean; parentId: number | null };

function buildTestQuery(
  nodes: Map<number, TestNode>,
  overrides: {
    childList?: Map<number, ChildRef[]>;
    fullSnapshot?: Map<number, FNode>;
  } = {},
): FrameTreeQuery<TestNode> {
  function ancestorsOf(id: number): number[] {
    const chain: number[] = [];
    let cur = nodes.get(id);
    while (cur) {
      chain.push(cur.id);
      cur = cur.parentId !== null ? nodes.get(cur.parentId) : undefined;
    }
    return chain;
  }
  return {
    isConnected: (node) => node.connected,
    resolve: (id) => nodes.get(id),
    isWithin: (id, ancestors) => ancestorsOf(id).some((a) => ancestors.has(a)),
    childListSnapshot: (parentId) => overrides.childList?.get(parentId),
    fullSnapshot: (id) => overrides.fullSnapshot?.get(id) ?? { kind: 'text', id, value: `v${id}` },
    compareDocumentOrder: (a, b) => a - b,
  };
}

function testFrameAccumulatorPruneEphemeral(): void {
  const nodes = new Map<number, TestNode>([[10, { id: 10, connected: false, parentId: null }]]);
  const acc = new FrameAccumulator(buildTestQuery(nodes));
  const dirty = createDirtyState();
  markNewId(dirty, 10);
  dirty.attrDirty.add(10);
  acc.absorb(dirty);
  const ops = acc.flush();
  assert.strictEqual(ops, null, 'a node created and destroyed within the frame is never sent (PP-FR-1)');
  console.log('[unit] page/frame prune ephemeral ok');
}

function testFrameAccumulatorAbsorbDescendants(): void {
  const nodes = new Map<number, TestNode>([
    [1, { id: 1, connected: true, parentId: null }],
    [10, { id: 10, connected: true, parentId: 1 }],
    [11, { id: 11, connected: true, parentId: 10 }],
  ]);
  const freshChild: FNode = { kind: 'element', id: 10, tag: 'div', attrs: {}, children: [] };
  const childList = new Map<number, ChildRef[]>([[1, [{ kind: 'fresh', node: freshChild }]]]);
  const acc = new FrameAccumulator(buildTestQuery(nodes, { childList }));
  const dirty = createDirtyState();
  markNewId(dirty, 10);
  dirty.dirtyParents.add(1);
  dirty.attrDirty.add(11); // descendant of the newly created 10 — must be absorbed, not patched separately.
  acc.absorb(dirty);
  const ops = acc.flush() as FrameOp[];
  assert.ok(ops, 'expected ops');
  assert.strictEqual(ops.length, 1, 'a new subtree yields exactly one childList entry, not a patch per node (PP-FR-2)');
  assert.strictEqual(ops[0]!.op, 'childList');
  console.log('[unit] page/frame absorb descendants ok');
}

function testFrameAccumulatorPatchCoalesce(): void {
  const nodes = new Map<number, TestNode>([[5, { id: 5, connected: true, parentId: null }]]);
  const acc = new FrameAccumulator(buildTestQuery(nodes));
  const dirty = createDirtyState();
  dirty.attrDirty.add(5);
  dirty.textDirty.add(5);
  dirty.stateDirty.add(5);
  acc.absorb(dirty);
  const ops = acc.flush() as FrameOp[];
  assert.strictEqual(ops.length, 1, 'N writes to one node within a frame produce exactly one patch (PP-FR-3)');
  assert.strictEqual(ops[0]!.op, 'patch');
  console.log('[unit] page/frame patch coalesce ok');
}

function testFrameAccumulatorAppendMode(): void {
  const nodes = new Map<number, TestNode>([[1, { id: 1, connected: true, parentId: null }]]);
  const existingRefs = (ids: number[]): ChildRef[] => ids.map((id) => ({ kind: 'existing', id }) as ChildRef);

  const childListRound1 = new Map<number, ChildRef[]>([[1, existingRefs([2, 3])]]);
  const acc = new FrameAccumulator(buildTestQuery(nodes, { childList: childListRound1 }));
  const dirty1 = createDirtyState();
  dirty1.dirtyParents.add(1);
  acc.absorb(dirty1);
  const ops1 = acc.flush() as FrameOp[];
  assert.strictEqual(ops1[0]!.op, 'childList');
  assert.strictEqual((ops1[0] as { mode: string }).mode, 'full', 'first emission for a parent is always FULL');

  const childListRound2 = new Map<number, ChildRef[]>([[1, existingRefs([2, 3, 4])]]);
  const acc2Query = buildTestQuery(nodes, { childList: childListRound2 });
  // Swap in round-2 fixtures on the same instance so its append-cache (populated by round 1) is exercised.
  (acc as unknown as { query: FrameTreeQuery<TestNode> }).query = acc2Query;
  const dirty2 = createDirtyState();
  dirty2.dirtyParents.add(1);
  acc.absorb(dirty2);
  const ops2 = acc.flush() as FrameOp[];
  assert.strictEqual(ops2.length, 1);
  const op2 = ops2[0] as { mode: string; children: ChildRef[] };
  assert.strictEqual(op2.mode, 'append', 'a pure suffix addition uses the APPEND fast path (§5.4.2)');
  assert.strictEqual(op2.children.length, 1);
  console.log('[unit] page/frame append fast path ok');
}

// ------------------------------------------------------------ clock.ts

function fakeScheduler(): FrameClockScheduler & { pendingCallback: (() => void) | null; advance(ms: number): void } {
  let now = 0;
  let cb: (() => void) | null = null;
  return {
    setInterval(callback) {
      cb = callback;
      return 1;
    },
    clearInterval() {
      cb = null;
    },
    now() {
      return now;
    },
    get pendingCallback() {
      return cb;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

function testFrameClockDegradeAndRecover(): void {
  const scheduler = fakeScheduler();
  const clock = new FrameClock({ scheduler, onTick: () => {}, rateRecoverMs: 1000 });
  assert.strictEqual(clock.rateHz, 60);
  clock.degrade();
  assert.strictEqual(clock.rateHz, 30, 'first degrade steps to the next ladder rung');
  clock.degrade();
  assert.strictEqual(clock.rateHz, 15);
  assert.strictEqual(clock.recoverStep(), false, 'recovery is throttled before rateRecoverMs elapses');
  scheduler.advance(1000);
  assert.strictEqual(clock.recoverStep(), true);
  assert.strictEqual(clock.rateHz, 30, 'recovery is one ladder step at a time');
  assert.deepStrictEqual([...RATE_LADDER], [60, 30, 15, 5]);
  clock.setHidden(true);
  assert.strictEqual(clock.rateHz, 1, 'a hidden report collapses to hiddenRateHz');
  clock.setHidden(false);
  assert.strictEqual(clock.rateHz, 60, 'becoming visible recovers straight to the top rate');
  console.log('[unit] page/clock degrade + recover ok');
}

function testFrameClockStallWatchdog(): void {
  const scheduler = fakeScheduler();
  let stalls = 0;
  let ticks = 0;
  const clock = new FrameClock({
    scheduler,
    onTick: () => { ticks += 1; },
    onStall: () => { stalls += 1; },
    frameStallMs: 1000,
  });
  assert.strictEqual(clock.checkStall(), false, 'no stall immediately after construction');
  scheduler.advance(1500);
  assert.strictEqual(clock.checkStall(), true, 'a stalled clock is detected and force-ticked (PP-FR-7)');
  assert.strictEqual(stalls, 1);
  assert.strictEqual(ticks, 1);
  console.log('[unit] page/clock stall watchdog ok');
}

// ------------------------------------------------------------ encode.ts

export async function runPageProjectionUnitTests(): Promise<void> {
  testIdentitySpaceAllocateResolveRelease();
  testIdentitySpaceGenerationBump();
  testFmapPlaceholderAndDenyList();
  testFmapStateAttrs();
  testObserveDirtyStateAndMutations();
  testFrameAccumulatorPruneEphemeral();
  testFrameAccumulatorAbsorbDescendants();
  testFrameAccumulatorPatchCoalesce();
  testFrameAccumulatorAppendMode();
  testFrameClockDegradeAndRecover();
  testFrameClockStallWatchdog();
  runPageProjectionWireUnitTests();
  runCdpPierceUnit();
  console.log('[unit] page/* PageProjection producer modules all passed');
}
