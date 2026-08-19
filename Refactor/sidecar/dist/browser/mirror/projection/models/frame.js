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
exports.CSSOM_SCOPE_PIERCE_HOST = exports.CSSOM_SCOPE_MAIN = exports.CHECK_SCOPE_RANGE = exports.CHECK_SCOPE_TABLE = exports.SHADOW_INIT_FLAGS_MASK = exports.SHADOW_INIT_SERIALIZABLE = exports.SHADOW_INIT_CLONABLE = exports.SHADOW_INIT_DELEGATES_FOCUS = exports.SHADOW_MODE_OPEN = exports.INSERT_AT_END = exports.DOCUMENT_ID = exports.FRAME_WIRE_VERSION = exports.NodeKind = void 0;
exports.createFrame = createFrame;
exports.spliceCssomBeforeCheck = spliceCssomBeforeCheck;
const opcodes_1 = require("./opcodes");
Object.defineProperty(exports, "NodeKind", { enumerable: true, get: function () { return opcodes_1.NodeKind; } });
/** Current wire version. Operand change on `NODE_NEW` Element (`ns`) bumped 1 → 2; no shim (§9). */
exports.FRAME_WIRE_VERSION = 2;
/** id `1` is reserved for the Document row (frame-protocol.md §1.2). */
exports.DOCUMENT_ID = 1;
/** `before = 0` in `INSERT` means "insert at end" (§4.3). */
exports.INSERT_AT_END = 0;
/** `NODE_NEW SHADOW_ROOT.mode` — open only this version (`1` closed is NIT malformed). */
exports.SHADOW_MODE_OPEN = 0;
/** `initFlags` bit0 — `delegatesFocus`. */
exports.SHADOW_INIT_DELEGATES_FOCUS = 0x01;
/** `initFlags` bit1 — `clonable`. */
exports.SHADOW_INIT_CLONABLE = 0x02;
/** `initFlags` bit2 — `serializable`. */
exports.SHADOW_INIT_SERIALIZABLE = 0x04;
/** Any `initFlags` bit outside this mask is malformed. */
exports.SHADOW_INIT_FLAGS_MASK = 0x07;
/** §4.1 `CHECK.scope` — `Table` = whole table (`lo`/`hi` ignored), `Range` = id range `[lo, hi]`. */
exports.CHECK_SCOPE_TABLE = 0;
exports.CHECK_SCOPE_RANGE = 1;
/** §4.6 `scope`: MAIN=0, PIERCE_HOST=1. Lab emits MAIN only (OPEN-6). */
exports.CSSOM_SCOPE_MAIN = 0;
exports.CSSOM_SCOPE_PIERCE_HOST = 1;
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
/** Live/resync CSSOM ops sit before a trailing `CHECK` when one is present. */
function spliceCssomBeforeCheck(ops, cssom) {
    if (cssom.length === 0)
        return ops;
    const last = ops[ops.length - 1];
    if (last !== undefined && last.op === opcodes_1.OpCode.Check) {
        return [...ops.slice(0, -1), ...cssom, last];
    }
    return [...ops, ...cssom];
}
//# sourceMappingURL=frame.js.map