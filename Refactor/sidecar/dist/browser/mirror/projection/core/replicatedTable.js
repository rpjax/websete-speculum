"use strict";
/**
 * The replicated node table — frame-protocol.md §1.3–§1.5, P0 ("the table is the replicated
 * structure; the DOM is a projection of it"). DOM-free, dual-consumed (like models/decode.ts):
 * the producer (virtual/) maintains one instance alongside its live-DOM `DomNodeTable` identity
 * map, and the client (client/) maintains an independent instance during Phase 1 of frame apply
 * (frame-protocol.md §6), before either side touches a real DOM node.
 *
 * Contract fields per row (`kind`, `parent`, `prevSibling`, `contentHash`, `rowHash`) are exactly
 * §1.3's node row. ELEMENT rows also hold `props` (PROP_SET, §4.4). `nextSiblingOf` and
 * `lastChildOf` are **derived, non-hashed navigation indices** (§1.4: "Implementations MAY keep
 * derived links … for O(1) navigation. Derived links are not hashed and are not part of the
 * contract.") — they exist purely so `INSERT`/`REMOVE` can repair "the node that followed it" in
 * O(1) without a table-wide scan, matching §1.5's mandatory O(1) `tableHash` update transitively.
 *
 * Row `1` (Document) is never stored here — frame-protocol.md §1.2/§5.8: it is never described by
 * `NODE_NEW` and never contributes a `rowHash`. It is used only as an ordinary key into
 * `lastChildOf`/as a `parent` operand, which requires no entry in `rows`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplicatedTable = void 0;
const elementNs_1 = require("./elementNs");
const opcodes_1 = require("./opcodes");
const rowHash_1 = require("./rowHash");
const NONE = 0;
class ReplicatedTable {
    rows = new Map();
    /** ELEMENT rows only — id -> attrName -> that attribute's own contentHash contribution. */
    attrHashes = new Map();
    /** ELEMENT rows only — id -> propId -> that prop's contentHash contribution. */
    propHashes = new Map();
    /** ELEMENT rows only — last PROP_SET scalar (delta compare on the producer). */
    propValues = new Map();
    /** Derived, non-hashed: id -> the id currently linked immediately after it under the same parent. */
    nextSiblingOf = new Map();
    /** Derived, non-hashed: parentId -> the id currently linked last under that parent (0 = none). */
    lastChildOf = new Map();
    /** Host ELEMENT id → owned `SHADOW_ROOT` id. Not hashed; not a light-chain link. */
    shadowRootByHost = new Map();
    /** Reverse of `shadowRootByHost` so `dropRow` of the root clears the host index. */
    hostOfShadowRoot = new Map();
    tracker = new rowHash_1.TableHashTracker();
    /** Stamped onto every row `setRow` touches until changed again — one frame, one `lms` (§4 preamble). */
    currentSequence = 0;
    get tableHash() {
        return this.tracker.value;
    }
    /**
     * Call once per frame before applying its ops (producer: `tableFrameBuilder.ts` / `domResync.ts`;
     * client: `replicatedTableApply.ts`) — every row touched by a subsequent op this pass stamps
     * `lms` with this value (§1.3/§4: "every instruction that touches a row sets that row's
     * `lms = sequence`"). Not part of `rowHash`/`tableHash` (§1.5) — diagnostics/GC only (§1.6).
     */
    setSequence(sequence) {
        this.currentSequence = sequence;
    }
    /** Row count — excludes the implicit, never-stored Document row (id 1). */
    get size() {
        return this.rows.size;
    }
    has(id) {
        return this.rows.has(id);
    }
    getRow(id) {
        return this.rows.get(id);
    }
    /**
     * §4.1 `CHECK.scope = 1` — Σ `rowHash` (mod 2^64) over ids in `[lo, hi]` inclusive. O(size),
     * not O(1): OPEN-3 resolves the *model* (id ranges over per-bucket partial sums) but its O(1)
     * bucket-maintenance mechanism is not built, and the v0 producer never emits `scope: 1` (only
     * resync's whole-table close, §5.8 step 4) — this exists so a client still decodes and
     * evaluates one correctly (P7: strict, not silently ignored) rather than leaving it unusable.
     */
    hashRange(lo, hi) {
        let sum = 0n;
        for (const [id, row] of this.rows) {
            if (id >= lo && id <= hi)
                sum = (0, rowHash_1.addMod64)(sum, row.rowHash);
        }
        return sum;
    }
    /**
     * Child ids of `parent` in sibling order (first → last). Walks the derived `lastChildOf` +
     * hashed `prevSibling` chain then reverses — O(children), not hashed. Lab O2 local oracle
     * (`tableLiveOracle.ts`) compares this to live `childNodes`; do not expose `nextSiblingOf`.
     */
    orderedChildIds(parent) {
        const backwards = [];
        const seen = new Set();
        let child = this.lastChildOf.get(parent) ?? NONE;
        while (child !== NONE) {
            if (seen.has(child))
                break;
            seen.add(child);
            backwards.push(child);
            const row = this.rows.get(child);
            child = row?.prevSibling ?? NONE;
        }
        backwards.reverse();
        return backwards;
    }
    /** Rows with hashed `parent` — O(table). Lab O2 uses this to detect a broken `lastChildOf` walk. */
    lastChildId(parent) {
        return this.lastChildOf.get(parent) ?? NONE;
    }
    countAttachedChildren(parent) {
        let n = 0;
        for (const row of this.rows.values()) {
            if (row.parent === parent && row.kind !== opcodes_1.NodeKind.ShadowRoot)
                n += 1;
        }
        return n;
    }
    /** Owned `SHADOW_ROOT` id of `host`, or 0. */
    shadowRootOf(host) {
        return this.shadowRootByHost.get(host) ?? NONE;
    }
    /** Every stored row id (excludes implicit Document `1`). */
    forEachRow(fn) {
        for (const [id, row] of this.rows)
            fn(id, row);
    }
    /** Drops every row and derived index — `EPOCH_RESET` (§4.1) and resync's wholesale replace (§5.8). */
    reset() {
        this.rows.clear();
        this.attrHashes.clear();
        this.propHashes.clear();
        this.propValues.clear();
        this.nextSiblingOf.clear();
        this.lastChildOf.clear();
        this.shadowRootByHost.clear();
        this.hostOfShadowRoot.clear();
        this.tracker.clear();
    }
    // ---- NODE_NEW (§4.2) — always creates a detached row (parent=0, prevSibling=0). ----
    /**
     * `ns` defaults to html for existing unit callers (API convenience). Decode never
     * invents a default — the wire `u8` is required.
     */
    createElementRow(id, tagName, attrs, ns = elementNs_1.ElementNs.Html, uri) {
        const attrMap = new Map();
        let sum = (0, rowHash_1.addMod64)((0, rowHash_1.hashName)(tagName), (0, rowHash_1.hashNs)(ns, uri));
        for (let i = 0; i < attrs.length; i++) {
            const { name, value } = attrs[i];
            const h = (0, rowHash_1.hashAttr)(name, value);
            attrMap.set(name, h);
            sum = (0, rowHash_1.addMod64)(sum, h);
        }
        this.attrHashes.set(id, attrMap);
        this.propHashes.set(id, new Map());
        this.propValues.set(id, new Map());
        this.setRow(id, opcodes_1.NodeKind.Element, NONE, NONE, sum);
    }
    /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
    createLeafRow(id, kind, contentField) {
        this.setRow(id, kind, NONE, NONE, (0, rowHash_1.hashValue)(contentField));
    }
    /**
     * `SHADOW_ROOT` — `parent = host` immediately, not linked into the host's light chain.
     * `prevSibling` stays 0.
     */
    createShadowRootRow(id, host, mode, initFlags) {
        this.setRow(id, opcodes_1.NodeKind.ShadowRoot, host, NONE, (0, rowHash_1.hashShadowInit)(mode, initFlags));
        this.shadowRootByHost.set(host, id);
        this.hostOfShadowRoot.set(id, host);
    }
    // ---- ATTR_SET / ATTR_DEL / TEXT_SET (§4.4) — content-only, topology untouched. ----
    setAttrs(id, attrs) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        const attrMap = this.attrHashes.get(id) ?? new Map();
        let sum = row.contentHash;
        for (let i = 0; i < attrs.length; i++) {
            const { name, value } = attrs[i];
            const old = attrMap.get(name);
            if (old !== undefined)
                sum = (0, rowHash_1.subMod64)(sum, old);
            const h = (0, rowHash_1.hashAttr)(name, value);
            attrMap.set(name, h);
            sum = (0, rowHash_1.addMod64)(sum, h);
        }
        this.attrHashes.set(id, attrMap);
        this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    delAttrs(id, names) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        const attrMap = this.attrHashes.get(id);
        if (attrMap === undefined)
            return;
        let sum = row.contentHash;
        for (let i = 0; i < names.length; i++) {
            const old = attrMap.get(names[i]);
            if (old === undefined)
                continue; // absent attribute delete is a no-op, §4.4
            sum = (0, rowHash_1.subMod64)(sum, old);
            attrMap.delete(names[i]);
        }
        this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    setValue(id, value) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        this.setRow(id, row.kind, row.parent, row.prevSibling, (0, rowHash_1.hashValue)(value));
    }
    setProp(id, propId, value) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        const hashMap = this.propHashes.get(id) ?? new Map();
        const valueMap = this.propValues.get(id) ?? new Map();
        let sum = row.contentHash;
        const old = hashMap.get(propId);
        if (old !== undefined)
            sum = (0, rowHash_1.subMod64)(sum, old);
        const h = (0, rowHash_1.hashProp)(propId, value);
        hashMap.set(propId, h);
        valueMap.set(propId, value);
        this.propHashes.set(id, hashMap);
        this.propValues.set(id, valueMap);
        this.setRow(id, row.kind, row.parent, row.prevSibling, (0, rowHash_1.addMod64)(sum, h));
    }
    getProp(id, propId) {
        return this.propValues.get(id)?.get(propId);
    }
    // ---- INSERT / REMOVE (§4.3) — topology only, content untouched. ----
    /**
     * §4.3 `INSERT` table effect: unlinks each id from wherever it currently is (a move), then
     * links the whole batch, in wire order, immediately before `before` (or at the end of
     * `parent`'s children when `before === 0`). Exactly two rows change per link (the linked id,
     * and whichever row now follows it) — never O(children in parent).
     */
    insertBatch(parent, before, ids) {
        let prev = before === NONE ? this.lastChildOf.get(parent) ?? NONE : this.rows.get(before)?.prevSibling ?? NONE;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const existing = this.rows.get(id);
            if (existing !== undefined && existing.parent !== NONE)
                this.unlink(id, existing);
            this.linkAfter(id, parent, prev);
            prev = id;
        }
        if (before !== NONE) {
            this.relinkPrevSibling(before, prev);
            if (prev !== NONE)
                this.nextSiblingOf.set(prev, before);
        }
        else {
            this.lastChildOf.set(parent, prev);
        }
    }
    /**
     * §4.3 `REMOVE` table effect: detaches each id and repairs the sibling that followed it.
     * `parent` is redundant with the table (§4.3: "kept as a cheap assert") — accepted here for
     * call-site symmetry with `RemoveOp`; precondition validation (Stage 2) is what actually checks
     * it against `getRow(id).parent`, not this method.
     */
    removeBatch(_parent, ids) {
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const row = this.rows.get(id);
            if (row === undefined)
                continue;
            this.unlink(id, row);
            this.setRow(id, row.kind, NONE, NONE, row.contentHash);
        }
    }
    /** `NODE_DROP` (§4.2, OPEN-1/OPEN-2, Stage 3) — permanently removes one row's contract state. */
    dropRow(id) {
        const owned = this.shadowRootByHost.get(id);
        if (owned !== undefined)
            this.hostOfShadowRoot.delete(owned);
        this.shadowRootByHost.delete(id);
        const host = this.hostOfShadowRoot.get(id);
        if (host !== undefined)
            this.shadowRootByHost.delete(host);
        this.hostOfShadowRoot.delete(id);
        this.rows.delete(id);
        this.attrHashes.delete(id);
        this.propHashes.delete(id);
        this.propValues.delete(id);
        this.nextSiblingOf.delete(id);
        this.lastChildOf.delete(id);
        this.tracker.remove(id);
    }
    /**
     * `NODE_DROP`'s actual `Table` effect (§4.2: "drops each row **and all its descendants** — a
     * detached row may still have children"). `id` is a subtree root (validated by the caller —
     * `replicatedTableApply.ts` — to have `parent = 0` before this runs); its descendants are
     * discovered by walking the same derived links `INSERT`/`REMOVE` already maintain
     * (`lastChildOf` + each child's own `prevSibling`), never touched by `unlink()` when only the
     * *root* of a detached subtree was itself detached from its old parent. Returns every id
     * actually dropped (root + descendants) so the caller (producer: `tableFrameBuilder.ts`) can
     * release the matching `DomNodeTable` identity entries too.
     */
    dropSubtree(id) {
        const ids = [];
        this.collectSubtreeIds(id, ids);
        for (let i = 0; i < ids.length; i++)
            this.dropRow(ids[i]);
        return ids;
    }
    /**
     * Read-only twin of {@link dropSubtree}'s discovery walk — same root+descendants list, no
     * mutation. Lets a caller that needs to know the *full* set before the table effect actually
     * runs (producer: `tableFrameBuilder.ts`'s `emitNodeDropSweep`, which must release every
     * descendant's `DomNodeTable` identity too, not just the swept root's — a live JS reference
     * that later reinserts an unreleased descendant would otherwise be handed back its old,
     * already-dropped id, corrupting `ReplicatedTable` silently instead of being re-described as
     * new content) query it ahead of the real drop.
     */
    subtreeIds(id) {
        const ids = [];
        this.collectSubtreeIds(id, ids);
        return ids;
    }
    /**
     * Detached (`parent === 0`) subtree roots whose `lms` is at least `maxAge` frame-`sequence`s
     * behind `currentSequence` — OPEN-2's deferred-age GC sweep candidates (§1.6). Non-root
     * detached descendants (`parent !== 0`, pointing at another detached row) are excluded: they
     * are collected transitively by `dropSubtree` once their root is chosen, never listed on the
     * wire themselves (§4.2). Bounded by `limit` — same "forced flush over unbounded per-tick
     * work" reasoning as `MAX_DIRTY_NODES` (§8).
     */
    collectDroppableIds(currentSequence, maxAge, limit) {
        const out = [];
        for (const [id, row] of this.rows) {
            if (out.length >= limit)
                break;
            if (row.parent !== NONE)
                continue;
            if (currentSequence - row.lms >= maxAge)
                out.push(id);
        }
        return out;
    }
    collectSubtreeIds(id, out) {
        out.push(id);
        const seen = new Set();
        let child = this.lastChildOf.get(id) ?? NONE;
        while (child !== NONE) {
            if (seen.has(child))
                break;
            seen.add(child);
            this.collectSubtreeIds(child, out);
            const row = this.rows.get(child);
            child = row?.prevSibling ?? NONE;
        }
        const shadow = this.shadowRootByHost.get(id);
        if (shadow !== undefined && shadow !== id)
            this.collectSubtreeIds(shadow, out);
    }
    // ---- internals ----
    setRow(id, kind, parent, prevSibling, contentHash) {
        const rowHash = (0, rowHash_1.computeRowHash)(id, kind, parent, prevSibling, contentHash);
        this.rows.set(id, { kind, parent, prevSibling, contentHash, rowHash, lms: this.currentSequence });
        this.tracker.upsert(id, rowHash);
    }
    relinkPrevSibling(id, prevSibling) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        this.setRow(id, row.kind, row.parent, prevSibling, row.contentHash);
    }
    linkAfter(id, parent, prevId) {
        const row = this.rows.get(id);
        const kind = row?.kind ?? opcodes_1.NodeKind.Element;
        const contentHash = row?.contentHash ?? 0n;
        this.setRow(id, kind, parent, prevId, contentHash);
        if (prevId !== NONE)
            this.nextSiblingOf.set(prevId, id);
    }
    /** Removes `id` from its current position, repairing its neighbor's `prevSibling`/`lastChildOf`. */
    unlink(id, row) {
        if (row.parent === NONE)
            return;
        const nextId = this.nextSiblingOf.get(id) ?? NONE;
        this.nextSiblingOf.delete(id);
        if (nextId !== NONE) {
            this.relinkPrevSibling(nextId, row.prevSibling);
            if (row.prevSibling !== NONE)
                this.nextSiblingOf.set(row.prevSibling, nextId);
        }
        else if (this.lastChildOf.get(row.parent) === id) {
            this.lastChildOf.set(row.parent, row.prevSibling);
            // Prev's derived next still pointed at `id` (the old last child). Leaving it set makes the
            // next unlink of `prev` take the "has next" branch and skip lastChildOf — OPEN-8, the
            // prepend+tail-evict shape: lastChildOf stays on a now-detached row and orderedChildIds
            // walks a single id (O2 `table=[118]` vs hundreds live).
            if (row.prevSibling !== NONE)
                this.nextSiblingOf.delete(row.prevSibling);
        }
    }
}
exports.ReplicatedTable = ReplicatedTable;
//# sourceMappingURL=replicatedTable.js.map