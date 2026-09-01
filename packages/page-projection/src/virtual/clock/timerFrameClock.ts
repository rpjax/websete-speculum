/**
 * Timer-based FrameClock impl (E-01). Never uses requestAnimationFrame.
 */

import type { FrameClock } from './frameClock';

export type { FrameClock };

export const FRAME_RATE_LADDER: readonly number[] = [60, 30, 15, 5];

export type TimerFrameClockOptions = {
  frameRateHz?: number;
  hiddenRateHz?: number;
  rateRecoverMs?: number;
  frameStallMs?: number;
  rateLadder?: readonly number[];
  now?: () => number;
  onStall?: (info: { sinceLastTickMs: number }) => void;
  onRateChanged?: (info: {
    fromHz: number;
    toHz: number;
    reason: 'hidden' | 'degrade' | 'recover' | 'config';
  }) => void;
};

const DEFAULTS = {
  frameRateHz: 60,
  hiddenRateHz: 1,
  rateRecoverMs: 5000,
  frameStallMs: 1000,
} as const;

export class TimerFrameClock implements FrameClock {
  private onBoundary: (() => void) | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private nextDeadlineMs = 0;
  private lastTickAtMs: number;
  private currentRateHz: number;
  private readonly topRateHz: number;
  private lastRecoverAtMs = 0;
  private hidden = false;
  private stallWatchId: ReturnType<typeof setInterval> | null = null;
  private readonly nowFn: () => number;
  private readonly opts: TimerFrameClockOptions;

  constructor(opts: TimerFrameClockOptions = {}) {
    this.opts = opts;
    this.nowFn = opts.now ?? (() => performance.now());
    this.topRateHz = opts.frameRateHz ?? DEFAULTS.frameRateHz;
    this.currentRateHz = this.topRateHz;
    this.lastTickAtMs = this.nowFn();
  }

  get rateHz(): number {
    return this.currentRateHz;
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  now(): number {
    return this.nowFn();
  }

  start(onBoundary: () => void): void {
    this.onBoundary = onBoundary;
    this.running = true;
    this.nextDeadlineMs = this.nowFn() + this.periodMs();
    this.arm();
    this.armStallWatch();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.clearStallWatch();
  }

  setRateHz(hz: number): void {
    this.setRateHzWithReason(hz, 'config');
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.setRateHzWithReason(this.opts.hiddenRateHz ?? DEFAULTS.hiddenRateHz, 'hidden');
    else this.setRateHzWithReason(this.topRateHz, 'hidden');
  }

  degrade(): void {
    if (this.hidden) return;
    const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
    const idx = ladder.indexOf(this.currentRateHz);
    const nextIdx = idx === -1 ? 0 : Math.min(idx + 1, ladder.length - 1);
    this.setRateHzWithReason(ladder[nextIdx]!, 'degrade');
  }

  recoverStep(): boolean {
    if (this.hidden) return false;
    const now = this.nowFn();
    const recoverMs = this.opts.rateRecoverMs ?? DEFAULTS.rateRecoverMs;
    if (now - this.lastRecoverAtMs < recoverMs) return false;
    const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
    const idx = ladder.indexOf(this.currentRateHz);
    if (idx <= 0) return false;
    this.setRateHzWithReason(ladder[idx - 1]!, 'recover');
    this.lastRecoverAtMs = now;
    return true;
  }

  checkStall(): boolean {
    const now = this.nowFn();
    const stallMs = this.opts.frameStallMs ?? DEFAULTS.frameStallMs;
    const sinceLastTickMs = now - this.lastTickAtMs;
    if (sinceLastTickMs < stallMs) return false;
    this.opts.onStall?.({ sinceLastTickMs });
    this.forceBoundary();
    return true;
  }

  forceBoundary(): void {
    this.lastTickAtMs = this.nowFn();
    this.onBoundary?.();
  }

  private setRateHzWithReason(
    hz: number,
    reason: 'hidden' | 'degrade' | 'recover' | 'config',
  ): void {
    if (hz <= 0 || hz === this.currentRateHz) return;
    const fromHz = this.currentRateHz;
    this.currentRateHz = hz;
    this.opts.onRateChanged?.({ fromHz, toHz: hz, reason });
    if (!this.running) return;
    this.clearTimer();
    this.nextDeadlineMs = this.nowFn() + this.periodMs();
    this.arm();
  }

  private armStallWatch(): void {
    this.clearStallWatch();
    this.stallWatchId = setInterval(() => this.checkStall(), 500);
  }

  private clearStallWatch(): void {
    if (this.stallWatchId !== null) {
      clearInterval(this.stallWatchId);
      this.stallWatchId = null;
    }
  }

  private periodMs(): number {
    return 1000 / this.currentRateHz;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private arm(): void {
    if (!this.running) return;
    const delay = Math.max(0, this.nextDeadlineMs - this.nowFn());
    this.timerId = setTimeout(() => this.onTimer(), delay);
  }

  private onTimer(): void {
    this.timerId = null;
    if (!this.running) return;

    const now = this.nowFn();
    this.lastTickAtMs = now;
    const period = this.periodMs();
    this.nextDeadlineMs += period;
    if (this.nextDeadlineMs < now) {
      this.nextDeadlineMs = now + period;
    }

    this.onBoundary?.();
    this.arm();
  }
}
