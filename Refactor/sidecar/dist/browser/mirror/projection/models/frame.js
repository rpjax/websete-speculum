"use strict";
/**
 * Logical frame model (parent §5.4–5.5) — structured ops before binary encode.
 * No DOM types here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAME_WIRE_VERSION = void 0;
exports.createLiveFrame = createLiveFrame;
exports.createEstablishFrame = createEstablishFrame;
exports.FRAME_WIRE_VERSION = 1;
function createLiveFrame(args) {
    return {
        version: exports.FRAME_WIRE_VERSION,
        flags: { establish: false, resync: false },
        generation: args.generation,
        sequence: args.sequence,
        ops: args.ops,
    };
}
function createEstablishFrame(args) {
    return {
        version: exports.FRAME_WIRE_VERSION,
        flags: { establish: true, resync: args.resync ?? false },
        generation: args.generation,
        sequence: args.sequence,
        ops: args.ops,
    };
}
//# sourceMappingURL=frame.js.map