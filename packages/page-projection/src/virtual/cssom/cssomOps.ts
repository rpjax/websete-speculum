/**
 * Live delta / resync snapshot → §4.6 FrameOp. C3.1: in-place RULE_SET on CSSStyleRule;
 * never SHEET_DROP a live sheet just to refresh rules. Grouping-rule content change
 * (patch cannot work) → RULE_DROP + RULE_NEW, not RULE_SET. Inserts without text omitted (next pass).
 */

import {
  CSSOM_SCOPE_MAIN,
  CSSOM_SCOPE_PIERCE_HOST,
  INSERT_AT_END,
  type FrameOp,
} from '../../core/frame';
import { OpCode } from '../../core/opcodes';
import { ruleAcceptsInPlaceSet } from '../../core/cssomRuleSet';
import type { CssomIds } from './cssomIds';
import type { RuleSnap } from './cssomReconcile';

export type CommittedSheet = {
  sheet: object;
  /** 0 / omitted = document adopted list. */
  hostNode?: number;
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
  const idsByHost = new Map<number, number[]>();
  for (let i = 0; i < sheets.length; i++) {
    const rec = sheets[i]!;
    const hostNode = rec.hostNode ?? 0;
    const sheetId = ids.idOfSheet(rec.sheet);
    let group = idsByHost.get(hostNode);
    if (group === undefined) {
      group = [];
      idsByHost.set(hostNode, group);
    }
    group.push(sheetId);
    ops.push({
      op: OpCode.SheetNew,
      id: sheetId,
      scope: hostNode === 0 ? CSSOM_SCOPE_MAIN : CSSOM_SCOPE_PIERCE_HOST,
      hostNode,
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
  for (const group of idsByHost.values()) {
    if (group.length > 1) ops.push({ op: OpCode.SheetOrder, ids: group });
  }
  return ops;
}

/**
 * Delta vs last committed snaps. `hashed` is this pass's obtained hashes+text (copy survivors).
 * Live order is current topology. Unhashed live keys (insert after copy) are omitted.
 */
export type PrevCssomSheet = { sheet: object; hostNode: number };

export function emitLiveCssomOps(
  ids: CssomIds,
  prevSheets: readonly PrevCssomSheet[],
  nextSheets: readonly CommittedSheet[],
  prevSnaps: WeakMap<object, RuleSnap[]>,
): FrameOp[] {
  const ops: FrameOp[] = [];
  const prevSet = new Set(prevSheets.map((s) => s.sheet));
  const nextSet = new Set(nextSheets.map((s) => s.sheet));

  const dropped: number[] = [];
  for (const rec of prevSheets) {
    if (nextSet.has(rec.sheet)) continue;
    const id = ids.peekSheet(rec.sheet);
    if (id !== undefined) dropped.push(id);
  }
  if (dropped.length > 0) ops.push({ op: OpCode.SheetDrop, ids: dropped });

  const nextByHost = new Map<number, number[]>();
  for (let i = 0; i < nextSheets.length; i++) {
    const rec = nextSheets[i]!;
    const hostNode = rec.hostNode ?? 0;
    const sheetId = ids.idOfSheet(rec.sheet);
    let group = nextByHost.get(hostNode);
    if (group === undefined) {
      group = [];
      nextByHost.set(hostNode, group);
    }
    group.push(sheetId);
    if (rec.skipOps) continue;
    if (!prevSet.has(rec.sheet)) {
      ops.push({
        op: OpCode.SheetNew,
        id: sheetId,
        scope: hostNode === 0 ? CSSOM_SCOPE_MAIN : CSSOM_SCOPE_PIERCE_HOST,
        hostNode,
        before: INSERT_AT_END,
      });
    }
    ops.push(...emitRuleDelta(ids, sheetId, prevSnaps.get(rec.sheet) ?? [], rec));
  }

  const prevByHost = new Map<number, number[]>();
  for (const rec of prevSheets) {
    const id = ids.peekSheet(rec.sheet);
    if (id === undefined) continue;
    let group = prevByHost.get(rec.hostNode);
    if (group === undefined) {
      group = [];
      prevByHost.set(rec.hostNode, group);
    }
    group.push(id);
  }
  const hosts = new Set<number>([...nextByHost.keys(), ...prevByHost.keys()]);
  for (const host of hosts) {
    const nextIds = nextByHost.get(host) ?? [];
    const prevIds = prevByHost.get(host) ?? [];
    if (nextIds.length > 0 && !sameIdOrder(prevIds, nextIds)) {
      ops.push({ op: OpCode.SheetOrder, ids: nextIds });
    }
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
