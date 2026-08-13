"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPageProjectionUnitTests = runPageProjectionUnitTests;
const assert_1 = __importDefault(require("assert"));
const identity_1 = require("./identity");
const fmap_1 = require("./fmap");
const observe_1 = require("./observe");
const frame_1 = require("./frame");
const clock_1 = require("./clock");
const cdpPierce_unit_1 = require("./cdpPierce.unit");
const page_unit_wire_1 = require("./page.unit.wire");
// ------------------------------------------------------------ identity.ts
function testIdentitySpaceAllocateResolveRelease() {
    const space = new identity_1.IdentitySpace();
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    const idA = space.allocate(a);
    const idB = space.allocate(b);
    assert_1.default.strictEqual(idA, 1);
    assert_1.default.strictEqual(idB, 2);
    assert_1.default.strictEqual(space.allocate(a), idA, 'allocate is idempotent for a known node');
    assert_1.default.strictEqual(space.idOf(a), idA);
    assert_1.default.strictEqual(space.resolve(idA), a);
    assert_1.default.strictEqual(space.resolve(identity_1.NONE_NODE_ID), undefined, '0 never resolves');
    assert_1.default.strictEqual(space.resolve(999), undefined, 'unknown id never resolves');
    const clone = { tag: 'a' };
    assert_1.default.strictEqual(space.idOf(clone), identity_1.NONE_NODE_ID, 'a distinct object has no id (PP-ID-2)');
    const idClone = space.allocate(clone);
    assert_1.default.notStrictEqual(idClone, idA, 'cloning yields a distinct id — never a duplicate');
    space.release(b);
    assert_1.default.strictEqual(space.idOf(b), identity_1.NONE_NODE_ID);
    assert_1.default.strictEqual(space.resolve(idB), undefined);
    console.log('[unit] page/identity allocate/resolve/release ok');
}
function testIdentitySpaceGenerationBump() {
    const space = new identity_1.IdentitySpace();
    const a = { tag: 'a' };
    const idA = space.allocate(a);
    assert_1.default.strictEqual(space.generation, 1);
    const gen2 = space.bumpGeneration();
    assert_1.default.strictEqual(gen2, 2);
    assert_1.default.strictEqual(space.reverseSize, 0, 'bump releases the reverse map (PP-ID-4)');
    assert_1.default.strictEqual(space.resolve(idA), undefined, 'a pre-bump id never resolves after bump');
    const b = { tag: 'b' };
    const idB = space.allocate(b);
    assert_1.default.notStrictEqual(idB, idA, 'ids are never reused across a generation bump');
    console.log('[unit] page/identity generation bump ok');
}
// ------------------------------------------------------------ fmap.ts
function testFmapPlaceholderAndDenyList() {
    assert_1.default.strictEqual((0, fmap_1.isPlaceholderTag)('SCRIPT'), true);
    assert_1.default.strictEqual((0, fmap_1.isPlaceholderTag)('iframe'), true);
    assert_1.default.strictEqual((0, fmap_1.isPlaceholderTag)('div'), false);
    const attrs = (0, fmap_1.stripDeniedAttrs)([
        ['onclick', 'alert(1)'],
        ['href', 'javascript:alert(1)'],
        ['integrity', 'sha256-x'],
        ['class', 'ok'],
    ]);
    assert_1.default.deepStrictEqual(attrs, { class: 'ok' });
    const scriptSnapshot = (0, fmap_1.publishElementSnapshot)({
        id: 5,
        rawTag: 'SCRIPT',
        rawAttrs: [['src', '/a.js']],
        children: [{ kind: 'text', id: 6, value: 'ignored' }],
    });
    assert_1.default.strictEqual(scriptSnapshot.tag, 'div', 'placeholder rewrites to a safe host tag');
    assert_1.default.strictEqual(scriptSnapshot.attrs[fmap_1.PROJECTED_TAG_ATTR], 'script');
    assert_1.default.deepStrictEqual(scriptSnapshot.children, [], 'non-iframe placeholder publishes empty interior (T13)');
    const iframeChild = { kind: 'text', id: 9, value: 'pierced' };
    const iframeSnapshot = (0, fmap_1.publishElementSnapshot)({
        id: 7,
        rawTag: 'iframe',
        rawAttrs: [],
        children: [iframeChild],
        iframeHost: true,
    });
    assert_1.default.deepStrictEqual(iframeSnapshot.children, [iframeChild], 'iframe keeps its pierced interior');
    console.log('[unit] page/fmap placeholder + deny-list ok');
}
function testFmapStateAttrs() {
    const snapshot = (0, fmap_1.publishElementSnapshot)({
        id: 1,
        rawTag: 'input',
        rawAttrs: [['type', 'checkbox']],
        children: [],
        state: { inputChecked: 'true' },
    });
    assert_1.default.strictEqual(snapshot.attrs[fmap_1.STATE_ATTR_KEYS.inputChecked], 'true');
    console.log('[unit] page/fmap state attrs ok');
}
// ------------------------------------------------------------ observe.ts
function testObserveDirtyStateAndMutations() {
    const identity = new identity_1.IdentitySpace();
    const parent = { id: 1 };
    const child = { id: 2 };
    identity.allocate(parent);
    identity.allocate(child);
    const state = (0, observe_1.createDirtyState)();
    (0, observe_1.markMutation)(state, identity, { type: 'childList', target: parent });
    (0, observe_1.markMutation)(state, identity, { type: 'attributes', target: child });
    (0, observe_1.markMutation)(state, identity, { type: 'characterData', target: { id: 99 } }); // never published
    assert_1.default.strictEqual(state.dirtyParents.has(identity.idOf(parent)), true);
    assert_1.default.strictEqual(state.attrDirty.has(identity.idOf(child)), true);
    assert_1.default.strictEqual(state.textDirty.size, 0, 'a record for an unpublished node is discarded (PP-FR-5)');
    assert_1.default.strictEqual((0, observe_1.discardNonPublished)(parent, () => false), true);
    assert_1.default.strictEqual((0, observe_1.discardNonPublished)(parent, () => true), false);
    (0, observe_1.markNewId)(state, 42);
    assert_1.default.ok(state.newIds.has(42));
    assert_1.default.strictEqual(state.scrollDirty.size, 0);
    assert_1.default.strictEqual(observe_1.VIEWPORT_SCROLL_TARGET, 0);
    console.log('[unit] page/observe dirty state + mutations ok');
}
function buildTestQuery(nodes, overrides = {}) {
    function ancestorsOf(id) {
        const chain = [];
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
function testFrameAccumulatorPruneEphemeral() {
    const nodes = new Map([[10, { id: 10, connected: false, parentId: null }]]);
    const acc = new frame_1.FrameAccumulator(buildTestQuery(nodes));
    const dirty = (0, observe_1.createDirtyState)();
    (0, observe_1.markNewId)(dirty, 10);
    dirty.attrDirty.add(10);
    acc.absorb(dirty);
    const ops = acc.flush();
    assert_1.default.strictEqual(ops, null, 'a node created and destroyed within the frame is never sent (PP-FR-1)');
    console.log('[unit] page/frame prune ephemeral ok');
}
function testFrameAccumulatorAbsorbDescendants() {
    const nodes = new Map([
        [1, { id: 1, connected: true, parentId: null }],
        [10, { id: 10, connected: true, parentId: 1 }],
        [11, { id: 11, connected: true, parentId: 10 }],
    ]);
    const freshChild = { kind: 'element', id: 10, tag: 'div', attrs: {}, children: [] };
    const childList = new Map([[1, [{ kind: 'fresh', node: freshChild }]]]);
    const acc = new frame_1.FrameAccumulator(buildTestQuery(nodes, { childList }));
    const dirty = (0, observe_1.createDirtyState)();
    (0, observe_1.markNewId)(dirty, 10);
    dirty.dirtyParents.add(1);
    dirty.attrDirty.add(11); // descendant of the newly created 10 — must be absorbed, not patched separately.
    acc.absorb(dirty);
    const ops = acc.flush();
    assert_1.default.ok(ops, 'expected ops');
    assert_1.default.strictEqual(ops.length, 1, 'a new subtree yields exactly one childList entry, not a patch per node (PP-FR-2)');
    assert_1.default.strictEqual(ops[0].op, 'childList');
    console.log('[unit] page/frame absorb descendants ok');
}
function testFrameAccumulatorPatchCoalesce() {
    const nodes = new Map([[5, { id: 5, connected: true, parentId: null }]]);
    const acc = new frame_1.FrameAccumulator(buildTestQuery(nodes));
    const dirty = (0, observe_1.createDirtyState)();
    dirty.attrDirty.add(5);
    dirty.textDirty.add(5);
    dirty.stateDirty.add(5);
    acc.absorb(dirty);
    const ops = acc.flush();
    assert_1.default.strictEqual(ops.length, 1, 'N writes to one node within a frame produce exactly one patch (PP-FR-3)');
    assert_1.default.strictEqual(ops[0].op, 'patch');
    console.log('[unit] page/frame patch coalesce ok');
}
function testFrameAccumulatorAppendMode() {
    const nodes = new Map([[1, { id: 1, connected: true, parentId: null }]]);
    const existingRefs = (ids) => ids.map((id) => ({ kind: 'existing', id }));
    const childListRound1 = new Map([[1, existingRefs([2, 3])]]);
    const acc = new frame_1.FrameAccumulator(buildTestQuery(nodes, { childList: childListRound1 }));
    const dirty1 = (0, observe_1.createDirtyState)();
    dirty1.dirtyParents.add(1);
    acc.absorb(dirty1);
    const ops1 = acc.flush();
    assert_1.default.strictEqual(ops1[0].op, 'childList');
    assert_1.default.strictEqual(ops1[0].mode, 'full', 'first emission for a parent is always FULL');
    const childListRound2 = new Map([[1, existingRefs([2, 3, 4])]]);
    const acc2Query = buildTestQuery(nodes, { childList: childListRound2 });
    // Swap in round-2 fixtures on the same instance so its append-cache (populated by round 1) is exercised.
    acc.query = acc2Query;
    const dirty2 = (0, observe_1.createDirtyState)();
    dirty2.dirtyParents.add(1);
    acc.absorb(dirty2);
    const ops2 = acc.flush();
    assert_1.default.strictEqual(ops2.length, 1);
    const op2 = ops2[0];
    assert_1.default.strictEqual(op2.mode, 'append', 'a pure suffix addition uses the APPEND fast path (§5.4.2)');
    assert_1.default.strictEqual(op2.children.length, 1);
    console.log('[unit] page/frame append fast path ok');
}
// ------------------------------------------------------------ clock.ts
function fakeScheduler() {
    let now = 0;
    let cb = null;
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
        advance(ms) {
            now += ms;
        },
    };
}
function testFrameClockDegradeAndRecover() {
    const scheduler = fakeScheduler();
    const clock = new clock_1.FrameClock({ scheduler, onTick: () => { }, rateRecoverMs: 1000 });
    assert_1.default.strictEqual(clock.rateHz, 60);
    clock.degrade();
    assert_1.default.strictEqual(clock.rateHz, 30, 'first degrade steps to the next ladder rung');
    clock.degrade();
    assert_1.default.strictEqual(clock.rateHz, 15);
    assert_1.default.strictEqual(clock.recoverStep(), false, 'recovery is throttled before rateRecoverMs elapses');
    scheduler.advance(1000);
    assert_1.default.strictEqual(clock.recoverStep(), true);
    assert_1.default.strictEqual(clock.rateHz, 30, 'recovery is one ladder step at a time');
    assert_1.default.deepStrictEqual([...clock_1.RATE_LADDER], [60, 30, 15, 5]);
    clock.setHidden(true);
    assert_1.default.strictEqual(clock.rateHz, 1, 'a hidden report collapses to hiddenRateHz');
    clock.setHidden(false);
    assert_1.default.strictEqual(clock.rateHz, 60, 'becoming visible recovers straight to the top rate');
    console.log('[unit] page/clock degrade + recover ok');
}
function testFrameClockStallWatchdog() {
    const scheduler = fakeScheduler();
    let stalls = 0;
    let ticks = 0;
    const clock = new clock_1.FrameClock({
        scheduler,
        onTick: () => { ticks += 1; },
        onStall: () => { stalls += 1; },
        frameStallMs: 1000,
    });
    assert_1.default.strictEqual(clock.checkStall(), false, 'no stall immediately after construction');
    scheduler.advance(1500);
    assert_1.default.strictEqual(clock.checkStall(), true, 'a stalled clock is detected and force-ticked (PP-FR-7)');
    assert_1.default.strictEqual(stalls, 1);
    assert_1.default.strictEqual(ticks, 1);
    console.log('[unit] page/clock stall watchdog ok');
}
// ------------------------------------------------------------ encode.ts
async function runPageProjectionUnitTests() {
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
    (0, page_unit_wire_1.runPageProjectionWireUnitTests)();
    (0, cdpPierce_unit_1.runCdpPierceUnit)();
    console.log('[unit] page/* PageProjection producer modules all passed');
}
//# sourceMappingURL=page.unit.js.map