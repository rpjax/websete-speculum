/**
 * Maps logical CSS viewport coordinates into absolute device axes.
 *
 * Chrome is fullscreen on the capacity display while CDP metrics keep the
 * logical viewport — stretch-map CSS → display ABS so OS hits match the
 * scaled content (same model as a fullscreen window filling the X screen).
 * Transform is refreshed on launch / soft resize only — hot path is multiply + clamp.
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

export function mapLogicalToAbs(
  t: CoordTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  const nx = Math.round((x / t.logicalWidth) * t.absMaxX);
  const ny = Math.round((y / t.logicalHeight) * t.absMaxY);
  return {
    x: clamp(nx, 0, t.absMaxX),
    y: clamp(ny, 0, t.absMaxY),
  };
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
