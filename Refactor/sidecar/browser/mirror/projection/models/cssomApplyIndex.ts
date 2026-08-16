/**
 * Phase-2 CSSOM insert index from the instruction's `before` (§4.6), among objects already
 * materialized — not the post-frame table child list.
 */

import { DOCUMENT_ID, INSERT_AT_END } from './frame';
import { NodeKind } from './opcodes';
import type { ReplicatedTable } from './replicatedTable';

/** Sheets currently parented at document (post-frame table). Used only as an end-of-frame check. */
export function orderedSheetIds(table: ReplicatedTable): number[] {
  const all = table.orderedChildIds(DOCUMENT_ID);
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const id = all[i]!;
    const row = table.getRow(id);
    if (row !== undefined && row.kind === NodeKind.Sheet) out.push(id);
  }
  return out;
}

/**
 * `insertRule` / adopted-list splice index: `INSERT_AT_END` → after the last materialized
 * sibling; otherwise the index of `before` in `materializedIds`. Missing `before` → -1.
 */
export function insertIndexFromBefore(materializedIds: readonly number[], before: number): number {
  if (before === INSERT_AT_END) return materializedIds.length;
  for (let i = 0; i < materializedIds.length; i++) {
    if (materializedIds[i] === before) return i;
  }
  return -1;
}
