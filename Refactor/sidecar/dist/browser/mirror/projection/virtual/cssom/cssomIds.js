"use strict";
/**
 * CSSOM id allocator — D-SPEC-8 range `[0x80000001 .. 0xFFFFFFFF]`. WeakMaps on live
 * CSSStyleSheet / CSSRule objects. Ids survive replaceSync of *content* only if the sheet
 * object is the same; new rule objects get new ids (list-diff, not SHEET_DROP).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssomIds = exports.CSSOM_ID_MAX = exports.CSSOM_ID_MIN = void 0;
exports.CSSOM_ID_MIN = 0x80000001;
exports.CSSOM_ID_MAX = 0xffffffff;
class CssomIds {
    next = exports.CSSOM_ID_MIN;
    sheets = new WeakMap();
    rules = new WeakMap();
    idOfSheet(sheet) {
        const existing = this.sheets.get(sheet);
        if (existing !== undefined)
            return existing;
        const id = this.alloc();
        this.sheets.set(sheet, id);
        return id;
    }
    idOfRule(rule) {
        const existing = this.rules.get(rule);
        if (existing !== undefined)
            return existing;
        const id = this.alloc();
        this.rules.set(rule, id);
        return id;
    }
    peekSheet(sheet) {
        return this.sheets.get(sheet);
    }
    peekRule(rule) {
        return this.rules.get(rule);
    }
    /** Drop+new of a still-live object (grouping rule content change) — next `idOfRule` allocates. */
    forgetRule(rule) {
        this.rules.delete(rule);
    }
    alloc() {
        if (this.next > exports.CSSOM_ID_MAX)
            throw new Error('CssomIds: id space exhausted');
        const id = this.next;
        this.next += 1;
        return id;
    }
}
exports.CssomIds = CssomIds;
//# sourceMappingURL=cssomIds.js.map