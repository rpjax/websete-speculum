/**
 * LivePageProjection public event / navigation types — kept separate so
 * `liveAttach.ts` orchestration stays within §9 LOC budgets.
 */

export type LivePageProjectionEvents = {
  onPageProjectionDiff(diff: {
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    partIndex?: number;
    partCount?: number;
    flags?: number;
    version?: number;
  }): void;
  onGenerationBumped?(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    diffKind?: string;
  }): void;
  onSoftNavObserved?(event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }): void;
  onScrollEchoHit?(event: {
    kind: 'viewport' | 'element';
    generation?: number;
    anchor?: string;
    scrollX?: number;
    scrollY?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }): void;
  onParity?(kind: string, payload: Record<string, unknown>): void;
};

export type LivePageProjectionNavigationType = 'goto' | 'reload' | 'back_forward' | 'soft' | 'unknown';

/** Options for `LivePageProjection.start` — kept here so liveAttach stays ≤600 LOC. */
export type LivePageProjectionStartOptions = {
  browserLaunchedAtMs?: number;
  frameRateHz?: number;
  maxFrameBytes?: number;
  establishChunkBytes?: number;
  hiddenRateHz?: number;
  rateRecoverMs?: number;
  frameStallMs?: number;
  rateLadder?: readonly number[];
  mirrorMaxBytes?: number;
  assetCacheL1MaxBytes?: number;
  assetPriorityViewportPx?: number;
  aggregateIntervalMs?: number;
};
