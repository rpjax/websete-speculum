/**
 * Virtual-side CSSOM O2 walk — live constructed/adopted × CssomIds, then models compare.
 * Author `ownerNode` sheets are excluded (C6 no double-emit — paint via projected DOM).
 */

import { hashValue } from '../../models/rowHash';
import type { ReplicatedTable } from '../../models/replicatedTable';
import {
  compareTableToLiveCssom,
  emptyCssomTableLiveOracleResult,
  type CssomLiveSheetSnap,
  type CssomTableLiveOracleResult,
} from '../../models/cssomTableLiveOracle';
import type { CssomIds } from './cssomIds';
import { collectCssomPlaneSheets } from './cssomSheetList';

export function compareTableToLiveCssomDom(
  table: ReplicatedTable,
  ids: CssomIds | null,
  doc: Document = document,
): CssomTableLiveOracleResult {
  if (ids === null) return emptyCssomTableLiveOracleResult();
  const liveSheets: CssomLiveSheetSnap[] = [];
  for (const sheet of collectCssomPlaneSheets(doc)) {
    const list = tryCssRules(sheet);
    if (list === null) continue;
    const sheetId = ids.peekSheet(sheet);
    if (sheetId === undefined) continue;
    const ruleIds: number[] = [];
    const ruleHashes: bigint[] = [];
    for (let i = 0; i < list.length; i++) {
      const rule = list.item(i);
      if (rule === null) continue;
      const rid = ids.peekRule(rule);
      if (rid === undefined) continue;
      let text = '';
      try {
        text = rule.cssText;
      } catch {
        continue;
      }
      ruleIds.push(rid);
      ruleHashes.push(hashValue(text));
    }
    liveSheets.push({ id: sheetId, ruleIds, ruleHashes });
  }
  return compareTableToLiveCssom(table, liveSheets);
}

function tryCssRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}
