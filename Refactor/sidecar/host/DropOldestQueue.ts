/**
 * Bounded queue with DropOldest when full. Producers never block.
 */
export class DropOldestQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
  }

  tryWrite(item: T): void {
    if (this.closed) return;
    if (this.items.length >= this.capacity) {
      this.items.shift();
    }
    this.items.push(item);
    const w = this.waiters.shift();
    if (w) w();
  }

  async read(signal?: AbortSignal): Promise<T | null> {
    for (;;) {
      if (this.items.length > 0) {
        return this.items.shift()!;
      }
      if (this.closed) return null;
      if (signal?.aborted) return null;

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
}
