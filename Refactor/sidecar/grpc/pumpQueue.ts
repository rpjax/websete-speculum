import type { DropOldestQueue } from '../host/DropOldestQueue';

/** Minimal writable surface used by gRPC server streams (and unit mocks). */
export interface DrainableWritable {
  write(chunk: unknown): boolean;
  cancelled?: boolean;
  once(event: 'drain', listener: () => void): this;
  off?(event: 'drain', listener: () => void): this;
  removeListener?(event: 'drain', listener: () => void): this;
}

export type PumpQueueDropHooks<T> = {
  /** Abort after dequeue; tryWriteFront rejected (full/closed). */
  onRequeueOverflow?: (item: T) => void;
  /** write() returned true, then stream aborted before the next item — item may be lost mid-flight. */
  onInflightLost?: (item: T) => void;
};

/**
 * Event-driven wait for the writable to accept more data.
 * No polling — resolves on `drain` or when the signal aborts.
 */
export function waitForDrain(
  call: DrainableWritable,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || call.cancelled) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      if (typeof call.off === 'function') call.off('drain', onDrain);
      else if (typeof call.removeListener === 'function') call.removeListener('drain', onDrain);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onDrain = (): void => done();
    const onAbort = (): void => done();
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
export async function pumpQueue<T>(
  queue: DropOldestQueue<T>,
  call: DrainableWritable,
  map: (item: T) => unknown,
  signal: AbortSignal,
  hooks?: PumpQueueDropHooks<T>,
): Promise<void> {
  for (;;) {
    const item = await queue.read(signal);
    if (item === null) break;
    // Abort may race after dequeue — restore at head for the next Watch* reopen.
    if (signal.aborted || call.cancelled) {
      if (!queue.tryWriteFront(item)) hooks?.onRequeueOverflow?.(item);
      break;
    }
    if (signal.aborted || call.cancelled) {
      if (!queue.tryWriteFront(item)) hooks?.onRequeueOverflow?.(item);
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
