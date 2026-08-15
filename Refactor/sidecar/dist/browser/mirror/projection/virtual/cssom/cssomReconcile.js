"use strict";
/**
 * Identity-based rule list diff (no DOM). `replaceSync` allocates new rule objects → all
 * disappeared + appeared. In-place `style` writes keep the same object → textChangedInPlace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffRules = diffRules;
function diffRules(prev, next) {
    const prevHash = new Map();
    for (const r of prev)
        prevHash.set(r.key, r.contentHash);
    const nextKeys = new Set();
    for (const r of next)
        nextKeys.add(r.key);
    let rulesDisappeared = 0;
    for (const r of prev) {
        if (!nextKeys.has(r.key))
            rulesDisappeared += 1;
    }
    let rulesAppeared = 0;
    let rulesTextChangedInPlace = 0;
    for (const r of next) {
        const old = prevHash.get(r.key);
        if (old === undefined)
            rulesAppeared += 1;
        else if (old !== r.contentHash)
            rulesTextChangedInPlace += 1;
    }
    let ruleListChanged = prev.length !== next.length;
    if (!ruleListChanged) {
        for (let i = 0; i < prev.length; i++) {
            if (prev[i].key !== next[i].key) {
                ruleListChanged = true;
                break;
            }
        }
    }
    return { ruleListChanged, rulesAppeared, rulesDisappeared, rulesTextChangedInPlace };
}
//# sourceMappingURL=cssomReconcile.js.map