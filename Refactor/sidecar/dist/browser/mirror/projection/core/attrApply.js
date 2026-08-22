"use strict";
/**
 * SEAL-DOM-P0-ATTR / PP-APPLY-2 — failed setAttribute must not be swallowed.
 * Injectable setter keeps this DOM-free for sidecar unit.ts (client/ is tsc-excluded).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAttrPairs = applyAttrPairs;
function applyAttrPairs(setAttribute, attrs) {
    for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        try {
            setAttribute(name, value);
        }
        catch {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=attrApply.js.map