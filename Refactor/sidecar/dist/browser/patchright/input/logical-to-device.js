"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoordTransform = createCoordTransform;
exports.createLogicalWindowTransform = createLogicalWindowTransform;
exports.mapLogicalToAbs = mapLogicalToAbs;
function createCoordTransform(logicalWidth, logicalHeight, absMaxX, absMaxY) {
    if (logicalWidth <= 0 || logicalHeight <= 0 || absMaxX < 0 || absMaxY < 0) {
        throw new Error('invalid coordinate transform dimensions');
    }
    return { logicalWidth, logicalHeight, absMaxX, absMaxY };
}
/**
 * Transform for a Chrome window at (0,0) sized to the logical CSS viewport.
 * Absolute extent is logical-1 (inclusive ABS range), not Xvfb capacity.
 */
function createLogicalWindowTransform(logicalWidth, logicalHeight) {
    const w = Math.round(logicalWidth);
    const h = Math.round(logicalHeight);
    if (w <= 0 || h <= 0) {
        throw new Error('logical window transform requires positive width and height');
    }
    return createCoordTransform(w, h, Math.max(0, w - 1), Math.max(0, h - 1));
}
function mapLogicalToAbs(t, x, y) {
    return {
        x: clamp(Math.round(x), 0, t.absMaxX),
        y: clamp(Math.round(y), 0, t.absMaxY),
    };
}
function clamp(v, min, max) {
    if (v < min)
        return min;
    if (v > max)
        return max;
    return v;
}
//# sourceMappingURL=logical-to-device.js.map