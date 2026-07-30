"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoordTransform = createCoordTransform;
exports.mapLogicalToAbs = mapLogicalToAbs;
function createCoordTransform(logicalWidth, logicalHeight, absMaxX, absMaxY) {
    if (logicalWidth <= 0 || logicalHeight <= 0 || absMaxX < 0 || absMaxY < 0) {
        throw new Error('invalid coordinate transform dimensions');
    }
    return { logicalWidth, logicalHeight, absMaxX, absMaxY };
}
function mapLogicalToAbs(t, x, y) {
    const nx = Math.round((x / t.logicalWidth) * t.absMaxX);
    const ny = Math.round((y / t.logicalHeight) * t.absMaxY);
    return {
        x: clamp(nx, 0, t.absMaxX),
        y: clamp(ny, 0, t.absMaxY),
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