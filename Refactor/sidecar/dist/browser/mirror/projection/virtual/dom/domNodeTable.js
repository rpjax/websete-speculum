"use strict";
/**
 * Bidirectional lookup table of DOM nodes (E-05 / parent §5.1).
 * Producer-side: holds live Node references from the Virtual document.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomNodeTable = exports.NONE_DOM_NODE_KEY = void 0;
const domNodeKey_1 = require("../../models/domNodeKey");
Object.defineProperty(exports, "NONE_DOM_NODE_KEY", { enumerable: true, get: function () { return domNodeKey_1.NONE_DOM_NODE_KEY; } });
class DomNodeTable {
    byNode = new WeakMap();
    byKey = new Map();
    finalizers;
    /** §1.2: 0 = none, 1 = Document (via {@link bind}), 2… minted monotonically. */
    nextKey = 2;
    currentGeneration = 1;
    constructor() {
        this.finalizers = new FinalizationRegistry((key) => {
            const ref = this.byKey.get(key);
            if (ref !== undefined && ref.deref() === undefined) {
                this.byKey.delete(key);
            }
        });
    }
    get generation() {
        return this.currentGeneration;
    }
    /**
     * Bootstrap-only initialization (Stage 3, frame-protocol-production-completeness): a hard
     * navigation re-injects this whole script into a fresh JS realm, so the *identity map* is
     * already empty by construction — there is nothing to clear here, unlike `bumpGeneration()`.
     * This exists purely so a fresh instance reports the `generation` the orchestrator
     * (`V4ProjectionBrowserSession`) already knows this navigation is (via `ProjectionConfig.generation`),
     * so a `rebuildAndResync` frame — and every ordinary tick after it — carries the right number for
     * `bootstrap.ts` to decide whether to prepend `EPOCH_RESET`.
     */
    setGeneration(generation) {
        this.currentGeneration = generation;
    }
    get size() {
        return this.byKey.size;
    }
    allocate(node) {
        const existing = this.byNode.get(node);
        if (existing !== undefined)
            return existing;
        const key = this.mint();
        this.byNode.set(node, key);
        this.byKey.set(key, new WeakRef(node));
        this.finalizers.register(node, key, node);
        return key;
    }
    /**
     * Forces a specific id (frame-protocol.md §1.2 — id `1` is reserved for `Document`, not
     * allocated like an ordinary node). Idempotent. Advances `nextKey` past `key` so ordinary
     * `allocate()` calls never collide with it.
     */
    bind(node, key) {
        if (this.byNode.has(node))
            return;
        this.byNode.set(node, key);
        this.byKey.set(key, new WeakRef(node));
        this.finalizers.register(node, key, node);
        if (key >= this.nextKey)
            this.nextKey = key + 1;
    }
    /**
     * Next session id (DOM or CSSOM). Never returns 0 or 1.
     * CSSOM WeakMaps call this so Sheet/Rule ids share the DOM counter (§1.1).
     */
    mint() {
        if (this.nextKey > 0xffffffff)
            throw new Error('DomNodeTable: id space exhausted');
        const key = this.nextKey;
        this.nextKey += 1;
        return key;
    }
    keyOf(node) {
        return this.byNode.get(node) ?? domNodeKey_1.NONE_DOM_NODE_KEY;
    }
    has(node) {
        return this.byNode.has(node);
    }
    get(key) {
        if (key === domNodeKey_1.NONE_DOM_NODE_KEY)
            return undefined;
        const ref = this.byKey.get(key);
        if (ref === undefined)
            return undefined;
        const node = ref.deref();
        if (node === undefined) {
            this.byKey.delete(key);
            return undefined;
        }
        return node;
    }
    release(node) {
        const key = this.byNode.get(node);
        if (key === undefined)
            return;
        this.byNode.delete(node);
        this.byKey.delete(key);
        this.finalizers.unregister(node);
    }
    bumpGeneration() {
        this.byNode = new WeakMap();
        this.byKey.clear();
        this.currentGeneration += 1;
        return this.currentGeneration;
    }
    /**
     * frame-protocol.md §5.8 rebuild identity (`rebuildAndResync`) — clears the map so it can be
     * rebuilt from a live walk. Unlike `bumpGeneration()`, this does NOT advance `generation`:
     * `resync` is a same-generation wholesale replace, not `EPOCH_RESET`. `nextKey` is left
     * untouched, so freshly (re)allocated ids never collide with ids issued before the reset.
     */
    resetIdentity() {
        this.byNode = new WeakMap();
        this.byKey.clear();
    }
    /** Live `[id, node]` pairs, skipping any key whose `WeakRef` has already been collected. */
    *liveEntries() {
        for (const [key, ref] of this.byKey) {
            const node = ref.deref();
            if (node !== undefined)
                yield [key, node];
        }
    }
}
exports.DomNodeTable = DomNodeTable;
//# sourceMappingURL=domNodeTable.js.map