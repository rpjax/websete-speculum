"use strict";
/** Session-global `contextId` allocator. `1` is reserved for the root. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextIdMint = void 0;
class ContextIdMint {
    next = 2;
    mint() {
        const id = this.next;
        if (id > 0xffffffff)
            throw new Error('contextId space exhausted');
        this.next = id + 1;
        return id >>> 0;
    }
}
exports.ContextIdMint = ContextIdMint;
//# sourceMappingURL=contextIdMint.js.map