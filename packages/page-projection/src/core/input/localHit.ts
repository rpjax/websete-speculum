/**
 * Sparse-cdp click — position inside an element box as [0,1] fractions (top-left origin).
 */

export const LOCAL_HIT_EPS = 1e-6;

export type LocalHitRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function isValidLocalHit(localX: number, localY: number): boolean {
  return (
    Number.isFinite(localX)
    && Number.isFinite(localY)
    && localX >= -LOCAL_HIT_EPS
    && localY >= -LOCAL_HIT_EPS
    && localX <= 1 + LOCAL_HIT_EPS
    && localY <= 1 + LOCAL_HIT_EPS
  );
}

/** Map local fractions onto a root-viewport CSS rect. Degenerate box → null. */
export function mapLocalHitToRootPoint(
  rect: LocalHitRect,
  localX: number,
  localY: number,
): { x: number; y: number } | null {
  if (!isValidLocalHit(localX, localY)) return null;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (w <= 0 || h <= 0) return null;
  const clampedX = Math.min(1, Math.max(0, localX));
  const clampedY = Math.min(1, Math.max(0, localY));
  return {
    x: rect.left + clampedX * w,
    y: rect.top + clampedY * h,
  };
}
