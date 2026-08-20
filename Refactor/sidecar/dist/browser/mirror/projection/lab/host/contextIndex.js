"use strict";
/**
 * Lab-only registry of contextId values seen on the wire (OPEN-6 observability).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextIndex = void 0;
const frame_1 = require("../../models/frame");
class ContextIndex {
    entries = new Map();
    booted = false;
    /** Call once after Virtual producer boot — root context is always active. */
    noteBoot() {
        if (this.booted)
            return;
        this.booted = true;
        this.observeContext(frame_1.CONTEXT_ID_ROOT);
    }
    observeFrameHeader(hdr) {
        if (!hdr || hdr.contextId < 1)
            return;
        this.observeContext(hdr.contextId);
    }
    observeContext(contextId) {
        const now = new Date().toISOString();
        const existing = this.entries.get(contextId);
        if (existing) {
            existing.lastSeen = now;
            existing.frameCount += 1;
            return;
        }
        this.entries.set(contextId, {
            contextId,
            firstSeen: now,
            lastSeen: now,
            frameCount: 1,
        });
    }
    list() {
        return [...this.entries.keys()].sort((a, b) => a - b);
    }
    meta(contextId) {
        return this.entries.get(contextId);
    }
    toJSON() {
        return {
            contexts: this.list().map((id) => this.entries.get(id)),
        };
    }
}
exports.ContextIndex = ContextIndex;
//# sourceMappingURL=contextIndex.js.map