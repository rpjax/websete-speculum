/**
 * Compact replicated-table identity for probes (not telemetry).
 * `rowCount` is {@link ReplicatedTable.size} — Document id 1 is implicit and not a row.
 * `tableHash` is §1.5 `tableHash` as a decimal string (JSON-safe).
 */

import type { ReplicatedTable } from './replicatedTable';

export type ReplicatedTableDigest = {
  rowCount: number;
  tableHash: string;
};

export function digestReplicatedTable(table: ReplicatedTable): ReplicatedTableDigest {
  return { rowCount: table.size, tableHash: table.tableHash.toString() };
}

export function tableDigestsEqual(a: ReplicatedTableDigest, b: ReplicatedTableDigest): boolean {
  return a.rowCount === b.rowCount && a.tableHash === b.tableHash;
}
