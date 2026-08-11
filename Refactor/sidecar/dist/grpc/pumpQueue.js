"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForDrain = waitForDrain;
exports.pumpQueue = pumpQueue;
/**
 * Event-driven wait for the writable to accept more data.
 * No polling — resolves on `drain` or when the signal aborts.
 */
function waitForDrain(call, signal) {
    if (signal.aborted || call.cancelled)
        return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            if (typeof call.off === 'function')
                call.off('drain', onDrain);
            else if (typeof call.removeListener === 'function')
                call.removeListener('drain', onDrain);
            signal.removeEventListener('abort', onAbort);
            resolve();
        };
        const onDrain = () => done();
        const onAbort = () => done();
        call.once('drain', onDrain);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
/**
 * Lossless pump: every dequeued item is written once. `write()===false` means the
 * chunk was still accepted — only wait for `drain` before the *next* item.
 * Never rewrite the same chunk (that duplicated sequences on the wire).
 * Backpressure rises into the EventBridge queue (DropAll for PageProjection Diff).
 */
async function pumpQueue(queue, call, map, signal, hooks) {
    for (;;) {
        const item = await queue.read(signal);
        if (item === null)
            break;
        hooks?.onAfterDequeue?.(item);
        // Abort may race after dequeue — restore at head for the next Watch* reopen.
        if (signal.aborted || call.cancelled) {
            if (!queue.tryWriteFront(item))
                hooks?.onRequeueOverflow?.(item);
            break;
        }
        if (signal.aborted || call.cancelled) {
            if (!queue.tryWriteFront(item))
                hooks?.onRequeueOverflow?.(item);
            return;
        }
        const ok = call.write(map(item));
        // Chunk is on the wire (or in the writable buffer) regardless of `ok`.
        if (!ok) {
            await waitForDrain(call, signal);
            if (signal.aborted || call.cancelled) {
                hooks?.onInflightLost?.(item);
                return;
            }
        }
    }
}
//# sourceMappingURL=pumpQueue.js.map