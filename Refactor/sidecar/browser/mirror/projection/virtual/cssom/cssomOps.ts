/**
 * Live delta / resync snapshot → §4.6 FrameOp. C3.1: in-place RULE_SET on CSSStyleRule;
 * never SHEET_DROP a live sheet just to refresh rules. Grouping-rule content change
 * (patch cannot work) → RULE_DROP + RULE_NEW, not RULE_SET. Inserts without text omitted (next pass).
 */

import {
  CSSOM_SCOPE_MAIN,
  INSERT_AT_END,
  type FrameOp,
} from '../../models/frame';
import { OpCode } from '../../models/opcodes';
import { ruleAcceptsInPlaceSet } from '../../models/cssomRuleSet';
import type { CssomIds } from './cssomIds';
import type { RuleSnap } from './cssomReconcile';

export type CommittedSheet = {
  sheet: object;
  snaps: RuleSnap[];
  texts: Map<object, string>;
  /** Aborted this pass — keep membership, emit no DROP/NEW/SET for the sheet. */
  skipOps?: boolean;
};

export function emitResyncCssomOps(
  ids: CssomIds,
  sheets: readonly CommittedSheet[],
): FrameOp[] {
  const ops: FrameOp[] = [];
  const sheetIds: number[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const rec = sheets[i]!;
    const sheetId = ids.idOfSheet(rec.sheet);
    sheetIds.push(sheetId);
    ops.push({
      op: OpCode.SheetNew,
      id: sheetId,
      scope: CSSOM_SCOPE_MAIN,
      hostNode: 0,
      before: INSERT_AT_END,
    });
    for (let r = 0; r < rec.snaps.length; r++) {
      const snap = rec.snaps[r]!;
      const text = rec.texts.get(snap.key) ?? '';
      ops.push({
        op: OpCode.RuleNew,
        sheet: sheetId,
        id: ids.idOfRule(snap.key),
        before: INSERT_AT_END,
        text,
      });
    }
  }
  if (sheetIds.length > 1) {
    ops.push({ op: OpCode.SheetOrder, ids: sheetIds });
  }
  return ops;
}

/**
 * Delta vs last committed snaps. `hashed` is this pass's obtained hashes+text (copy survivors).
 * Live order is current topology. Unhashed live keys (insert after copy) are omitted.
 */
export function emitLiveCssomOps(
  ids: CssomIds,
  prevSheets: readonly object[],
  nextSheets: readonly CommittedSheet[],
  prevSnaps: WeakMap<object, RuleSnap[]>,
): FrameOp[] {
  const ops: FrameOp[] = [];
  const prevSet = new Set(prevSheets);
  const nextSet = new Set(nextSheets.map((s) => s.sheet));

  const dropped: number[] = [];
  for (const sheet of prevSheets) {
    if (nextSet.has(sheet)) continue;
    const id = ids.peekSheet(sheet);
    if (id !== undefined) dropped.push(id);
  }
  if (dropped.length > 0) ops.push({ op: OpCode.SheetDrop, ids: dropped });

  const nextIds: number[] = [];
  for (let i = 0; i < nextSheets.length; i++) {
    const rec = nextSheets[i]!;
    const sheetId = ids.idOfSheet(rec.sheet);
    nextIds.push(sheetId);
    if (rec.skipOps) continue;
    if (!prevSet.has(rec.sheet)) {
      ops.push({
        op: OpCode.SheetNew,
        id: sheetId,
        scope: CSSOM_SCOPE_MAIN,
        hostNode: 0,
        before: INSERT_AT_END,
      });
    }
    ops.push(...emitRuleDelta(ids, sheetId, prevSnaps.get(rec.sheet) ?? [], rec));
  }

  const prevIds = prevSheets.map((s) => ids.peekSheet(s)).filter((x): x is number => x !== undefined);
  if (!sameIdOrder(prevIds, nextIds) && nextIds.length > 0) {
    ops.push({ op: OpCode.SheetOrder, ids: nextIds });
  }
  return ops;
}

function emitRuleDelta(
  ids: CssomIds,
  sheetId: number,
  prev: readonly RuleSnap[],
  rec: CommittedSheet,
): FrameOp[] {
  const ops: FrameOp[] = [];
  const prevKeys = new Set(prev.map((s) => s.key));
  const nextKeys = new Set(rec.snaps.map((s) => s.key));

  const prevHash = new Map<object, number>();
  for (const row of prev) prevHash.set(row.key, row.contentHash);

  const replaceKeys = new Set<object>();
  for (let i = 0; i < rec.snaps.length; i++) {
    const snap = rec.snaps[i]!;
    if (!prevKeys.has(snap.key)) continue;
    if (prevHash.get(snap.key) === snap.contentHash) continue;
    if (ruleAcceptsInPlaceSet(snap.key)) continue;
    replaceKeys.add(snap.key);
  }

  const dropIds: number[] = [];
  for (const row of prev) {
    if (nextKeys.has(row.key) && !replaceKeys.has(row.key)) continue;
    const id = ids.peekRule(row.key);
    if (id !== undefined) dropIds.push(id);
    ids.forgetRule(row.key);
  }
  if (dropIds.length > 0) ops.push({ op: OpCode.RuleDrop, sheet: sheetId, ids: dropIds });

  for (let i = 0; i < rec.snaps.length; i++) {
    const snap = rec.snaps[i]!;
    const text = rec.texts.get(snap.key) ?? '';
    let before = INSERT_AT_END;
    for (let j = i + 1; j < rec.snaps.length; j++) {
      const nextId = ids.peekRule(rec.snaps[j]!.key);
      if (nextId === undefined) continue;
      before = nextId;
      break;
    }
    if (!prevKeys.has(snap.key) || replaceKeys.has(snap.key)) {
      ops.push({
        op: OpCode.RuleNew,
        sheet: sheetId,
        id: ids.idOfRule(snap.key),
        before,
        text,
      });
      continue;
    }
    const old = prevHash.get(snap.key);
    if (old !== snap.contentHash) {
      ops.push({ op: OpCode.RuleSet, id: ids.idOfRule(snap.key), text });
    }
  }

  return ops;
}

function sameIdOrder(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
