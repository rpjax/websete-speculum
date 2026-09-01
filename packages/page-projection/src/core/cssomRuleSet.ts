/**
 * SEAL-CSSOM-P0-RULESET / PP-CSSOM-A-1 — in-place RULE_SET only for CSSStyleRule.
 * Producer: content change on a non-style rule is RULE_DROP + RULE_NEW, never RULE_SET.
 * Client: RULE_SET on a non-style rule is a producer bug → desync (no hidden replace).
 */

export type RuleSetApplyPlan =
  | { mode: 'styleDeclarations' }
  | { mode: 'desync' };

export function planRuleSetApply(isCssStyleRule: boolean): RuleSetApplyPlan {
  if (isCssStyleRule) return { mode: 'styleDeclarations' };
  return { mode: 'desync' };
}

/** Same cut as client `instanceof CSSStyleRule` — built-in `constructor.name` (unit stubs use the class name). */
export function ruleAcceptsInPlaceSet(rule: object): boolean {
  return rule.constructor.name === 'CSSStyleRule';
}
