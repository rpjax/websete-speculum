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
import { OpCode } from './opcodes';
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

function readWireHeader(bytes: Uint8Array): {
  magic: number;
  version: number;
  flags: number;
  generation: number;
  sequence: number;
  partIndex: number;
  partCount: number;
  strings: string[];
  opCount: number;
  firstOpCode: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = view.getUint16(o, true); o += 2;
  const version = view.getUint8(o); o += 1;
  const flags = view.getUint8(o); o += 1;
  const generation = view.getUint32(o, true); o += 4;
  const sequence = view.getUint32(o, true); o += 4;
  const partIndex = view.getUint16(o, true); o += 2;
  const partCount = view.getUint16(o, true); o += 2;
  const strCount = view.getUint32(o, true); o += 4;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const len = view.getUint32(o, true); o += 4;
    strings.push(Buffer.from(bytes.subarray(o, o + len)).toString('utf8'));
    o += len;
  }
  const opCount = view.getUint32(o, true); o += 4;
  const firstOpCode = opCount > 0 ? view.getUint8(o) : -1;
  return { magic, version, flags, generation, sequence, partIndex, partCount, strings, opCount, firstOpCode };
}

function testEncodeFrameHeaderAndPatch(): void {
  const parts = encodeFrame(
    [{ op: 'patch', node: 7, snapshot: { kind: 'text', id: 7, value: 'hi' } }],
    { generation: 3, sequence: 9 },
  );
  assert.strictEqual(parts.length, 1);
  const header = readWireHeader(parts[0]!);
  assert.strictEqual(header.magic, 0x5050, "magic is 'PP'");
  assert.strictEqual(header.version, 1);
  assert.strictEqual(header.flags, 0);
  assert.strictEqual(header.generation, 3);
  assert.strictEqual(header.sequence, 9);
  assert.strictEqual(header.partIndex, 0);
  assert.strictEqual(header.partCount, 1);
  assert.strictEqual(header.opCount, 1);
  assert.strictEqual(header.firstOpCode, OpCode.Patch);
  assert.ok(header.strings.includes('hi'), 'text value is interned in the string table');
  console.log('[unit] page/encode header + patch op ok');
}

function testEncodeFramePartSplitting(): void {
  const bigValue = 'x'.repeat(2000);
  const ops = Array.from({ length: 50 }, (_, i) => ({
    op: 'patch' as const,
    node: i + 1,
    snapshot: { kind: 'text' as const, id: i + 1, value: bigValue },
  }));
  const parts = encodeFrame(ops, { generation: 1, sequence: 1 }, 4096);
  assert.ok(parts.length > 1, 'exceeding maxFrameBytes splits into multiple parts (PP-FR-8)');
  let totalOps = 0;
  parts.forEach((part, idx) => {
    const header = readWireHeader(part);
    assert.strictEqual(header.generation, 1);
    assert.strictEqual(header.sequence, 1, 'every part shares the same sequence — atomicity is never split');
    assert.strictEqual(header.partIndex, idx);
    assert.strictEqual(header.partCount, parts.length);
    assert.ok(part.byteLength <= 4096 + 4096, 'each part stays close to the byte budget');
    totalOps += header.opCount;
  });
  assert.strictEqual(totalOps, ops.length, 'no op is dropped across parts');
  const single = encodeFrame([], { generation: 1, sequence: 1 }, DEFAULT_MAX_FRAME_BYTES);
  assert.strictEqual(single.length, 1, 'an empty op list still yields exactly one (empty) part');
  console.log('[unit] page/encode part splitting ok');
}

function testEncodeFrameEstablishOpsSetEstablishFlag(): void {
  const ops: WireOp[] = [
    { op: 'establishBegin', payload: buildEstablishBegin(1, { width: 800, height: 600 }, { x: 0, y: 0 }) },
    { op: 'establishChunk', bytes: Buffer.from('<html></html>', 'utf8') },
    { op: 'establishEnd', nodeCount: 3, checksum: 42 },
  ];
  const parts = encodeFrame(ops, { generation: 1, sequence: 0, establish: true });
  assert.strictEqual(parts.length, 1, 'a small establish frame stays in one part');
  const header = readWireHeader(parts[0]!);
  assert.strictEqual(header.flags & 0b01, 0b01, 'establish flag (bit0) must be set on the header');
  assert.strictEqual(header.opCount, 3);
  assert.strictEqual(header.firstOpCode, OpCode.EstablishBegin);
  console.log('[unit] page/encode establish ops set establish flag ok');
}

/** Live cutover (Phase C1) — EventBridge/DropOldestQueue must relay an opaque §5.5 part unmodified. */
function testEventBridgeAcceptsBinaryShapedDiff(): void {
  const bridge = new EventBridge('s-page-projection-v2-unit');
  const parts = encodeFrame(
    [{ op: 'patch', node: 1, snapshot: { kind: 'text', id: 1, value: 'x' } }],
    { generation: 1, sequence: 1 },
  );
  assert.strictEqual(parts.length, 1);
  bridge.onPageProjectionDiff({
    sequence: 1,
    generation: 1,
    plane: '',
    operation: '',
    timestampMs: Date.now(),
    body: parts[0]!,
    partIndex: 0,
    partCount: 1,
    flags: 0,
    version: 1,
  });
  assert.strictEqual(bridge.dom.pendingCount, 1, 'binary-shaped diff (empty plane/operation) must enqueue');
  bridge.close();
  console.log('[unit] page/encode + EventBridge binary diff acceptance ok');
}

// ------------------------------------------------------------ establish.ts

function testEstablishChecksumDeterministic(): void {
  const a = computeEstablishChecksum(['html', 'body', 'div', 'span']);
  const b = computeEstablishChecksum(['html', 'body', 'div', 'span']);
  const c = computeEstablishChecksum(['html', 'body', 'span', 'div']);
  assert.deepStrictEqual(a, b, 'the same node stream always yields the same checksum');
  assert.notStrictEqual(a.checksum, c.checksum, 'a different node order yields a different checksum');
  assert.strictEqual(a.nodeCount, 4);

  const acc = new EstablishChecksum();
  acc.addNode('html');
  assert.strictEqual(acc.nodeCount, 1);
  console.log('[unit] page/establish checksum ok');
}

function testEstablishHandoff(): void {
  const state = createEstablishHandoff<number>();
  assert.strictEqual(state.phase, 'idle');
  assert.strictEqual(accumulateDuringEstablish(state, 1), false, 'no epoch open yet — caller must not have frames to give');

  openEstablishEpoch(state);
  assert.strictEqual(state.phase, 'accumulate');
  assert.strictEqual(accumulateDuringEstablish(state, 1), true);
  markSnapshotTaken(state);
  assert.strictEqual(state.phase, 'snapshot');
  assert.strictEqual(accumulateDuringEstablish(state, 2), true, 'frames still accumulate after the snapshot (§5.6.6.b)');

  const drained = drainForEmitAfterEnd(state);
  assert.deepStrictEqual(drained, [1, 2], 'accumulated frames drain in sequence order');
  assert.strictEqual(state.phase, 'idle');
  assert.deepStrictEqual(state.pendingFrames, []);

  const html = '<p>item</p>'.repeat(20); // tag-dense, so a `>` boundary is always reachable within budget.
  const chunks = splitHtmlIntoChunks(html, 40);
  assert.ok(chunks.length > 1);
  assert.strictEqual(chunks.join(''), html, 'chunking never drops or reorders bytes');
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.endsWith('>'), 'every non-final chunk boundary lands after a closed tag');
  }
  console.log('[unit] page/establish handoff + chunking ok');
}

// ------------------------------------------------------------ cssom.ts

function testCssomCoalesceAddRemoveCancels(): void {
  const coalescer = new CssomCoalescer();
  const sheet: CssomSheetDescriptor = { id: 1, scope: { kind: 'main' }, rules: [] };
  coalescer.addSheet(1, 0, sheet);
  coalescer.removeSheet(1);
  assert.strictEqual(coalescer.isEmpty, true, 'a sheet added and removed within the frame is never sent');
  assert.deepStrictEqual(coalescer.flush(), []);

  coalescer.addRule(1, 10, 0, { id: 10, cssText: 'a{}' });
  coalescer.removeRule(1, 10);
  assert.strictEqual(coalescer.isEmpty, true, 'a rule added and removed within the frame is never sent');
  console.log('[unit] page/cssom add+remove cancel ok');
}

function testCssomCoalescePatchCollapses(): void {
  const coalescer = new CssomCoalescer();
  coalescer.patchRule(10, 'a{color:red}');
  coalescer.patchRule(10, 'a{color:blue}');
  const ops = coalescer.flush();
  assert.strictEqual(ops.length, 1, 'repeated writes to one rule collapse to one cssomPatch');
  assert.deepStrictEqual(ops[0], { op: 'cssomPatch', rule: 10, cssText: 'a{color:blue}' });
  assert.strictEqual(coalescer.isEmpty, true, 'flush resets the coalescer');
  console.log('[unit] page/cssom patch collapse ok');
}

// ------------------------------------------------------------ channel.ts

function testChannelChunking(): void {
  const pushed: Uint8Array[] = [];
  const channel = createBindingChannel((bytes) => pushed.push(bytes));
  const payload = new Uint8Array(250).fill(7);
  const chunks = pushChunked(channel, payload, 100);
  assert.strictEqual(chunks, 3);
  assert.strictEqual(pushed.length, 3);
  assert.strictEqual(pushed[0]!.byteLength, 100);
  assert.strictEqual(pushed[2]!.byteLength, 50);

  pushed.length = 0;
  pushFrameParts(channel, [new Uint8Array([1]), new Uint8Array([2])]);
  assert.strictEqual(pushed.length, 2);
  console.log('[unit] page/channel chunking ok');
}

// ------------------------------------------------------------ node/mirror.ts

function testNodeMirrorApplyAndSerialize(): void {
  const mirror = new NodeMirror();
  const root: FNode = {
    kind: 'element',
    id: 1,
    tag: 'html',
    attrs: {},
    children: [
      {
        kind: 'element',
        id: 2,
        tag: 'body',
        attrs: { class: 'x' },
        children: [{ kind: 'text', id: 3, value: 'hello' }],
      },
    ],
  };
  mirror.seedRoot(root); // establish-equivalent bulk load — no live frame needed for the initial tree.
  assert.strictEqual(mirror.root, 1);
  assert.strictEqual(mirror.size >= 3, true);
  const html = mirror.serializeToHtml();
  assert.ok(html.includes('speculum-anchor="1"'));
  assert.ok(html.includes('speculum-anchor="2"'));
  assert.ok(html.includes('class="x"'));
  assert.ok(html.includes('hello'));

  mirror.applyFrame([{ op: 'patch', node: 3, snapshot: { kind: 'text', id: 3, value: 'updated' } }]);
  assert.strictEqual(mirror.get(3)?.value, 'updated');

  mirror.applyFrame([{ op: 'childList', parent: 1, mode: 'full', children: [] }]);
  assert.strictEqual(mirror.get(2), undefined, 'removing a parent unregisters its whole subtree');
  assert.strictEqual(mirror.get(3), undefined);
  console.log('[unit] page/node/mirror apply + serialize ok');
}

function testNodeMirrorDesyncOnMissingId(): void {
  const mirror = new NodeMirror();
  assert.throws(
    () => mirror.applyFrame([{ op: 'patch', node: 42, snapshot: { kind: 'text', id: 42, value: 'x' } }]),
    MirrorDesyncError,
  );
  assert.throws(
    () => mirror.applyFrame([{ op: 'childList', parent: 42, mode: 'full', children: [] }]),
    MirrorDesyncError,
  );
  console.log('[unit] page/node/mirror desync on missing id ok');
}

// ------------------------------------------------------------ node/rewrite.ts

function testUrlRewriterBasicsAndMemoIsolation(): void {
  const rewriter = new UrlRewriter({ originHost: 'example.com' });
  assert.strictEqual(rewriter.rewriteUrl('/a.png'), '/w7s/virtual-assets/example.com/a.png');
  assert.strictEqual(
    rewriter.rewriteUrl('https://cdn.example.com/x.js?v=1'),
    '/w7s/virtual-assets/cdn.example.com/x.js?v=1',
  );
  assert.strictEqual(rewriter.rewriteUrl('javascript:alert(1)'), 'javascript:alert(1)', 'never rewrites javascript: urls');
  assert.strictEqual(rewriter.rewriteUrl('data:text/plain,hi'), 'data:text/plain,hi');
  assert.strictEqual(rewriter.memoSize, 4, 'rewriteUrl memoizes per distinct raw url');

  const srcset =
    'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, '
    + 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w';
  const rewritten = rewriter.rewriteAttrValue('srcset', srcset);
  assert.ok(rewritten.includes('f_avif,q_auto,w_1920'), 'Cloudinary comma-bearing transforms survive rewriting');
  assert.ok(!rewritten.includes('https://'), 'srcset urls are rewritten to the virtual-assets prefix, not left absolute');
  assert.ok(rewritten.includes('/w7s/virtual-assets/res.cloudinary.com/'));

  const other = new UrlRewriter({ originHost: 'example.com' });
  assert.strictEqual(other.memoSize, 0, 'no shared memo across instances (K2)');

  const css = rewriter.rewriteCssUrlFunctions('body{background:url("/bg.png")}');
  assert.ok(css.includes('/w7s/virtual-assets/example.com/bg.png'));
  console.log('[unit] page/node/rewrite basics + isolation ok');
}

// ------------------------------------------------------------ opcodes.ts

function testOpCodesAreStableAndUnique(): void {
  const values = Object.values(OpCode).filter((v): v is number => typeof v === 'number');
  assert.strictEqual(new Set(values).size, values.length, 'no opcode value collides');
  assert.strictEqual(OpCode.EstablishBegin, 1, 'opcode numbering is wire-stable — never renumber');
  console.log('[unit] page/opcodes stable + unique ok');
}

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
  testEncodeFrameHeaderAndPatch();
  testEncodeFramePartSplitting();
  testEncodeFrameEstablishOpsSetEstablishFlag();
  testEventBridgeAcceptsBinaryShapedDiff();
  testEstablishChecksumDeterministic();
  testEstablishHandoff();
  testCssomCoalesceAddRemoveCancels();
  testCssomCoalescePatchCollapses();
  testChannelChunking();
  testNodeMirrorApplyAndSerialize();
  testNodeMirrorDesyncOnMissingId();
  testUrlRewriterBasicsAndMemoIsolation();
  testOpCodesAreStableAndUnique();
  console.log('[unit] page/* PageProjection producer modules all passed');
}
