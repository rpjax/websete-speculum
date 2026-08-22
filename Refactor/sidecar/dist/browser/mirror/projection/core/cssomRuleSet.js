"use strict";
/**
 * SEAL-CSSOM-P0-RULESET / PP-CSSOM-A-1 — in-place RULE_SET only for CSSStyleRule.
 * Producer: content change on a non-style rule is RULE_DROP + RULE_NEW, never RULE_SET.
 * Client: RULE_SET on a non-style rule is a producer bug → desync (no hidden replace).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.planRuleSetApply = planRuleSetApply;
exports.ruleAcceptsInPlaceSet = ruleAcceptsInPlaceSet;
function planRuleSetApply(isCssStyleRule) {
    if (isCssStyleRule)
        return { mode: 'styleDeclarations' };
    return { mode: 'desync' };
}
/** Same cut as client `instanceof CSSStyleRule` — built-in `constructor.name` (unit stubs use the class name). */
function ruleAcceptsInPlaceSet(rule) {
    return rule.constructor.name === 'CSSStyleRule';
}
//# sourceMappingURL=cssomRuleSet.js.map