/**
 * §5.3.4 / §5.3.5 — the frame boundary clock. `requestAnimationFrame` MUST
 * NOT be used (it is compositor-tied and throttled when hidden); the
 * scheduler is injected so this is a plain `setInterval`/`MessageChannel`
 * style timer in production and a fake, manually-ticked one in unit tests.
 */

export type TimerHandle = number | ReturnType<typeof setTimeout>;

export type FrameClockScheduler = {
  setInterval(callback: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  now(): number;
};

/** §5.3.5.1 — 60 → 30 → 15 → 5 Hz degradation ladder. */
export const RATE_LADDER: readonly number[] = [60, 30, 15, 5];

export type FrameClockOptions = {
  scheduler: FrameClockScheduler;
  onTick: () => void;
  /** §5.3.4.4 — watchdog fired when `checkStall()` finds the clock stalled. */
  onStall?: (info: { sinceLastTickMs: number }) => void;
  frameRateHz?: number;
  hiddenRateHz?: number;
  rateRecoverMs?: number;
  frameStallMs?: number;
  /** §5.3.5.1 degradation ladder, highest first. */
  rateLadder?: readonly number[];
};

const DEFAULTS = {
  frameRateHz: 60,
  hiddenRateHz: 1,
  rateRecoverMs: 5000,
  frameStallMs: 1000,
} as const;

export class FrameClock {
  private handle: TimerHandle | null = null;
  private currentRateHz: number;
  private readonly topRateHz: number;
  private lastTickAtMs: number;
  private lastRecoverAtMs = 0;
  private hidden = false;

  constructor(private readonly opts: FrameClockOptions) {
    this.topRateHz = opts.frameRateHz ?? DEFAULTS.frameRateHz;
    this.currentRateHz = this.topRateHz;
    this.lastTickAtMs = opts.scheduler.now();
  }

  get rateHz(): number {
    return this.currentRateHz;
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  start(): void {
    this.stop();
    this.startInterval(this.currentRateHz);
  }

  stop(): void {
    if (this.handle !== null) {
      this.opts.scheduler.clearInterval(this.handle);
      this.handle = null;
    }
  }

  /** §5.3.5.3 — a client-hidden report collapses the rate; mutations keep accumulating. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.applyRate(this.opts.hiddenRateHz ?? DEFAULTS.hiddenRateHz);
    else this.applyRate(this.topRateHz);
  }

  /** §5.3.5.1 — one step down the ladder. Never desyncs; a congested pipe just gets fewer, larger frames. */
  degrade(): void {
    if (this.hidden) return;
    const ladder = this.opts.rateLadder ?? RATE_LADDER;
    const idx = ladder.indexOf(this.currentRateHz);
    const nextIdx = idx === -1 ? 0 : Math.min(idx + 1, ladder.length - 1);
    this.applyRate(ladder[nextIdx]!);
  }

  /** §5.3.5.2 — one step up, throttled to at most once per `rateRecoverMs`. Returns whether it stepped. */
  recoverStep(): boolean {
    if (this.hidden) return false;
    const now = this.opts.scheduler.now();
    const recoverMs = this.opts.rateRecoverMs ?? DEFAULTS.rateRecoverMs;
    if (now - this.lastRecoverAtMs < recoverMs) return false;
    const ladder = this.opts.rateLadder ?? RATE_LADDER;
    const idx = ladder.indexOf(this.currentRateHz);
    if (idx <= 0) return false;
    this.applyRate(ladder[idx - 1]!);
    this.lastRecoverAtMs = now;
    return true;
  }

  /**
   * §5.3.4.4 watchdog — the caller (Node side, which sees page activity even
   * when the in-page clock is starved) polls this. Forces a flush tick and
   * reports the stall when no tick has landed for `frameStallMs`.
   */
  checkStall(): boolean {
    const now = this.opts.scheduler.now();
    const stallMs = this.opts.frameStallMs ?? DEFAULTS.frameStallMs;
    const sinceLastTickMs = now - this.lastTickAtMs;
    if (sinceLastTickMs < stallMs) return false;
    this.opts.onStall?.({ sinceLastTickMs });
    this.forceTick();
    return true;
  }

  forceTick(): void {
    this.lastTickAtMs = this.opts.scheduler.now();
    this.opts.onTick();
  }

  private startInterval(hz: number): void {
    const intervalMs = 1000 / hz;
    this.handle = this.opts.scheduler.setInterval(() => this.tick(), intervalMs);
  }

  private tick(): void {
    this.lastTickAtMs = this.opts.scheduler.now();
    this.opts.onTick();
  }

  private applyRate(hz: number): void {
    if (hz === this.currentRateHz) return;
    this.currentRateHz = hz;
    if (this.handle !== null) {
      this.opts.scheduler.clearInterval(this.handle);
      this.startInterval(hz);
    }
  }
}
