/**
 * Single-source Sessions.ViewportPolicy baseline for Live/Lab/admin.
 * Live takes the operational policy from GET /api/public/client-config — not StartSession.
 */

export interface SessionViewportBounds {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  defaultWidth?: number
  defaultHeight?: number
}

/**
 * Mirrors Speculum.Api Sessions.ViewportPolicy engine baseline
 * (min 100×100, default 1280×720, max 4096×2160).
 */
export const SESSION_VIEWPORT_BASELINE: Readonly<Required<SessionViewportBounds>> = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
  defaultWidth: 1280,
  defaultHeight: 720,
}

/**
 * Normalize session size the same way the API edge does at start
 * (fill non-positive → default, clamp to policy min..max).
 */
export function normalizeSessionViewport(
  width: number,
  height: number,
  policy: SessionViewportBounds,
): { w: number; h: number } {
  const defaultW = policy.defaultWidth ?? policy.minWidth
  const defaultH = policy.defaultHeight ?? policy.minHeight
  let w = width > 0 ? Math.round(width) : defaultW
  let h = height > 0 ? Math.round(height) : defaultH
  w = Math.min(policy.maxWidth, Math.max(policy.minWidth, w))
  h = Math.min(policy.maxHeight, Math.max(policy.minHeight, h))
  return { w, h }
}

/** Runtime resize candidate — reject outside policy (never snap). */
export function validateResizeViewport(
  width: number,
  height: number,
  policy: SessionViewportBounds,
):
  | { ok: true; w: number; h: number }
  | { ok: false; message: string } {
  const w = Math.round(width)
  const h = Math.round(height)
  if (
    !Number.isFinite(w)
    || !Number.isFinite(h)
    || w < policy.minWidth
    || h < policy.minHeight
  ) {
    return {
      ok: false,
      message: `viewport ${w}×${h} below minimum ${policy.minWidth}×${policy.minHeight}`,
    }
  }
  if (w > policy.maxWidth || h > policy.maxHeight) {
    return {
      ok: false,
      message: `viewport ${w}×${h} above maximum ${policy.maxWidth}×${policy.maxHeight}`,
    }
  }
  return { ok: true, w, h }
}
