"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameAccumulator = void 0;
const observe_1 = require("./observe");
function childRefIds(refs) {
    return refs.map((r) => (r.kind === 'existing' ? r.id : r.node.id));
}
function isPrefix(previous, current) {
    if (previous.length > current.length)
        return false;
    for (let i = 0; i < previous.length; i++) {
        if (previous[i] !== current[i])
            return false;
    }
    return true;
}
class FrameAccumulator {
    query;
    newIds = new Set();
    dirtyParents = new Set();
    attrDirty = new Set();
    textDirty = new Set();
    stateDirty = new Set();
    scrollDirty = new Map();
    detached = new Set();
    /** Last emitted child-id order per parent, so §5.4.2's APPEND fast path can be detected. */
    lastEmittedChildren = new Map();
    constructor(query) {
        this.query = query;
    }
    /** Merges one observe.ts `DirtyState` snapshot in (§5.3.2 accumulation). */
    absorb(dirty) {
        for (const id of dirty.newIds)
            this.newIds.add(id);
        for (const id of dirty.dirtyParents)
            this.dirtyParents.add(id);
        for (const id of dirty.attrDirty)
            this.attrDirty.add(id);
        for (const id of dirty.textDirty)
            this.textDirty.add(id);
        for (const id of dirty.stateDirty)
            this.stateDirty.add(id);
        for (const id of dirty.detached)
            this.detached.add(id);
        for (const [target, sample] of dirty.scrollDirty)
            this.scrollDirty.set(target, sample);
    }
    /** §5.3.3 — flush in the mandated order. Returns null when there is nothing to send (PP-FR-4). */
    flush() {
        this.pruneEphemerals();
        this.pruneWithin(this.newIds); // absorb descendants (step 2)
        this.pruneWithin(this.detached); // prune orphans (step 3)
        const ops = [];
        this.emitChildLists(ops); // step 4
        this.emitPatches(ops); // step 5
        this.emitScroll(ops); // step 7 (step 6 — cssom — is a sibling plane, merged by the caller)
        this.forgetDetachedParents();
        this.reset();
        return ops.length > 0 ? ops : null;
    }
    /** Step 1 — a node created and destroyed within the frame is never sent. */
    pruneEphemerals() {
        for (const id of [...this.newIds]) {
            const node = this.query.resolve(id);
            if (node === undefined || !this.query.isConnected(node)) {
                this.newIds.delete(id);
                this.discardAllFor(id);
            }
        }
    }
    /** Steps 2 and 3 share one shape: drop entries whose id is within `ancestors`. */
    pruneWithin(ancestors) {
        if (ancestors.size === 0)
            return;
        for (const id of [...this.attrDirty])
            if (this.query.isWithin(id, ancestors))
                this.attrDirty.delete(id);
        for (const id of [...this.textDirty])
            if (this.query.isWithin(id, ancestors))
                this.textDirty.delete(id);
        for (const id of [...this.stateDirty])
            if (this.query.isWithin(id, ancestors))
                this.stateDirty.delete(id);
        for (const id of [...this.dirtyParents])
            if (this.query.isWithin(id, ancestors))
                this.dirtyParents.delete(id);
    }
    emitChildLists(ops) {
        const parents = [...this.dirtyParents].sort((a, b) => this.query.compareDocumentOrder(a, b));
        for (const parentId of parents) {
            const current = this.query.childListSnapshot(parentId);
            if (current === undefined)
                continue;
            const currentIds = childRefIds(current);
            const previous = this.lastEmittedChildren.get(parentId);
            const append = previous !== undefined && isPrefix(previous, currentIds);
            const appended = append ? current.slice(previous.length) : current;
            if (append && appended.length === 0) {
                this.lastEmittedChildren.set(parentId, currentIds);
                continue; // marked dirty but no net change — nothing to send.
            }
            ops.push({
                op: 'childList',
                parent: parentId,
                mode: append ? 'append' : 'full',
                children: appended,
            });
            this.lastEmittedChildren.set(parentId, currentIds);
        }
    }
    emitPatches(ops) {
        const dirty = new Set([...this.attrDirty, ...this.textDirty, ...this.stateDirty]);
        for (const id of dirty) {
            const snapshot = this.query.fullSnapshot(id);
            if (snapshot === undefined)
                continue;
            ops.push({ op: 'patch', node: id, snapshot });
        }
    }
    emitScroll(ops) {
        for (const [target, sample] of this.scrollDirty) {
            if (target === observe_1.VIEWPORT_SCROLL_TARGET) {
                ops.push({ op: 'scrollViewport', x: sample.x, y: sample.y });
            }
            else {
                ops.push({ op: 'scrollElement', node: target, top: sample.y, left: sample.x });
            }
        }
    }
    /** Evict the append-cache for parents that were themselves detached this frame. */
    forgetDetachedParents() {
        for (const id of this.detached)
            this.lastEmittedChildren.delete(id);
    }
    discardAllFor(id) {
        this.attrDirty.delete(id);
        this.textDirty.delete(id);
        this.stateDirty.delete(id);
        this.dirtyParents.delete(id);
        this.scrollDirty.delete(id);
    }
    reset() {
        this.newIds.clear();
        this.dirtyParents.clear();
        this.attrDirty.clear();
        this.textDirty.clear();
        this.stateDirty.clear();
        this.scrollDirty.clear();
        this.detached.clear();
    }
}
exports.FrameAccumulator = FrameAccumulator;
//# sourceMappingURL=frame.js.map