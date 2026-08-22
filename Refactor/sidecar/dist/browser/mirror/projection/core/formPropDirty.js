"use strict";
/**
 * Client-only: user is editing this control (input.md §7.2).
 * Phase 1 still applies PROP_SET. Phase 2 consults this before touching the live field.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormPropDirty = void 0;
class FormPropDirty {
    dirty = new Set();
    stash = new Map();
    mark(id) {
        this.dirty.add(id);
    }
    clear(id) {
        this.dirty.delete(id);
    }
    isDirty(id) {
        return this.dirty.has(id);
    }
    hold(op) {
        this.stash.set(op.node, op);
    }
    take(id) {
        const op = this.stash.get(id);
        this.stash.delete(id);
        return op;
    }
    reset() {
        this.dirty.clear();
        this.stash.clear();
    }
}
exports.FormPropDirty = FormPropDirty;
//# sourceMappingURL=formPropDirty.js.map