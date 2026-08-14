"use strict";
/**
 * Logical instruction model — docs/page-projection/spec/frame-protocol.md §1–§4.
 * No DOM types here. This is the replicated-table wire model (NOT the old
 * dirty-set / net-effect / establish model — that layer is dead, see HANDOFF.md §13).
 *
 * String fields here are plain `string` — the persistent/frame-local `StrRef` split
 * (§1.7, bit31 discriminator) is a wire/encode concern, not a logical one. See
 * `binaryFrameEncoder.ts` (producer) / `client/decode.ts` (client) for the bit-level
 * split. v0 (this lab increment) only ever emits frame-local refs — see
 * `tableFrameBuilder.ts` for why persistent interning is deliberately deferred.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECK_SCOPE_RANGE = exports.CHECK_SCOPE_TABLE = exports.INSERT_AT_END = exports.DOCUMENT_ID = exports.FRAME_WIRE_VERSION = exports.NodeKind = void 0;
exports.createFrame = createFrame;
const opcodes_1 = require("./opcodes");
Object.defineProperty(exports, "NodeKind", { enumerable: true, get: function () { return opcodes_1.NodeKind; } });
exports.FRAME_WIRE_VERSION = 1;
/** id `1` is reserved for the Document row (frame-protocol.md §1.2). */
exports.DOCUMENT_ID = 1;
/** `before = 0` in `INSERT` means "insert at end" (§4.3). */
exports.INSERT_AT_END = 0;
/** §4.1 `CHECK.scope` — `Table` = whole table (`lo`/`hi` ignored), `Range` = id range `[lo, hi]`. */
exports.CHECK_SCOPE_TABLE = 0;
exports.CHECK_SCOPE_RANGE = 1;
function createFrame(args) {
    return {
        version: exports.FRAME_WIRE_VERSION,
        flags: { resync: args.resync ?? false },
        generation: args.generation,
        sequence: args.sequence,
        preTableHash: args.preTableHash ?? 0n,
        ops: args.ops,
    };
}
//# sourceMappingURL=frame.js.map