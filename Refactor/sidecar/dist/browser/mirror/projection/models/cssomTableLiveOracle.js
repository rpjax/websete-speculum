"use strict";
/**
 * Lab O2-class CSSOM — producer ReplicatedTable Sheet/Rule rows × live CSSOM (I2 top-level).
 * DOM-free comparison. Virtual walk lives in virtual/cssom/cssomTableLiveOracle.ts.
 * Not Projected CSS 1:1 (C6). Investigation/assert of detector+table only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyCssomTableLiveOracleResult = emptyCssomTableLiveOracleResult;
exports.compareTableToLiveCssom = compareTableToLiveCssom;
const frame_1 = require("./frame");
const opcodes_1 = require("./opcodes");
const MAX_DIVERGENCES = 50;
function idsEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
function orderedKindChildIds(table, parent, kind) {
    const all = table.orderedChildIds(parent);
    const out = [];
    for (let i = 0; i < all.length; i++) {
        const id = all[i];
        const row = table.getRow(id);
        if (row !== undefined && row.kind === kind)
            out.push(id);
    }
    return out;
}
function emptyCssomTableLiveOracleResult() {
    return { kind: 'cssom_table_live', identical: true, divergenceCount: 0, divergences: [] };
}
function compareTableToLiveCssom(table, liveSheets) {
    const divergences = [];
    let count = 0;
    const record = (path, kind, details) => {
        count += 1;
        if (divergences.length < MAX_DIVERGENCES)
            divergences.push({ path, kind, details });
    };
    const byParent = new Map();
    for (const live of liveSheets) {
        const parent = live.hostNode ?? frame_1.DOCUMENT_ID;
        const key = parent === 0 ? frame_1.DOCUMENT_ID : parent;
        let group = byParent.get(key);
        if (group === undefined) {
            group = [];
            byParent.set(key, group);
        }
        group.push(live);
    }
    const tableParents = new Set([frame_1.DOCUMENT_ID, ...byParent.keys()]);
    table.forEachRow((_id, row) => {
        if (row.kind === opcodes_1.NodeKind.Sheet) {
            tableParents.add(row.parent === 0 ? frame_1.DOCUMENT_ID : row.parent);
        }
    });
    for (const parent of tableParents) {
        const tableSheets = orderedKindChildIds(table, parent, opcodes_1.NodeKind.Sheet);
        const liveGroup = byParent.get(parent) ?? [];
        const liveSheetIds = liveGroup.map((s) => s.id);
        if (!idsEqual(tableSheets, liveSheetIds)) {
            record(parent === frame_1.DOCUMENT_ID ? '#sheets' : `#${parent}/sheets`, 'sheet_order_mismatch', `table=[${tableSheets.slice(0, 8).join(',')}] live=[${liveSheetIds.slice(0, 8).join(',')}]`);
        }
        const liveSheetSet = new Set(liveSheetIds);
        for (const id of tableSheets) {
            if (!liveSheetSet.has(id))
                record(`#${id}`, 'extra_in_table', 'Sheet row not in live readable list');
        }
        for (const live of liveGroup) {
            if (table.getRow(live.id) === undefined) {
                record(`#${live.id}`, 'missing_in_table', 'live readable sheet has no table row');
                continue;
            }
            const tableRules = orderedKindChildIds(table, live.id, opcodes_1.NodeKind.Rule);
            if (!idsEqual(tableRules, live.ruleIds)) {
                record(`#${live.id}`, 'rule_order_mismatch', `table=[${tableRules.slice(0, 8).join(',')}] live=[${live.ruleIds.slice(0, 8).join(',')}]`);
            }
            const n = Math.min(tableRules.length, live.ruleIds.length, live.ruleHashes.length);
            for (let i = 0; i < n; i++) {
                const rid = live.ruleIds[i];
                if (tableRules[i] !== rid)
                    continue;
                const row = table.getRow(rid);
                if (row === undefined) {
                    record(`#${rid}`, 'missing_in_table', 'live rule has no table row');
                    continue;
                }
                if (row.contentHash !== live.ruleHashes[i]) {
                    record(`#${rid}`, 'rule_content_mismatch', `sheet=#${live.id} contentHash diverged`);
                }
            }
            for (const rid of live.ruleIds) {
                if (table.getRow(rid) === undefined)
                    record(`#${rid}`, 'missing_in_table', 'live rule has no table row');
            }
            for (const rid of tableRules) {
                if (!live.ruleIds.includes(rid))
                    record(`#${rid}`, 'extra_in_table', `Rule row not in live cssRules of sheet #${live.id}`);
            }
        }
    }
    return { kind: 'cssom_table_live', identical: count === 0, divergenceCount: count, divergences };
}
//# sourceMappingURL=cssomTableLiveOracle.js.map