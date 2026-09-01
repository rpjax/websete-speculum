/**
 * Shared viewport policy clamp — same rules as Sessions.ViewportPolicy / web Live.
 * Used by lab + prod projected clients (and mirrored on the sidecar resize path).
 */

export type ViewportPolicyBounds = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  defaultWidth?: number;
  defaultHeight?: number;
};

/** Engine baseline (min 100×100, default 1280×720, max 4096×2160). */
export const VIEWPORT_POLICY_BASELINE: Readonly<Required<ViewportPolicyBounds>> = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
  defaultWidth: 1280,
  defaultHeight: 720,
};

/** Lab uses the same capacity ceiling as Live — measure-host can be large. */
export const LAB_VIEWPORT_POLICY: Readonly<ViewportPolicyBounds> = {
  ...VIEWPORT_POLICY_BASELINE,
};

/** Ignore sub-pixel / scrollbar jitter — avoid needless remote resize chatter. */
export const VIEWPORT_SIZE_EPSILON = 2;

export type ViewportSize = { width: number; height: number };

export function viewportSizesClose(
  aW: number,
  aH: number,
  bW: number,
  bH: number,
  epsilon = VIEWPORT_SIZE_EPSILON,
): boolean {
  return Math.abs(aW - bW) <= epsilon && Math.abs(aH - bH) <= epsilon;
}

/**
 * Normalize session size the same way the API edge does at start
 * (fill non-positive → default, clamp to policy min..max).
 */
export function normalizeSessionViewport(
  width: number,
  height: number,
  policy: ViewportPolicyBounds,
): ViewportSize {
  const defaultW = policy.defaultWidth ?? policy.minWidth;
  const defaultH = policy.defaultHeight ?? policy.minHeight;
  let w = width > 0 ? Math.round(width) : defaultW;
  let h = height > 0 ? Math.round(height) : defaultH;
  w = Math.min(policy.maxWidth, Math.max(policy.minWidth, w));
  h = Math.min(policy.maxHeight, Math.max(policy.minHeight, h));
  return { width: w, height: h };
}

/** Runtime resize candidate — reject outside policy (never snap). */
export function validateResizeViewport(
  width: number,
  height: number,
  policy: ViewportPolicyBounds,
):
  | { ok: true; width: number; height: number }
  | { ok: false; message: string } {
  const w = Math.round(width);
  const h = Math.round(height);
  if (
    !Number.isFinite(w)
    || !Number.isFinite(h)
    || w < policy.minWidth
    || h < policy.minHeight
  ) {
    return {
      ok: false,
      message: `viewport ${w}×${h} below minimum ${policy.minWidth}×${policy.minHeight}`,
    };
  }
  if (w > policy.maxWidth || h > policy.maxHeight) {
    return {
      ok: false,
      message: `viewport ${w}×${h} above maximum ${policy.maxWidth}×${policy.maxHeight}`,
    };
  }
  return { ok: true, width: w, height: h };
}

/** Read layout host size in CSS pixels (1:1 session viewport target). */
export function measureHostElement(el: HTMLElement | null): ViewportSize {
  if (!el) {
    return { width: 0, height: 0 };
  }
  return {
    width: Math.round(el.clientWidth),
    height: Math.round(el.clientHeight),
  };
}
