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
        }
        this.items.push(item);
        const w = this.waiters.shift();
        if (w)
            w();
    }
    async read(signal) {
        for (;;) {
            if (this.items.length > 0) {
                return this.items.shift();
            }
            if (this.closed)
                return null;
            if (signal?.aborted)
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
}
exports.DropOldestQueue = DropOldestQueue;
//# sourceMappingURL=DropOldestQueue.js.map