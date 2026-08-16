"use strict";
/**
 * Phase-2 CSSOM insert index from the instruction's `before` (§4.6), among objects already
 * materialized — not the post-frame table child list.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderedSheetIds = orderedSheetIds;
exports.insertIndexFromBefore = insertIndexFromBefore;
const frame_1 = require("./frame");
const opcodes_1 = require("./opcodes");
/** Sheets currently parented at document (post-frame table). Used only as an end-of-frame check. */
function orderedSheetIds(table) {
    const all = table.orderedChildIds(frame_1.DOCUMENT_ID);
    const out = [];
    for (let i = 0; i < all.length; i++) {
        const id = all[i];
        const row = table.getRow(id);
        if (row !== undefined && row.kind === opcodes_1.NodeKind.Sheet)
            out.push(id);
    }
    return out;
}
/**
 * `insertRule` / adopted-list splice index: `INSERT_AT_END` → after the last materialized
 * sibling; otherwise the index of `before` in `materializedIds`. Missing `before` → -1.
 */
function insertIndexFromBefore(materializedIds, before) {
    if (before === frame_1.INSERT_AT_END)
        return materializedIds.length;
    for (let i = 0; i < materializedIds.length; i++) {
        if (materializedIds[i] === before)
            return i;
    }
    return -1;
}
//# sourceMappingURL=cssomApplyIndex.js.map