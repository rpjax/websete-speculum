/**
 * Maps logical CSS viewport coordinates into absolute device axes.
 *
 * Chrome window is sized to the logical viewport at (0,0) on the capacity
 * display — map 1:1 into that window region (no fullscreen stretch).
 * Transform is refreshed on launch / soft resize only — hot path is clamp.
 */
export type CoordTransform = {
  logicalWidth: number;
  logicalHeight: number;
  absMaxX: number;
  absMaxY: number;
};

export function createCoordTransform(
  logicalWidth: number,
  logicalHeight: number,
  absMaxX: number,
  absMaxY: number,
): CoordTransform {
  if (logicalWidth <= 0 || logicalHeight <= 0 || absMaxX < 0 || absMaxY < 0) {
    throw new Error('invalid coordinate transform dimensions');
  }
  return { logicalWidth, logicalHeight, absMaxX, absMaxY };
}

/**
 * Transform for a Chrome window at (0,0) sized to the logical CSS viewport.
 * Absolute extent is logical-1 (inclusive ABS range), not Xvfb capacity.
 */
export function createLogicalWindowTransform(
  logicalWidth: number,
  logicalHeight: number,
): CoordTransform {
  const w = Math.round(logicalWidth);
  const h = Math.round(logicalHeight);
  if (w <= 0 || h <= 0) {
    throw new Error('logical window transform requires positive width and height');
  }
  return createCoordTransform(w, h, Math.max(0, w - 1), Math.max(0, h - 1));
}

export function mapLogicalToAbs(
  t: CoordTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  const xr = Number.isFinite(x) ? Math.round(x) : 0;
  const yr = Number.isFinite(y) ? Math.round(y) : 0;
  return {
    x: clamp(xr, 0, t.absMaxX),
    y: clamp(yr, 0, t.absMaxY),
  };
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
