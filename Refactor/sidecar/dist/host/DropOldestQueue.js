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
    get maxCapacity() {
        return this.capacity;
    }
    tryWrite(item) {
        if (this.closed)
            return;
        if (this.items.length >= this.capacity) {
            this.items.shift();
            this.dropped++;
        }
        this.items.push(item);
        this.wakeOne();
    }
    /**
     * Requeue at the head (FIFO restore after dequeue). Used when a Watch*
     * aborts mid-write — never append to the tail (would reorder Diff sequences).
     * Rejects when closed or full (no silent DropOldest of another item).
     * @returns false when the item could not be restored → emit sidecar_requeue_overflow.
     */
    tryWriteFront(item) {
        if (this.closed)
            return false;
        if (this.items.length >= this.capacity)
            return false;
        this.items.unshift(item);
        this.wakeOne();
        return true;
    }
    /**
     * Like tryWrite but reports whether DropOldest evicted an item (lifecycle overflow).
     */
    tryWriteReportingDrop(item) {
        if (this.closed)
            return { accepted: false, droppedOldest: false };
        let droppedOldest = false;
        if (this.items.length >= this.capacity) {
            this.items.shift();
            this.dropped++;
            droppedOldest = true;
        }
        this.items.push(item);
        this.wakeOne();
        return { accepted: true, droppedOldest };
    }
    /**
     * Sequenced PageProjection frames (T5/D13): on overflow discard the whole
     * backlog then enqueue. Client observes a sequence gap → desync — never a
     * silently truncated contiguous stream.
     * @returns drained count + sequence range when items expose `.sequence`.
     */
    tryWriteDropAllOnOverflow(item) {
        if (this.closed) {
            return { dropped: 0, lowestSequence: null, highestSequence: null };
        }
        let dropped = 0;
        let lowestSequence = null;
        let highestSequence = null;
        if (this.items.length >= this.capacity) {
            for (const drained of this.items) {
                const seq = sequenceOf(drained);
                if (seq == null)
                    continue;
                if (lowestSequence == null || seq < lowestSequence)
                    lowestSequence = seq;
                if (highestSequence == null || seq > highestSequence)
                    highestSequence = seq;
            }
            dropped = this.items.length;
            this.dropped += dropped;
            this.items.length = 0;
        }
        this.items.push(item);
        this.wakeOne();
        return { dropped, lowestSequence, highestSequence };
    }
    wakeOne() {
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
function sequenceOf(item) {
    if (!item || typeof item !== 'object')
        return null;
    const seq = item.sequence;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}
//# sourceMappingURL=DropOldestQueue.js.map