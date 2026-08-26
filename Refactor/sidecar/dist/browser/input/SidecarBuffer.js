"use strict";
/**
 * Ordered sidecar input buffer (§10.6 / D-UI-17).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidecarBuffer = void 0;
const NEVER_DROP = new Set(['down', 'up']);
class SidecarBuffer {
    queue = [];
    maxSize;
    constructor(maxSize = 512) {
        this.maxSize = maxSize;
    }
    enqueue(intent) {
        if (this.queue.length >= this.maxSize && !NEVER_DROP.has(intent.type)) {
            const dropIdx = this.queue.findIndex((i) => !NEVER_DROP.has(i.type));
            if (dropIdx >= 0)
                this.queue.splice(dropIdx, 1);
            else
                return;
        }
        this.queue.push(intent);
    }
    drainOne() {
        return this.queue.shift();
    }
    get pending() {
        return this.queue.length;
    }
    isEmpty() {
        return this.queue.length === 0;
    }
}
exports.SidecarBuffer = SidecarBuffer;
//# sourceMappingURL=SidecarBuffer.js.map