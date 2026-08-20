"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNestedHostNavAttr = isNestedHostNavAttr;
/** Phase 2 must not apply these as navigation on a nested-context host. */
function isNestedHostNavAttr(name) {
    const n = name.toLowerCase();
    return n === 'src' || n === 'srcdoc';
}
//# sourceMappingURL=nestedNav.js.map