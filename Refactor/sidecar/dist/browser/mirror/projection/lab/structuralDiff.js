"use strict";
/**
 * Structural (topology-only) diff between a Virtual snapshot and a Client snapshot —
 * `TreeNode` shapes from `models/treeNode.ts` (produced by `client/domTreeSnapshot.ts` on
 * either side, see `lab/virtualSnapshot.ts` for the Virtual side). One "diff producer"
 * (`kind: 'structural'`) — a future pixel/visual producer can sit next to this one without
 * touching it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffTrees = diffTrees;
const MAX_DIVERGENCES = 50;
function diffTrees(virtual, client) {
    const divergences = [];
    let count = 0;
    const record = (path, kind, details) => {
        count += 1;
        if (divergences.length < MAX_DIVERGENCES)
            divergences.push({ path, kind, details });
    };
    walk(virtual, client, '#document', record);
    return { kind: 'structural', identical: count === 0, divergenceCount: count, divergences };
}
function walk(a, b, path, record) {
    if (a === undefined && b === undefined)
        return;
    if (a === undefined) {
        record(path, 'extra_node', `client has <${describe(b)}>, virtual has none`);
        return;
    }
    if (b === undefined) {
        record(path, 'missing_node', `virtual has <${describe(a)}>, client has none`);
        return;
    }
    if (a.tag !== b.tag) {
        record(path, 'tag_mismatch', `virtual=${a.tag} client=${b.tag}`);
        return; // divergent enough that walking children further is just noise on top of this
    }
    if ((a.text ?? '') !== (b.text ?? '')) {
        record(path, 'text_mismatch', `virtual=${JSON.stringify(a.text)} client=${JSON.stringify(b.text)}`);
    }
    const attrDetails = diffAttrs(a.attrs ?? [], b.attrs ?? []);
    if (attrDetails !== null)
        record(path, 'attr_mismatch', attrDetails);
    const aChildren = a.children ?? [];
    const bChildren = b.children ?? [];
    if (aChildren.length !== bChildren.length) {
        record(path, 'child_count_mismatch', `virtual=${aChildren.length} client=${bChildren.length}`);
    }
    const max = Math.max(aChildren.length, bChildren.length);
    for (let i = 0; i < max; i++) {
        walk(aChildren[i], bChildren[i], `${path}>${a.tag}[${i}]`, record);
    }
}
function diffAttrs(a, b) {
    const am = new Map(a);
    const bm = new Map(b);
    const parts = [];
    for (const [k, v] of am) {
        if (!bm.has(k))
            parts.push(`-${k}`);
        else if (bm.get(k) !== v)
            parts.push(`~${k} (virtual=${v} client=${bm.get(k)})`);
    }
    for (const [k] of bm) {
        if (!am.has(k))
            parts.push(`+${k}`);
    }
    return parts.length > 0 ? parts.join(', ') : null;
}
function describe(node) {
    return node.tag + (node.text !== undefined ? `:${JSON.stringify(node.text)}` : '');
}
//# sourceMappingURL=structuralDiff.js.map