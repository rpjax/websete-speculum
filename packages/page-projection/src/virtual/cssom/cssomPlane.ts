/**
 * CSSOM plane port — what resync and snapshot may call.
 * Idle scheduling lives on {@link CssomIdleScheduler}; this type is the layer boundary
 * so algorithm use cases do not import the scheduler.
 *
 * Resync always {@link CssomPlane.blockingScan} (full cost). Snapshot chooses
 * `none` | `committed` | `scan`. Live/resync emit §4.6 ops; client phase 2 CSSOM is a no-op (C6).
 */

import type { FrameOp } from '../../core/frame';
import { emptyCssomPollStats, type CssomPollStats } from '../../core/telemetry';

export type CssomScanResult = {
  ops: FrameOp[];
  stats: CssomPollStats;
};

export type CssomPlane = {
  readonly enabled: boolean;
  start(): void;
  halt(): void;
  takePending(): CssomScanResult | null;
  /**
   * Drop in-flight idle work, full readable `cssText` scan, commit last-seen.
   * `stashForEmit`: leave the scan as {@link takePending} so the next flush emits the ops.
   * Resync must pass false (default) — it applies ops itself.
   */
  blockingScan(stashForEmit?: boolean): CssomScanResult;
};

export function disabledCssomPlane(): CssomPlane {
  return {
    enabled: false,
    start() {},
    halt() {},
    takePending() {
      return null;
    },
    blockingScan(_stashForEmit?: boolean) {
      return { ops: [], stats: emptyCssomPollStats() };
    },
  };
}
