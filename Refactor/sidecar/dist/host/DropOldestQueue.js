"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DropOldestQueue = void 0;
/**
 * Bounded queue with DropOldest when full. Producers never block.
 */
class DropOldestQueue {
    capacity;
    items = [];
    waiters = [];
    closed = false;
    dropped = 0;
    constructor(capacity) {
        this.capacity = capacity;
        if (capacity < 1)
            throw new Error('capacity must be >= 1');
    }
    tryWrite(item) {
        if (this.closed)
            return;
        if (this.items.length >= this.capacity) {
            this.items.shift();
            this.dropped++;
        }
        this.items.push(item);
        const w = this.waiters.shift();
        if (w)
            w();
    }
    async read(signal) {
        for (;;) {
            // Check abort before dequeue so a cancelled Watch* cannot steal the only onCrash.
            if (signal?.aborted)
                return null;
            if (this.items.length > 0) {
                return this.items.shift();
            }
            if (this.closed)
                return null;
            await new Promise((resolve) => {
                const wake = () => {
                    signal?.removeEventListener('abort', onAbort);
                    const idx = this.waiters.indexOf(wake);
                    if (idx >= 0)
                        this.waiters.splice(idx, 1);
                    resolve();
                };
                const onAbort = () => wake();
                if (signal)
                    signal.addEventListener('abort', onAbort, { once: true });
                this.waiters.push(wake);
            });
        }
    }
    close() {
        this.closed = true;
        while (this.waiters.length > 0) {
            this.waiters.shift()();
        }
    }
    get isClosed() {
        return this.closed;
    }
    /** Visible depth for contract tests (not for production hot paths). */
    get pendingCount() {
        return this.items.length;
    }
    get droppedCount() {
        return this.dropped;
    }
}
exports.DropOldestQueue = DropOldestQueue;
//# sourceMappingURL=DropOldestQueue.js.map