/**
 * MutationRecord batch → logical Frame port (frame-protocol.md §5).
 * Impl: {@link TableFrameBuilder} in `virtual/dom/` (DOM drain). This folder is the pipe.
 */

import type { Frame } from '../../core/frame';

export type FrameBuilderContext = {
  generation: number;
  sequence: number;
};

export type FrameBuildStats = {
  /** Instructions emitted per opcode name — cheap volume signal for the perf pass. */
  opCounts: Record<string, number>;
  /** Wall-clock cost of `build()` for the frame these stats belong to. */
  buildMs: number;
  tableSize: number;
  identitySize: number;
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
  /**
   * Work the builder is holding on its own account, with no new `MutationRecord` behind it — a
   * frame withheld while a nested-host mint was pending, or a host queued for re-description
   * (§0 #4). The pipe must not idle-skip a boundary while this is true, or the hold would sit
   * until the next mutation on a page that may have gone quiet.
   */
  hasHeldWork?(): boolean;
};
