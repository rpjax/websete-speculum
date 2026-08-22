"use strict";
/** PP-PROP-1 — live form properties keyed independently of tree iso. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formControlSnapsEqual = formControlSnapsEqual;
function formControlSnapsEqual(a, b) {
    if (a == null || b == null) {
        return { identical: false, reason: 'formProps missing' };
    }
    if (a.length !== b.length) {
        return { identical: false, reason: `count virtual=${a.length} projected=${b.length}` };
    }
    for (let i = 0; i < a.length; i++) {
        const left = a[i];
        const right = b[i];
        if (left.key !== right.key) {
            return { identical: false, reason: `key ${left.key} vs ${right.key}` };
        }
        if (left.value !== right.value || left.checked !== right.checked || left.selected !== right.selected) {
            return {
                identical: false,
                reason: `${left.key} virtual=${JSON.stringify(left)} projected=${JSON.stringify(right)}`,
            };
        }
    }
    return { identical: true, reason: `${a.length} controls` };
}
//# sourceMappingURL=formControlSnap.js.map