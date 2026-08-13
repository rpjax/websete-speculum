"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotTreeQuery = void 0;
const fmap_1 = require("./fmap");
const identity_1 = require("./identity");
class SnapshotTreeQuery {
    mirrorBox;
    rewriterBox;
    byId = new Map();
    constructor(mirrorBox, rewriterBox) {
        this.mirrorBox = mirrorBox;
        this.rewriterBox = rewriterBox;
    }
    load(root) {
        const next = new Map();
        if (root) {
            let order = 0;
            const walk = (node, parentId) => {
                next.set(node.id, { raw: node, parentId, order: order++ });
                if (node.kind === 'element') {
                    for (const child of node.children)
                        walk(child, node.id);
                }
            };
            walk(root, identity_1.NONE_NODE_ID);
        }
        this.byId = next;
    }
    isConnected() {
        return true; // anything reachable from this tick's walk is, by construction, connected.
    }
    resolve(id) {
        return this.byId.has(id) ? { id } : undefined;
    }
    isWithin(id, ancestors) {
        let cur = id;
        while (cur !== undefined && cur !== identity_1.NONE_NODE_ID) {
            if (ancestors.has(cur))
                return true;
            cur = this.byId.get(cur)?.parentId;
        }
        return false;
    }
    childListSnapshot(parentId) {
        const entry = this.byId.get(parentId);
        if (!entry || entry.raw.kind !== 'element')
            return undefined;
        const mirror = this.mirrorBox.mirror;
        return entry.raw.children
            .filter((child) => this.byId.has(child.id))
            .map((child) => mirror?.get(child.id) !== undefined
            ? { kind: 'existing', id: child.id }
            : { kind: 'fresh', node: this.buildFullFNode(child) });
    }
    fullSnapshot(id) {
        const entry = this.byId.get(id);
        if (!entry)
            return undefined;
        return this.buildShallowFNode(entry.raw);
    }
    compareDocumentOrder(a, b) {
        return (this.byId.get(a)?.order ?? 0) - (this.byId.get(b)?.order ?? 0);
    }
    /** Full recursive F snapshot — used for `childList` fresh entries and the establish walk. */
    buildFullFNode(raw) {
        if (raw.kind !== 'element')
            return this.leafFNode(raw);
        return (0, fmap_1.publishElementSnapshot)({
            id: raw.id,
            rawTag: raw.tag,
            rawAttrs: this.rewriteAttrs(raw),
            children: raw.children.filter((c) => this.byId.has(c.id)).map((c) => this.buildFullFNode(c)),
            iframeHost: raw.tag.toLowerCase() === 'iframe',
            shadowRoot: raw.shadowRoot,
            shadowClosed: raw.shadowClosed,
            state: raw.state,
        });
    }
    buildShallowFNode(raw) {
        if (raw.kind !== 'element')
            return this.leafFNode(raw);
        return (0, fmap_1.publishElementSnapshot)({
            id: raw.id,
            rawTag: raw.tag,
            rawAttrs: this.rewriteAttrs(raw),
            children: [], // §5.4.1 — patch snapshots never carry children.
            iframeHost: raw.tag.toLowerCase() === 'iframe',
            shadowRoot: raw.shadowRoot,
            shadowClosed: raw.shadowClosed,
            state: raw.state,
        });
    }
    leafFNode(raw) {
        return raw.kind === 'text' ? (0, fmap_1.publishTextSnapshot)(raw.id, raw.value) : (0, fmap_1.publishCommentSnapshot)(raw.id, raw.value);
    }
    rewriteAttrs(raw) {
        const rewriter = this.rewriterBox.current;
        return raw.attrs.map(([name, value]) => [name, rewriter.rewriteAttrValue(name, value)]);
    }
}
exports.SnapshotTreeQuery = SnapshotTreeQuery;
//# sourceMappingURL=snapshotTreeQuery.js.map