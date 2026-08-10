/**
 * Bounded queue with DropOldest when full. Producers never block.
 */
export class DropOldestQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;
  private dropped = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  tryWrite(item: T): void {
    if (this.closed) return;
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
  tryWriteFront(item: T): boolean {
    if (this.closed) return false;
    if (this.items.length >= this.capacity) return false;
    this.items.unshift(item);
    this.wakeOne();
    return true;
  }

  /**
   * Like tryWrite but reports whether DropOldest evicted an item (lifecycle overflow).
   */
  tryWriteReportingDrop(item: T): { accepted: boolean; droppedOldest: boolean } {
    if (this.closed) return { accepted: false, droppedOldest: false };
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
   * Sequenced PageProjection diffs (T5/D13): on overflow discard the whole
   * backlog then enqueue. Client observes a sequence gap → desync — never a
   * silently truncated contiguous stream.
   * @returns drained count + sequence range when items expose `.sequence`.
   */
  tryWriteDropAllOnOverflow(item: T): {
    dropped: number;
    lowestSequence: number | null;
    highestSequence: number | null;
  } {
    if (this.closed) {
      return { dropped: 0, lowestSequence: null, highestSequence: null };
    }
    let dropped = 0;
    let lowestSequence: number | null = null;
    let highestSequence: number | null = null;
    if (this.items.length >= this.capacity) {
      for (const drained of this.items) {
        const seq = sequenceOf(drained);
        if (seq == null) continue;
        if (lowestSequence == null || seq < lowestSequence) lowestSequence = seq;
        if (highestSequence == null || seq > highestSequence) highestSequence = seq;
      }
      dropped = this.items.length;
      this.dropped += dropped;
      this.items.length = 0;
    }
    this.items.push(item);
    this.wakeOne();
    return { dropped, lowestSequence, highestSequence };
  }

  private wakeOne(): void {
    const w = this.waiters.shift();
    if (w) w();
  }

  async read(signal?: AbortSignal): Promise<T | null> {
    for (;;) {
      // Check abort before dequeue so a cancelled Watch* cannot steal the only onCrash.
      if (signal?.aborted) return null;
      if (this.items.length > 0) {
        return this.items.shift()!;
      }
      if (this.closed) return null;

      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal?.removeEventListener('abort', onAbort);
          const idx = this.waiters.indexOf(wake);
          if (idx >= 0) this.waiters.splice(idx, 1);
          resolve();
        };
        const onAbort = (): void => wake();
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        this.waiters.push(wake);
      });
    }
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!();
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Visible depth for contract tests (not for production hot paths). */
  get pendingCount(): number {
    return this.items.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }
}

function sequenceOf(item: unknown): number | null {
  if (!item || typeof item !== 'object') return null;
  const seq = (item as { sequence?: unknown }).sequence;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}
