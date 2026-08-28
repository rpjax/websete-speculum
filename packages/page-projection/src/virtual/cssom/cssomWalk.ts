/**
 * I3 walk primitives — topological copy, slot stale, mass-abort. DOM-free enough for Node units
 * (duck-typed rule/sheet). No skip-serialize. No generations.
 */

export const MASS_ABORT_STALE_FRACTION = 0.9;
export const MASS_ABORT_LENGTH_LO = 0.1;
export const MASS_ABORT_LENGTH_HI = 2;

export function copyRuleRefs(list: { length: number; item(i: number): object | null }): object[] {
  const refs: object[] = [];
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const rule = list.item(i);
    if (rule !== null) refs.push(rule);
  }
  return refs;
}

export function liveRuleList(list: { length: number; item(i: number): object | null }): object[] {
  return copyRuleRefs(list);
}

/** Slot is garbage since last yield — skip, do not hash, do not RULE_SET. */
export function isRuleSlotLive(rule: object, sheet: object, liveRefs: readonly object[]): boolean {
  const parent = (rule as { parentStyleSheet?: object | null }).parentStyleSheet;
  if (parent != null && parent !== sheet) return false;
  for (let i = 0; i < liveRefs.length; i++) {
    if (liveRefs[i] === rule) return true;
  }
  return false;
}

/**
 * replaceSync / almost-all-dead copy → abort the sheet (do not commit a false-empty list).
 * `copyLen` is phase-A length; `staleCount` skipped slots; `liveLen` current cssRules.length.
 */
export function shouldAbortSheet(copyLen: number, staleCount: number, liveLen: number): boolean {
  if (copyLen <= 0) return liveLen > 0 && liveLen > MASS_ABORT_LENGTH_HI;
  if (staleCount / copyLen >= MASS_ABORT_STALE_FRACTION) return true;
  if (liveLen < copyLen * MASS_ABORT_LENGTH_LO) return true;
  if (liveLen > copyLen * MASS_ABORT_LENGTH_HI) return true;
  return false;
}
