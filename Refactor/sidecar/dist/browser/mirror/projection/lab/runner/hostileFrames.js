"use strict";
/**
 * Hostile frames for lab injectFrame — producer-honest path never emits these.
 * Client relay only (not Virtual, not chassis nodeTable).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeAttrDesyncFrame = encodeAttrDesyncFrame;
exports.encodeRulesetDesyncFrame = encodeRulesetDesyncFrame;
exports.encodeEofSetupFrame = encodeEofSetupFrame;
exports.encodeEofCheckFrame = encodeEofCheckFrame;
const binaryFrameEncoder_1 = require("../../virtual/frame/binaryFrameEncoder");
const frame_1 = require("../../models/frame");
const opcodes_1 = require("../../models/opcodes");
/** High ids — well above a typical lab document allocator. */
const ATTR_NODE_ID = 199_991;
const SHEET_ID = 199_980;
const RULE_ID = 199_981;
function encodeOps(args) {
    const frame = (0, frame_1.createFrame)({
        generation: args.generation,
        sequence: args.sequence,
        ops: args.ops,
        preTableHash: args.preTableHash,
        resync: false,
    });
    const parts = new binaryFrameEncoder_1.BinaryFrameEncoder().encode(frame);
    if (parts.length !== 1) {
        throw new Error(`hostile frame split into ${parts.length} parts`);
    }
    return parts[0];
}
/** NODE_NEW Element with an invalid attribute name — setAttribute throws (SEAL-DOM-P0-ATTR). */
function encodeAttrDesyncFrame(generation, sequence, preTableHash) {
    return encodeOps({
        generation,
        sequence,
        preTableHash,
        ops: [
            {
                op: opcodes_1.OpCode.NodeNew,
                id: ATTR_NODE_ID,
                kind: opcodes_1.NodeKind.Element,
                name: 'div',
                attrs: [{ name: 'foo bar', value: 'x' }],
            },
        ],
    });
}
/** SHEET_NEW + RULE_NEW @media + RULE_SET on that grouping id (SEAL-CSSOM-P0-RULESET). */
function encodeRulesetDesyncFrame(generation, sequence, preTableHash) {
    return encodeOps({
        generation,
        sequence,
        preTableHash,
        ops: [
            {
                op: opcodes_1.OpCode.SheetNew,
                id: SHEET_ID,
                scope: frame_1.CSSOM_SCOPE_MAIN,
                hostNode: frame_1.DOCUMENT_ID,
                before: frame_1.INSERT_AT_END,
            },
            {
                op: opcodes_1.OpCode.RuleNew,
                sheet: SHEET_ID,
                id: RULE_ID,
                before: frame_1.INSERT_AT_END,
                text: '@media all{.x{color:red}}',
            },
            {
                op: opcodes_1.OpCode.RuleSet,
                id: RULE_ID,
                text: '@media all{.x{color:navy}}',
            },
        ],
    });
}
/** Honest constructed sheet+rule so EOF has a live handle to tamper against. */
function encodeEofSetupFrame(generation, sequence, preTableHash) {
    return encodeOps({
        generation,
        sequence,
        preTableHash,
        ops: [
            {
                op: opcodes_1.OpCode.SheetNew,
                id: SHEET_ID,
                scope: frame_1.CSSOM_SCOPE_MAIN,
                hostNode: frame_1.DOCUMENT_ID,
                before: frame_1.INSERT_AT_END,
            },
            {
                op: opcodes_1.OpCode.RuleNew,
                sheet: SHEET_ID,
                id: RULE_ID,
                before: frame_1.INSERT_AT_END,
                text: '.lab-eof{color:red}',
            },
        ],
    });
}
/** CHECK-only — table unchanged; EOF verify runs after a live ghost rule (SEAL-CSSOM-P0-EOF). */
function encodeEofCheckFrame(generation, sequence, tableHash) {
    return encodeOps({
        generation,
        sequence,
        preTableHash: tableHash,
        ops: [
            {
                op: opcodes_1.OpCode.Check,
                scope: frame_1.CHECK_SCOPE_TABLE,
                lo: 0,
                hi: 0,
                hash: tableHash,
            },
        ],
    });
}
//# sourceMappingURL=hostileFrames.js.map