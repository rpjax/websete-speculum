"use strict";
/**
 * Compact replicated-table identity for probes (not telemetry).
 * `rowCount` is {@link ReplicatedTable.size} — Document id 1 is implicit and not a row.
 * `tableHash` is §1.5 `tableHash` as a decimal string (JSON-safe).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.digestReplicatedTable = digestReplicatedTable;
exports.tableDigestsEqual = tableDigestsEqual;
function digestReplicatedTable(table) {
    return { rowCount: table.size, tableHash: table.tableHash.toString() };
}
function tableDigestsEqual(a, b) {
    return a.rowCount === b.rowCount && a.tableHash === b.tableHash;
}
//# sourceMappingURL=tableDigest.js.map