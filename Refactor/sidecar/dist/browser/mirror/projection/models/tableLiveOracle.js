"use strict";
/**
 * Lab O2 local — producer ReplicatedTable × live child order (frame-protocol.md P0).
 * Pure: no DOM. Virtual walk lives in virtual/dom/tableLiveOracle.ts. Not per-tick (E1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareTableToLiveOrder = compareTableToLiveOrder;
const frame_1 = require("./frame");
const opcodes_1 = require("./opcodes");
const MAX_DIVERGENCES = 50;
const NONE = 0;
function isCssomKind(kind) {
    return kind === opcodes_1.NodeKind.Sheet || kind === opcodes_1.NodeKind.Rule;
}
function orderedDomChildIds(table, parent) {
    const all = table.orderedChildIds(parent);
    const out = [];
    for (let i = 0; i < all.length; i++) {
        const id = all[i];
        const row = table.getRow(id);
        if (row !== undefined && isCssomKind(row.kind))
            continue;
        out.push(id);
    }
    return out;
}
function idsEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
/**
 * `liveChildren`: parent id → projected child ids in live `childNodes` order (Document `1` included).
 * Detached table rows (`parent === 0`) may be omitted from live — OPEN-2 GC, not a failure.
 */
function compareTableToLiveOrder(table, liveChildren) {
    const divergences = [];
    let count = 0;
    const record = (path, kind, details) => {
        count += 1;
        if (divergences.length < MAX_DIVERGENCES)
            divergences.push({ path, kind, details });
    };
    const liveIds = new Set();
    for (const kids of liveChildren.values()) {
        for (let i = 0; i < kids.length; i++)
            liveIds.add(kids[i]);
    }
    const parents = new Set([frame_1.DOCUMENT_ID]);
    for (const parent of liveChildren.keys())
        parents.add(parent);
    for (const parent of parents) {
        const tableOrder = orderedDomChildIds(table, parent);
        const liveOrder = liveChildren.get(parent) ?? [];
        if (!idsEqual(tableOrder, liveOrder)) {
            const hashed = table.countAttachedChildren(parent);
            const lastWalk = tableOrder.length > 0 ? tableOrder[tableOrder.length - 1] : 0;
            const lastRow = lastWalk !== 0 ? table.getRow(lastWalk) : undefined;
            record(`#${parent}`, 'child_order_mismatch', `walkLen=${tableOrder.length} hashedAttached=${hashed} liveLen=${liveOrder.length}` +
                ` tableHead=[${tableOrder.slice(0, 8).join(',')}] liveHead=[${liveOrder.slice(0, 8).join(',')}]` +
                ` lastWalk=#${lastWalk} lastRow=${lastRow ? `parent=${lastRow.parent} prev=${lastRow.prevSibling}` : 'missing'}`);
        }
    }
    for (const id of liveIds) {
        const row = table.getRow(id);
        if (row === undefined) {
            record(`#${id}`, 'missing_in_table', 'connected mapped id has no table row');
        }
        else if (row.parent === NONE) {
            record(`#${id}`, 'detached_but_connected', 'table parent=0 but id appears in live child order');
        }
    }
    table.forEachRow((id, row) => {
        if (row.parent === NONE)
            return;
        if (isCssomKind(row.kind))
            return;
        const parentIsLive = row.parent === frame_1.DOCUMENT_ID || liveIds.has(row.parent) || liveChildren.has(row.parent);
        if (!parentIsLive)
            return;
        if (!liveIds.has(id)) {
            record(`#${id}`, 'extra_attached_in_table', `attached under ${row.parent} but absent from live walk`);
        }
    });
    return { kind: 'table_live', identical: count === 0, divergenceCount: count, divergences };
}
//# sourceMappingURL=tableLiveOracle.js.map