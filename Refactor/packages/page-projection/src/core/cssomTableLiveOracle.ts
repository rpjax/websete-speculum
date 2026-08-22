/**
 * Lab O2-class CSSOM — producer ReplicatedTable Sheet/Rule rows × live CSSOM (I2 top-level).
 * DOM-free comparison. Virtual walk lives in virtual/cssom/cssomTableLiveOracle.ts.
 * Not Projected CSS 1:1 (C6). Investigation/assert of detector+table only.
 */

import { DOCUMENT_ID } from './frame';
import { NodeKind } from './opcodes';
import type { ReplicatedTable } from './replicatedTable';

export type CssomTableLiveDivergenceKind =
  | 'sheet_order_mismatch'
  | 'rule_order_mismatch'
  | 'rule_content_mismatch'
  | 'missing_in_table'
  | 'extra_in_table';

export type CssomTableLiveDivergence = {
  path: string;
  kind: CssomTableLiveDivergenceKind;
  details: string;
};

export type CssomTableLiveOracleResult = {
  kind: 'cssom_table_live';
  identical: boolean;
  divergenceCount: number;
  divergences: CssomTableLiveDivergence[];
};

export type CssomLiveSheetSnap = {
  id: number;
  /** 0 / omitted = document adopted list. */
  hostNode?: number;
  ruleIds: number[];
  ruleHashes: bigint[];
};

const MAX_DIVERGENCES = 50;

function idsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function orderedKindChildIds(table: ReplicatedTable, parent: number, kind: number): number[] {
  const all = table.orderedChildIds(parent);
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const id = all[i]!;
    const row = table.getRow(id);
    if (row !== undefined && row.kind === kind) out.push(id);
  }
  return out;
}

export function emptyCssomTableLiveOracleResult(): CssomTableLiveOracleResult {
  return { kind: 'cssom_table_live', identical: true, divergenceCount: 0, divergences: [] };
}

export function compareTableToLiveCssom(
  table: ReplicatedTable,
  liveSheets: readonly CssomLiveSheetSnap[],
): CssomTableLiveOracleResult {
  const divergences: CssomTableLiveDivergence[] = [];
  let count = 0;
  const record = (path: string, kind: CssomTableLiveDivergenceKind, details: string): void => {
    count += 1;
    if (divergences.length < MAX_DIVERGENCES) divergences.push({ path, kind, details });
  };

  const byParent = new Map<number, CssomLiveSheetSnap[]>();
  for (const live of liveSheets) {
    const parent = live.hostNode ?? DOCUMENT_ID;
    const key = parent === 0 ? DOCUMENT_ID : parent;
    let group = byParent.get(key);
    if (group === undefined) {
      group = [];
      byParent.set(key, group);
    }
    group.push(live);
  }

  const tableParents = new Set<number>([DOCUMENT_ID, ...byParent.keys()]);
  table.forEachRow((_id, row) => {
    if (row.kind === NodeKind.Sheet) {
      tableParents.add(row.parent === 0 ? DOCUMENT_ID : row.parent);
    }
  });

  for (const parent of tableParents) {
    const tableSheets = orderedKindChildIds(table, parent, NodeKind.Sheet);
    const liveGroup = byParent.get(parent) ?? [];
    const liveSheetIds = liveGroup.map((s) => s.id);
    if (!idsEqual(tableSheets, liveSheetIds)) {
      record(
        parent === DOCUMENT_ID ? '#sheets' : `#${parent}/sheets`,
        'sheet_order_mismatch',
        `table=[${tableSheets.slice(0, 8).join(',')}] live=[${liveSheetIds.slice(0, 8).join(',')}]`,
      );
    }

    const liveSheetSet = new Set(liveSheetIds);
    for (const id of tableSheets) {
      if (!liveSheetSet.has(id)) record(`#${id}`, 'extra_in_table', 'Sheet row not in live readable list');
    }
    for (const live of liveGroup) {
      if (table.getRow(live.id) === undefined) {
        record(`#${live.id}`, 'missing_in_table', 'live readable sheet has no table row');
        continue;
      }
      const tableRules = orderedKindChildIds(table, live.id, NodeKind.Rule);
      if (!idsEqual(tableRules, live.ruleIds)) {
        record(
          `#${live.id}`,
          'rule_order_mismatch',
          `table=[${tableRules.slice(0, 8).join(',')}] live=[${live.ruleIds.slice(0, 8).join(',')}]`,
        );
      }
      const n = Math.min(tableRules.length, live.ruleIds.length, live.ruleHashes.length);
      for (let i = 0; i < n; i++) {
        const rid = live.ruleIds[i]!;
        if (tableRules[i] !== rid) continue;
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
        if (table.getRow(rid) === undefined) record(`#${rid}`, 'missing_in_table', 'live rule has no table row');
      }
      for (const rid of tableRules) {
        if (!live.ruleIds.includes(rid)) record(`#${rid}`, 'extra_in_table', `Rule row not in live cssRules of sheet #${live.id}`);
      }
    }
  }

  return { kind: 'cssom_table_live', identical: count === 0, divergenceCount: count, divergences };
}
