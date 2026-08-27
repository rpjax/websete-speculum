"use strict";
/**
 * Map wire `intent.key` / `intent.code` to Playwright `keyboard.down/up` names.
 * Never trim `intent.key` — `' '` (Space) becomes empty after trim and was dropped silently.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveKeyboardDispatchKey = resolveKeyboardDispatchKey;
function resolveKeyboardDispatchKey(key, code) {
    if (key === ' ')
        return 'Space';
    if (key != null && key !== '')
        return key;
    const c = (code ?? '').trim();
    if (c)
        return c;
    return null;
}
//# sourceMappingURL=keyboardDispatch.js.map