"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEWPORT_BOUNDS = void 0;
exports.normalizeStartViewport = normalizeStartViewport;
exports.validateResizeViewport = validateResizeViewport;
/** Viewport bounds — keep in sync with Speculum.Api ViewportDimensions. */
exports.VIEWPORT_BOUNDS = {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 4096,
    maxHeight: 2160,
    defaultWidth: 1280,
    defaultHeight: 720,
};
function normalizeStartViewport(width, height) {
    let w = width > 0 ? Math.round(width) : exports.VIEWPORT_BOUNDS.defaultWidth;
    let h = height > 0 ? Math.round(height) : exports.VIEWPORT_BOUNDS.defaultHeight;
    w = Math.min(exports.VIEWPORT_BOUNDS.maxWidth, Math.max(1, w));
    h = Math.min(exports.VIEWPORT_BOUNDS.maxHeight, Math.max(1, h));
    return { width: w, height: h };
}
function validateResizeViewport(width, height) {
    const w = Math.round(width);
    const h = Math.round(height);
    if (!Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < exports.VIEWPORT_BOUNDS.minWidth ||
        h < exports.VIEWPORT_BOUNDS.minHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} below minimum ` +
                `${exports.VIEWPORT_BOUNDS.minWidth}×${exports.VIEWPORT_BOUNDS.minHeight}`,
        };
    }
    if (w > exports.VIEWPORT_BOUNDS.maxWidth || h > exports.VIEWPORT_BOUNDS.maxHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} above maximum ` +
                `${exports.VIEWPORT_BOUNDS.maxWidth}×${exports.VIEWPORT_BOUNDS.maxHeight}`,
        };
    }
    return { ok: true, width: w, height: h };
}
//# sourceMappingURL=viewport-bounds.js.map