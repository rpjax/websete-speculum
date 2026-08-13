"use strict";
/**
 * Chromium ↔ Sidecar data-plane channels (mux over one loopback WebSocket).
 *
 * Values are wire-stable: never renumber; only append.
 * Frame bodies stay on {@link PlaneChannel.Frame} — opaque PP bytes, own backpressure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaneChannel = void 0;
exports.planeChannelName = planeChannelName;
var PlaneChannel;
(function (PlaneChannel) {
    /** PageProjection frame / part bytes (§5.5). Opaque; do not parse on the plane. */
    PlaneChannel[PlaneChannel["Frame"] = 1] = "Frame";
    /** Reserved — rate hints / non-frame control later. */
    PlaneChannel[PlaneChannel["Control"] = 2] = "Control";
    /** Projection telemetry (Virtual → sidecar push). Compact JSON UTF-8 payload. */
    PlaneChannel[PlaneChannel["Telemetry"] = 3] = "Telemetry";
})(PlaneChannel || (exports.PlaneChannel = PlaneChannel = {}));
function planeChannelName(ch) {
    switch (ch) {
        case PlaneChannel.Frame:
            return 'frame';
        case PlaneChannel.Control:
            return 'control';
        case PlaneChannel.Telemetry:
            return 'telemetry';
        default:
            return `channel(${ch})`;
    }
}
//# sourceMappingURL=channels.js.map