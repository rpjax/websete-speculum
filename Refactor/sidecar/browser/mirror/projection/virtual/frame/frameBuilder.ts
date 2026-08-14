/**
 * MutationRecord batch → logical Frame port (frame-protocol.md §5).
 * Impls in this folder: {@link TableFrameBuilder}, …
 */

import type { Frame } from '../../models/frame';

export type FrameBuilderContext = {
  generation: number;
  sequence: number;
};

export type FrameBuildStats = {
  /** Instructions emitted per opcode name — cheap volume signal for the perf pass. */
  opCounts: Record<string, number>;
  /** Wall-clock cost of `build()` for the frame these stats belong to. */
  buildMs: number;
};

export type FrameBuilder = {
  /** `null` when the drained batch produced no publishable instructions (no frame, no sequence consumed). */
  build(records: MutationRecord[], ctx: FrameBuilderContext): Frame | null;
  takeBuildStats?(): FrameBuildStats | null;
  /**
   * Records this `build()` call left unprocessed (§8 `MAX_DIRTY_NODES` — the per-tick
   * visited/dirty set hit its cap mid-drain) — `null`/absent when nothing was left over. The
   * caller (`frameEmitter.ts`) is responsible for pushing these back onto the `MutationBuffer`
   * (`reclaim`) so the next tick retries them instead of losing them.
   */
  takeUnconsumedRecords?(): MutationRecord[] | null;
};
