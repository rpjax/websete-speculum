/**
 * Phase-2 CSSOM insert index from the instruction's `before` (§4.6), among objects already
 * materialized — not the post-frame table child list.
 * SEAL-CSSOM-P0-EOF / PP-CSSOM-A-3: end-of-frame verify for sheet + rule membership/order.
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

/** Rule rows parented under a sheet (post-frame table order). */
export function orderedRuleIds(table: ReplicatedTable, sheetId: number): number[] {
  const all = table.orderedChildIds(sheetId);
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const id = all[i]!;
    const row = table.getRow(id);
    if (row !== undefined && row.kind === NodeKind.Rule) out.push(id);
  }
  return out;
}

export type CssomEndOfFrameMatch =
  | { ok: true }
  | { ok: false; op: 'sheetNew' | 'ruleNew' | 'ruleOrder'; id: number };

/**
 * Pure table × handle membership/order check (DOM-free). Live rule lists must be in cssRules order.
 */
export function matchCssomEndOfFrame(
  tableSheetIds: readonly number[],
  tableRuleIdsBySheet: ReadonlyMap<number, readonly number[]>,
  liveSheetIdsPresent: ReadonlySet<number>,
  liveRuleIdsBySheet: ReadonlyMap<number, readonly number[]>,
): CssomEndOfFrameMatch {
  for (let s = 0; s < tableSheetIds.length; s++) {
    const sheetId = tableSheetIds[s]!;
    if (!liveSheetIdsPresent.has(sheetId)) {
      return { ok: false, op: 'sheetNew', id: sheetId };
    }
    const tableRules = tableRuleIdsBySheet.get(sheetId) ?? [];
    const liveRules = liveRuleIdsBySheet.get(sheetId) ?? [];
    const liveSet = new Set(liveRules);
    for (let r = 0; r < tableRules.length; r++) {
      const ruleId = tableRules[r]!;
      if (!liveSet.has(ruleId)) {
        return { ok: false, op: 'ruleNew', id: ruleId };
      }
    }
    if (tableRules.length !== liveRules.length) {
      return { ok: false, op: 'ruleOrder', id: sheetId };
    }
    for (let r = 0; r < tableRules.length; r++) {
      if (tableRules[r] !== liveRules[r]) {
        return { ok: false, op: 'ruleOrder', id: tableRules[r]! };
      }
    }
  }
  return { ok: true };
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

/** Body of a style rule `cssText` (`.app{color:red}` → `color:red`). Whole string if no `{…}`. */
export function declarationBlockFromRuleText(cssText: string): string {
  const open = cssText.indexOf('{');
  const close = cssText.lastIndexOf('}');
  if (open < 0 || close <= open) return cssText.trim();
  return cssText.slice(open + 1, close).trim();
}
