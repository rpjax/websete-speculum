"use strict";
/**
 * Data-plane binary envelope — one WebSocket message = one envelope.
 *
 * ```
 * magic   u16 LE  'SP' (0x5053)
 * version u8      1
 * channel u8      PlaneChannel
 * flags   u8      0 (reserved)
 * payload …       channel-specific bytes (Frame ⇒ raw PP part)
 * ```
 *
 * Shared by Virtual (browser) and sidecar (Node). No DOM types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANE_HEADER_SIZE = exports.PLANE_VERSION = exports.PLANE_MAGIC = void 0;
exports.encodePlaneEnvelope = encodePlaneEnvelope;
exports.decodePlaneEnvelope = decodePlaneEnvelope;
exports.isPlaneEnvelope = isPlaneEnvelope;
exports.PLANE_MAGIC = 0x5053; // 'S' | 'P' LE → bytes 53 50
exports.PLANE_VERSION = 1;
exports.PLANE_HEADER_SIZE = 5; // magic(2)+version(1)+channel(1)+flags(1)
function encodePlaneEnvelope(channel, payload, flags = 0) {
    const out = new Uint8Array(exports.PLANE_HEADER_SIZE + payload.length);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint16(0, exports.PLANE_MAGIC, true);
    out[2] = exports.PLANE_VERSION;
    out[3] = channel & 0xff;
    out[4] = flags & 0xff;
    out.set(payload, exports.PLANE_HEADER_SIZE);
    return out;
}
function decodePlaneEnvelope(message) {
    if (message.length < exports.PLANE_HEADER_SIZE)
        return null;
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    if (view.getUint16(0, true) !== exports.PLANE_MAGIC)
        return null;
    if (message[2] !== exports.PLANE_VERSION)
        return null;
    const channel = message[3];
    const flags = message[4];
    return {
        channel,
        flags,
        payload: message.subarray(exports.PLANE_HEADER_SIZE),
    };
}
/** True when message looks like a data-plane envelope (vs bare PP). */
function isPlaneEnvelope(message) {
    if (message.length < exports.PLANE_HEADER_SIZE)
        return false;
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    return view.getUint16(0, true) === exports.PLANE_MAGIC && message[2] === exports.PLANE_VERSION;
}
//# sourceMappingURL=envelope.js.map