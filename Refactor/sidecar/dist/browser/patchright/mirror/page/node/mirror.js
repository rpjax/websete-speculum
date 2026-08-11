"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeMirror = exports.MirrorDesyncError = void 0;
/** §5.7.1 — every desync trigger the mirror can detect throws this; the caller MUST treat it as desync. */
class MirrorDesyncError extends Error {
}
exports.MirrorDesyncError = MirrorDesyncError;
const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
function escapeHtmlText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
class NodeMirror {
    nodes = new Map();
    rootId = null;
    get size() {
        return this.nodes.size;
    }
    get root() {
        return this.rootId;
    }
    get(id) {
        return this.nodes.get(id);
    }
    setRoot(id) {
        this.rootId = id;
    }
    /**
     * Bulk-loads a full F snapshot directly (e.g. from the establish stream's
     * initial walk), without requiring a pre-existing parent the way a live
     * `childList` frame does. Sets the mirror root to `node.id`.
     */
    seedRoot(node) {
        this.registerSnapshot(node);
        this.rootId = node.id;
    }
    clear() {
        this.nodes.clear();
        this.rootId = null;
    }
    /**
     * §5.9.1 — applies one already-assembled frame as a single transaction.
     * Any address miss (an `existing` id absent from the mirror, or a `patch`/
     * `childList` targeting an unknown node) throws `MirrorDesyncError` (§5.7.1)
     * — this MUST never be caught and silently ignored by the caller.
     */
    applyFrame(ops) {
        for (const op of ops) {
            if (op.op === 'childList')
                this.applyChildList(op.parent, op.mode, op.children);
            else if (op.op === 'patch')
                this.applyPatch(op.node, op.snapshot);
            // scrollViewport / scrollElement carry no tree-shape effect on the mirror.
        }
    }
    applyChildList(parentId, mode, children) {
        const parent = this.nodes.get(parentId);
        if (!parent)
            throw new MirrorDesyncError(`childList: parent ${parentId} not found`);
        const resolvedIds = [];
        for (const ref of children) {
            if (ref.kind === 'existing') {
                if (!this.nodes.has(ref.id))
                    throw new MirrorDesyncError(`childList: existing id ${ref.id} not found`);
                resolvedIds.push(ref.id);
            }
            else {
                this.registerSnapshot(ref.node);
                resolvedIds.push(ref.node.id);
            }
        }
        if (mode === 'full') {
            const removedIds = parent.childIds.filter((id) => !resolvedIds.includes(id));
            for (const id of removedIds)
                this.unregisterSubtree(id);
            parent.childIds = resolvedIds;
        }
        else {
            parent.childIds = parent.childIds.concat(resolvedIds);
        }
    }
    applyPatch(id, snapshot) {
        const existing = this.nodes.get(id);
        if (!existing)
            throw new MirrorDesyncError(`patch: id ${id} not found`);
        if (snapshot.kind === 'element') {
            existing.tag = snapshot.tag;
            existing.attrs = { ...snapshot.attrs };
        }
        else {
            existing.value = snapshot.value;
        }
    }
    registerSnapshot(node) {
        if (node.kind === 'element') {
            const childIds = node.children.map((c) => c.id);
            this.nodes.set(node.id, { kind: 'element', tag: node.tag, attrs: { ...node.attrs }, childIds });
            for (const child of node.children)
                this.registerSnapshot(child);
        }
        else {
            this.nodes.set(node.id, {
                kind: node.kind,
                tag: node.kind === 'text' ? '#text' : '#comment',
                attrs: {},
                childIds: [],
                value: node.value,
            });
        }
    }
    unregisterSubtree(id) {
        const node = this.nodes.get(id);
        if (!node)
            return;
        for (const childId of node.childIds)
            this.unregisterSubtree(childId);
        this.nodes.delete(id);
    }
    /** §5.7.2.3 — resync source: serialize the mirror to well-formed HTML, ids riding as `speculum-anchor`. */
    serializeToHtml(rootId = this.rootId) {
        if (rootId === null)
            return '';
        const node = this.nodes.get(rootId);
        if (!node)
            return '';
        return this.serializeNode(node, rootId);
    }
    serializeNode(node, id) {
        if (node.kind === 'text')
            return escapeHtmlText(node.value ?? '');
        if (node.kind === 'comment')
            return `<!--${node.value ?? ''}-->`;
        const attrPairs = Object.entries(node.attrs)
            .map(([name, value]) => ` ${name}="${escapeHtmlAttr(value)}"`)
            .join('');
        const anchorAttr = ` speculum-anchor="${id}"`;
        if (VOID_TAGS.has(node.tag))
            return `<${node.tag}${anchorAttr}${attrPairs}>`;
        const inner = node.childIds
            .map((childId) => {
            const child = this.nodes.get(childId);
            return child ? this.serializeNode(child, childId) : '';
        })
            .join('');
        return `<${node.tag}${anchorAttr}${attrPairs}>${inner}</${node.tag}>`;
    }
}
exports.NodeMirror = NodeMirror;
//# sourceMappingURL=mirror.js.map