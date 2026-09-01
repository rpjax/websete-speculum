/**
 * Suppress Projected scroll intents that echo Virtual programmatic scroll.
 * Call {@link ScrollEchoGate.expect} immediately before applying scroll on Projected;
 * capture's consumeScrollEcho calls {@link ScrollEchoGate.consume}.
 */

export type ScrollEchoTarget = 'viewport' | number;

const DEFAULT_TOLERANCE_PX = 2;
const DEFAULT_TTL_MS = 400;

type Pending = {
  top: number;
  left: number;
  expiresAt: number;
};

export class ScrollEchoGate {
  private readonly pending = new Map<string, Pending>();
  private readonly tolerancePx: number;
  private readonly ttlMs: number;

  constructor(opts?: { tolerancePx?: number; ttlMs?: number }) {
    this.tolerancePx = opts?.tolerancePx ?? DEFAULT_TOLERANCE_PX;
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  private key(target: ScrollEchoTarget): string {
    return target === 'viewport' ? 'viewport' : `el:${target}`;
  }

  /** Mark an upcoming programmatic scroll so the next matching sensor is swallowed. */
  expect(target: ScrollEchoTarget, pos: { top: number; left: number }): void {
    this.pending.set(this.key(target), {
      top: pos.top,
      left: pos.left,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * @returns true when the observed scroll matches a pending expect (caller should not send intent).
   */
  consume(target: ScrollEchoTarget, observed: { top: number; left: number }): boolean {
    const k = this.key(target);
    const p = this.pending.get(k);
    if (!p) return false;
    if (Date.now() > p.expiresAt) {
      this.pending.delete(k);
      return false;
    }
    const close =
      Math.abs(p.top - observed.top) <= this.tolerancePx
      && Math.abs(p.left - observed.left) <= this.tolerancePx;
    if (!close) return false;
    this.pending.delete(k);
    return true;
  }

  clear(): void {
    this.pending.clear();
  }
}
