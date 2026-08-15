/**
 * In-page CSSOM poll — cost experiment. Walks readable sheets, fingerprints rule-object
 * identity, then serializes `cssText` for content hashes. Does **not** emit SHEET/RULE
 * opcodes (wire still DOM-only). No CDP CSS domain. No prototype hooks.
 */

import { diffRules, type RuleSnap } from './cssomReconcile';
import { fnv1a32 } from './fnv32';

/** One poll pass — names match TelemetryCssomPoll (investigation, not an assert). */
export type CssomPollStats = {
  /** Wall time of this pass (identity walk + cssText serialize). */
  pollMs: number;
  /** Walk CSSRule object identity / length — no serialization. */
  identityWalkMs: number;
  /** `rule.cssText` + hash. Dominates pollMs when every top-level rule is serialized. */
  cssTextSerializeMs: number;
  /** Sheets whose `cssRules` was readable (not SecurityError). */
  readableSheetCount: number;
  /** Sheets skipped (typically cross-origin `<link>`). */
  unreadableSheetCount: number;
  /** Top-level `cssRules` entries visited. Does not recurse `@media` children. */
  topLevelRulesVisited: number;
  /** How many of those had `cssText` read this pass. */
  topLevelRulesSerialized: number;
  /** `<style>` sheets whose `textContent` hash matched the previous pass. */
  styleTagTextUnchangedSheets: number;
  rulesAppeared: number;
  rulesDisappeared: number;
  rulesTextChangedInPlace: number;
  sheetsWithRuleListChanged: number;
};

const EMPTY: CssomPollStats = {
  pollMs: 0,
  identityWalkMs: 0,
  cssTextSerializeMs: 0,
  readableSheetCount: 0,
  unreadableSheetCount: 0,
  topLevelRulesVisited: 0,
  topLevelRulesSerialized: 0,
  styleTagTextUnchangedSheets: 0,
  rulesAppeared: 0,
  rulesDisappeared: 0,
  rulesTextChangedInPlace: 0,
  sheetsWithRuleListChanged: 0,
};

export class CssomPoller {
  private readonly lastRules = new WeakMap<CSSStyleSheet, RuleSnap[]>();
  private readonly lastStyleTagTextHash = new WeakMap<CSSStyleSheet, number>();

  poll(doc: Document = document): CssomPollStats {
    const t0 = performance.now();
    const sheets = collectSheets(doc);
    let unreadableSheetCount = 0;
    let topLevelRulesVisited = 0;
    let topLevelRulesSerialized = 0;
    let styleTagTextUnchangedSheets = 0;
    let rulesAppeared = 0;
    let rulesDisappeared = 0;
    let rulesTextChangedInPlace = 0;
    let sheetsWithRuleListChanged = 0;

    const readable: CSSStyleSheet[] = [];
    const ruleLists: CSSRuleList[] = [];
    for (const sheet of sheets) {
      const list = tryCssRules(sheet);
      if (list === null) {
        unreadableSheetCount += 1;
        continue;
      }
      readable.push(sheet);
      ruleLists.push(list);
    }

    const tIdentity0 = performance.now();
    const snaps: RuleSnap[][] = [];
    for (let s = 0; s < readable.length; s++) {
      const list = ruleLists[s]!;
      const snap: RuleSnap[] = [];
      const n = list.length;
      topLevelRulesVisited += n;
      for (let i = 0; i < n; i++) {
        const rule = list.item(i);
        if (rule === null) continue;
        snap.push({ key: rule, contentHash: 0 });
      }
      snaps.push(snap);
    }
    const identityWalkMs = performance.now() - tIdentity0;

    const tSerialize0 = performance.now();
    for (let s = 0; s < readable.length; s++) {
      const sheet = readable[s]!;
      const snap = snaps[s]!;
      const styleTagHash = styleElementTextHash(sheet);
      if (styleTagHash !== null) {
        const prev = this.lastStyleTagTextHash.get(sheet);
        if (prev === styleTagHash) styleTagTextUnchangedSheets += 1;
        this.lastStyleTagTextHash.set(sheet, styleTagHash);
      }
      for (const row of snap) {
        const text = (row.key as CSSRule).cssText;
        topLevelRulesSerialized += 1;
        row.contentHash = fnv1a32(text);
      }
      const prev = this.lastRules.get(sheet) ?? [];
      const delta = diffRules(prev, snap);
      rulesAppeared += delta.rulesAppeared;
      rulesDisappeared += delta.rulesDisappeared;
      rulesTextChangedInPlace += delta.rulesTextChangedInPlace;
      if (delta.ruleListChanged) sheetsWithRuleListChanged += 1;
      this.lastRules.set(sheet, snap);
    }
    const cssTextSerializeMs = performance.now() - tSerialize0;

    return {
      pollMs: performance.now() - t0,
      identityWalkMs,
      cssTextSerializeMs,
      readableSheetCount: readable.length,
      unreadableSheetCount,
      topLevelRulesVisited,
      topLevelRulesSerialized,
      styleTagTextUnchangedSheets,
      rulesAppeared,
      rulesDisappeared,
      rulesTextChangedInPlace,
      sheetsWithRuleListChanged,
    };
  }
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

function styleElementTextHash(sheet: CSSStyleSheet): number | null {
  const node = sheet.ownerNode;
  if (node === null || node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  if (el.localName !== 'style') return null;
  return fnv1a32(el.textContent ?? '');
}

export function emptyCssomPollStats(): CssomPollStats {
  return { ...EMPTY };
}
