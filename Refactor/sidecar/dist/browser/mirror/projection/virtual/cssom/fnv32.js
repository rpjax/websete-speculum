"use strict";
/** FNV-1a 32-bit — cheap mix after the string already exists. Not a substitute for reading `cssText`. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fnv1a32 = fnv1a32;
const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;
function fnv1a32(text) {
    let h = OFFSET;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, PRIME) >>> 0;
    }
    return h >>> 0;
}
//# sourceMappingURL=fnv32.js.map