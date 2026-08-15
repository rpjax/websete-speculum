"use strict";
/**
 * I3 walk primitives — topological copy, slot stale, mass-abort. DOM-free enough for Node units
 * (duck-typed rule/sheet). No skip-serialize. No generations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASS_ABORT_LENGTH_HI = exports.MASS_ABORT_LENGTH_LO = exports.MASS_ABORT_STALE_FRACTION = void 0;
exports.copyRuleRefs = copyRuleRefs;
exports.liveRuleList = liveRuleList;
exports.isRuleSlotLive = isRuleSlotLive;
exports.shouldAbortSheet = shouldAbortSheet;
exports.MASS_ABORT_STALE_FRACTION = 0.9;
exports.MASS_ABORT_LENGTH_LO = 0.1;
exports.MASS_ABORT_LENGTH_HI = 2;
function copyRuleRefs(list) {
    const refs = [];
    const n = list.length;
    for (let i = 0; i < n; i++) {
        const rule = list.item(i);
        if (rule !== null)
            refs.push(rule);
    }
    return refs;
}
function liveRuleList(list) {
    return copyRuleRefs(list);
}
/** Slot is garbage since last yield — skip, do not hash, do not RULE_SET. */
function isRuleSlotLive(rule, sheet, liveRefs) {
    const parent = rule.parentStyleSheet;
    if (parent != null && parent !== sheet)
        return false;
    for (let i = 0; i < liveRefs.length; i++) {
        if (liveRefs[i] === rule)
            return true;
    }
    return false;
}
/**
 * replaceSync / almost-all-dead copy → abort the sheet (do not commit a false-empty list).
 * `copyLen` is phase-A length; `staleCount` skipped slots; `liveLen` current cssRules.length.
 */
function shouldAbortSheet(copyLen, staleCount, liveLen) {
    if (copyLen <= 0)
        return liveLen > 0 && liveLen > exports.MASS_ABORT_LENGTH_HI;
    if (staleCount / copyLen >= exports.MASS_ABORT_STALE_FRACTION)
        return true;
    if (liveLen < copyLen * exports.MASS_ABORT_LENGTH_LO)
        return true;
    if (liveLen > copyLen * exports.MASS_ABORT_LENGTH_HI)
        return true;
    return false;
}
//# sourceMappingURL=cssomWalk.js.map