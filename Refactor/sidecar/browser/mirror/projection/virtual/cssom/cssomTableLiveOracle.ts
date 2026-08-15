/**
 * Virtual-side CSSOM O2 walk — live styleSheets/adopted + cssRules × CssomIds, then models compare.
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

export function compareTableToLiveCssomDom(
  table: ReplicatedTable,
  ids: CssomIds | null,
  doc: Document = document,
): CssomTableLiveOracleResult {
  if (ids === null) return emptyCssomTableLiveOracleResult();
  const liveSheets: CssomLiveSheetSnap[] = [];
  for (const sheet of collectSheets(doc)) {
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

function collectSheets(doc: Document): CSSStyleSheet[] {
  const out: CSSStyleSheet[] = [];
  const linked = doc.styleSheets;
  for (let i = 0; i < linked.length; i++) {
    const s = linked.item(i);
    if (s) out.push(s);
  }
  const adopted = doc.adoptedStyleSheets;
  if (adopted) {
    for (let i = 0; i < adopted.length; i++) {
      const s = adopted[i];
      if (s) out.push(s);
    }
  }
  return out;
}

function tryCssRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}
