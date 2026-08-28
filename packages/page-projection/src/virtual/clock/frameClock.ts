/**
 * Frame boundary clock port (E-01).
 * Impls in this folder: {@link TimerFrameClock}, …
 */

export type FrameClock = {
  start(onBoundary: () => void): void;
  stop(): void;
  setRateHz(hz: number): void;
  now(): number;
  readonly rateHz: number;
};
