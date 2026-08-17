"use strict";
/**
 * CSSOM identity maps — WeakMaps on live CSSStyleSheet / CSSRule objects.
 * Numbers come from the session allocator (frame-protocol.md §1.1 / §1.2): one monotonic
 * space with DOM, starting at 2. Ids survive replaceSync of *content* only if the sheet
 * object is the same; new rule objects get new ids (list-diff, not SHEET_DROP).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssomIds = void 0;
const ID_SPACE_MAX = 0xffffffff;
function standaloneMintState() {
    return { next: 2 };
}
class CssomIds {
    mint;
    sheets = new WeakMap();
    rules = new WeakMap();
    constructor(mint) {
        if (mint !== undefined) {
            this.mint = mint;
            return;
        }
        const state = standaloneMintState();
        this.mint = () => {
            if (state.next > ID_SPACE_MAX)
                throw new Error('CssomIds: id space exhausted');
            const id = state.next;
            state.next += 1;
            return id;
        };
    }
    idOfSheet(sheet) {
        const existing = this.sheets.get(sheet);
        if (existing !== undefined)
            return existing;
        const id = this.mint();
        this.sheets.set(sheet, id);
        return id;
    }
    idOfRule(rule) {
        const existing = this.rules.get(rule);
        if (existing !== undefined)
            return existing;
        const id = this.mint();
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
}
exports.CssomIds = CssomIds;
//# sourceMappingURL=cssomIds.js.map