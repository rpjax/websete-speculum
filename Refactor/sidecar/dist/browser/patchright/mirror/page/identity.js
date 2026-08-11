"use strict";
/**
 * §5.1 — off-DOM identity space. One instance per session (K2): forward
 * `WeakMap<Node, uint32>`, reverse `Map<uint32, WeakRef<Node>>`, released via
 * `FinalizationRegistry` so the reverse map cannot retain detached nodes and
 * cannot grow without bound (PP-ID-4).
 *
 * MUST NOT write identity attributes into the Virtual DOM (§5.1.3) — this
 * module never touches the node it identifies, only its own maps.
 *
 * `TNode` is generic (not the DOM `Node` type) so this module compiles and
 * unit-tests without a `dom` lib: any real DOM node satisfies `object`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentitySpace = exports.NONE_NODE_ID = void 0;
/** Reserved: "no identity". Never allocated. */
exports.NONE_NODE_ID = 0;
class IdentitySpace {
    forward = new WeakMap();
    reverse = new Map();
    registry;
    nextId = 1;
    currentGeneration = 1;
    constructor() {
        this.registry = new FinalizationRegistry((id) => {
            const ref = this.reverse.get(id);
            if (ref !== undefined && ref.deref() === undefined)
                this.reverse.delete(id);
        });
    }
    get generation() {
        return this.currentGeneration;
    }
    /** Size of the reverse map — soak-tested by PP-ID-4 to stay bounded. */
    get reverseSize() {
        return this.reverse.size;
    }
    /**
     * §5.1.5 — allocates the first time a node is published; idempotent for a
     * node already known. Ids are monotonic from 1 and never reused (§5.1.1).
     */
    allocate(node) {
        const existing = this.forward.get(node);
        if (existing !== undefined)
            return existing;
        const id = this.nextId;
        this.nextId += 1;
        this.forward.set(node, id);
        this.reverse.set(id, new WeakRef(node));
        this.registry.register(node, id, node);
        return id;
    }
    /** §5.1.5 — a node never published has no id. */
    idOf(node) {
        return this.forward.get(node) ?? exports.NONE_NODE_ID;
    }
    has(node) {
        return this.forward.has(node);
    }
    /** Reverse resolution for input (§5.11) and state sensors. `0` never resolves. */
    resolve(id) {
        if (id === exports.NONE_NODE_ID)
            return undefined;
        const ref = this.reverse.get(id);
        if (ref === undefined)
            return undefined;
        const node = ref.deref();
        if (node === undefined) {
            this.reverse.delete(id);
            return undefined;
        }
        return node;
    }
    /** Drop a specific node's identity (e.g. after §5.3.3 pruning) without a full bump. */
    release(node) {
        const id = this.forward.get(node);
        if (id === undefined)
            return;
        this.forward.delete(node);
        this.reverse.delete(id);
        this.registry.unregister(node);
    }
    /**
     * §5.1.1 / real Document swap (T3): drop every identity. A fresh forward
     * map is required because `WeakMap` has no `clear()`. Ids keep counting up
     * from `nextId` — the next generation never reuses an id from a prior one.
     */
    bumpGeneration() {
        this.forward = new WeakMap();
        this.reverse.clear();
        this.currentGeneration += 1;
        return this.currentGeneration;
    }
}
exports.IdentitySpace = IdentitySpace;
//# sourceMappingURL=identity.js.map