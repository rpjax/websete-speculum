/** Sidecar viewport bounds — keep in sync with Speculum.Api ViewportDimensions. */
export const VIEWPORT_BOUNDS = {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 4096,
    maxHeight: 2160,
    defaultWidth: 1280,
    defaultHeight: 720,
} as const;

export type ViewportValidation =
    | { ok: true; width: number; height: number }
    | { ok: false; errorCode: 'invalid_viewport'; message: string };

/** Startup only: 0 / non-positive → defaults; clamp to max. */
export function normalizeStartViewport(width: number, height: number): { width: number; height: number } {
    let w = width > 0 ? Math.round(width) : VIEWPORT_BOUNDS.defaultWidth;
    let h = height > 0 ? Math.round(height) : VIEWPORT_BOUNDS.defaultHeight;
    w = Math.min(VIEWPORT_BOUNDS.maxWidth, Math.max(1, w));
    h = Math.min(VIEWPORT_BOUNDS.maxHeight, Math.max(1, h));
    return { width: w, height: h };
}

/** Runtime resize: reject &lt;100 or above ceiling — never snap or clamp silently. */
export function validateResizeViewport(width: number, height: number): ViewportValidation {
    const w = Math.round(width);
    const h = Math.round(height);
    if (!Number.isFinite(w) || !Number.isFinite(h)
        || w < VIEWPORT_BOUNDS.minWidth || h < VIEWPORT_BOUNDS.minHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} below minimum `
                + `${VIEWPORT_BOUNDS.minWidth}×${VIEWPORT_BOUNDS.minHeight}`,
        };
    }
    if (w > VIEWPORT_BOUNDS.maxWidth || h > VIEWPORT_BOUNDS.maxHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} above maximum `
                + `${VIEWPORT_BOUNDS.maxWidth}×${VIEWPORT_BOUNDS.maxHeight}`,
        };
    }
    return { ok: true, width: w, height: h };
}
