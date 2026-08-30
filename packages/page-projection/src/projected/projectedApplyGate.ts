import type { AssembledFrame } from '../core/decode';

/**
 * Max assembled frames held while an async surface rebuild runs.
 * Sized for Eneba-class cold resync: apply ~59ms (lab 2026-08-30 gen=7) — cap holds seq-2+
 * increments that arrive before `lastSequence` catches up, without unbounded memory.
 */
export const PROJECTED_APPLY_GATE_MAX_PENDING = 64;

/** Consecutive overflow→cold-resync cycles before surfacing a hard loop failure. */
export const PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK = 3;

export type ProjectedApplyGateCallbacks = {
  maxPending?: number;
  /** Fila estourou — pending descartado; caller must request cold resync. */
  onOverflow?: (info: { cap: number; attemptedDepth: number }) => void;
  /** Outermost async flight ended (install/resync rebuild). */
  onFlightEnd?: (info: {
    maxDepth: number;
    waitMs: number;
    drained: number;
    overflow: boolean;
  }) => void;
};

/**
 * While an async surface rebuild (generation change / cold resync) is in flight,
 * `lastSequence` is stale until the seed frame applies. Hold later assembled frames
 * instead of rejecting them as sequence_gap (Eneba-class cold resync overrun).
 *
 * `flightDepth` nests overlapping rebuilds (superseded epoch); only the outermost
 * `finishFlight` drains. `draining` prevents parallel drain loops — arrivals during
 * drain append only.
 */
export class ProjectedApplyGate {
  private flightDepth = 0;
  private draining = false;
  private readonly pending: AssembledFrame[] = [];
  private readonly maxPending: number;
  private readonly onOverflow?: ProjectedApplyGateCallbacks['onOverflow'];
  private readonly onFlightEnd?: ProjectedApplyGateCallbacks['onFlightEnd'];
  private flightStartMs = 0;
  private maxDepth = 0;
  private drained = 0;
  private overflow = false;

  constructor(callbacks: ProjectedApplyGateCallbacks = {}) {
    this.maxPending = callbacks.maxPending ?? PROJECTED_APPLY_GATE_MAX_PENDING;
    this.onOverflow = callbacks.onOverflow;
    this.onFlightEnd = callbacks.onFlightEnd;
  }

  get blocked(): boolean {
    return this.flightDepth > 0 || this.draining;
  }

  begin(): void {
    if (this.flightDepth === 0) {
      this.flightStartMs = performance.now();
      this.maxDepth = this.pending.length;
      this.drained = 0;
      this.overflow = false;
    }
    this.flightDepth++;
  }

  push(frame: AssembledFrame): void {
    if (this.pending.length >= this.maxPending) {
      this.overflow = true;
      const attemptedDepth = this.pending.length + 1;
      this.pending.length = 0;
      this.onOverflow?.({ cap: this.maxPending, attemptedDepth });
      return;
    }
    this.pending.push(frame);
    if (this.pending.length > this.maxDepth) {
      this.maxDepth = this.pending.length;
    }
  }

  /** Drop queued frames superseded by a generation bump — never apply stale headers. */
  discardPending(): void {
    this.pending.length = 0;
  }

  /** Full reset — client reset / dispose only. */
  clear(): void {
    this.flightDepth = 0;
    this.draining = false;
    this.pending.length = 0;
    this.flightStartMs = 0;
    this.maxDepth = 0;
    this.drained = 0;
    this.overflow = false;
  }

  finishFlight(drain: (frame: AssembledFrame) => void): void {
    if (this.flightDepth === 0) return;
    this.flightDepth--;
    if (this.flightDepth > 0) return;
    this.drainLoop(drain);
    if (this.flightStartMs > 0) {
      this.onFlightEnd?.({
        maxDepth: this.maxDepth,
        waitMs: performance.now() - this.flightStartMs,
        drained: this.drained,
        overflow: this.overflow,
      });
    }
    this.flightStartMs = 0;
  }

  private drainLoop(drain: (frame: AssembledFrame) => void): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0 && this.flightDepth === 0) {
        const next = this.pending.shift()!;
        this.drained += 1;
        drain(next);
      }
    } finally {
      this.draining = false;
    }
    if (this.flightDepth === 0 && this.pending.length > 0) {
      this.drainLoop(drain);
    }
  }
}
