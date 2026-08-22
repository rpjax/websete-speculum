/**
 * SEAL-DOM-P0-FLUSH / PP-APPLY-1 — stop a sorted apply batch on the first failure.
 * Used by `DomFrameApplier.flush` so later frames never run after a desync.
 */

export function applyFramesUntilDesync<T>(
  batch: readonly T[],
  applyOne: (frame: T) => boolean,
): { lastIndex: number; stoppedEarly: boolean } {
  for (let i = 0; i < batch.length; i++) {
    if (!applyOne(batch[i]!)) {
      return { lastIndex: i, stoppedEarly: true };
    }
  }
  return { lastIndex: batch.length - 1, stoppedEarly: false };
}
