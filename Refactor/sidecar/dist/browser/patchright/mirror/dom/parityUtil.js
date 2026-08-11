"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlKeyOf = urlKeyOf;
exports.countNodesApprox = countNodesApprox;
exports.summarizeSheets = summarizeSheets;
const URL_KEY_MAX_LEN = 256;
const NODE_COUNT_CAP = 50_000;
/** host+pathname, query/hash stripped; truncated for wire/journal safety. */
function urlKeyOf(raw) {
    if (!raw)
        return undefined;
    let key;
    try {
        const u = new URL(raw);
        key = `${u.host}${u.pathname}`;
    }
    catch {
        key = raw.split(/[?#]/)[0] ?? raw;
    }
    return key.length > URL_KEY_MAX_LEN ? key.slice(0, URL_KEY_MAX_LEN) : key;
}
/** Bounded DOM node count — approximate on purpose (never walks past the cap). */
function countNodesApprox(root) {
    if (!root)
        return 0;
    let count = 0;
    const stack = [root];
    while (stack.length > 0 && count < NODE_COUNT_CAP) {
        const node = stack.pop();
        count++;
        for (const child of node.children ?? [])
            stack.push(child);
    }
    return count;
}
/** Sheet/rule totals from a Cssom install payload (`sheets[].rules[]`). */
function summarizeSheets(sheets) {
    if (!Array.isArray(sheets))
        return { sheetCount: 0, ruleCount: 0 };
    let ruleCount = 0;
    for (const sheet of sheets) {
        if (Array.isArray(sheet?.rules))
            ruleCount += sheet.rules.length;
    }
    return { sheetCount: sheets.length, ruleCount };
}
//# sourceMappingURL=parityUtil.js.map