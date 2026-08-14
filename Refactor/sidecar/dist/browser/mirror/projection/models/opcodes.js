"use strict";
/**
 * docs/page-projection/spec/frame-protocol.md §3–§4 — one opcode space, table + structure + node state.
 * Values are wire-stable: never renumber, only append. Ranges match §3 exactly.
 *
 * v0 scope (this lab increment): DOM only. `Check`/`NodeDrop`/`NodeMeta` are defined for wire
 * completeness but the v0 producer never emits them and the v0 client never requires them —
 * see frame-protocol.md OPEN-2 (deferred GC) and the resync section (§5.8, not implemented yet).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeKind = exports.OpCode = void 0;
exports.opCodeName = opCodeName;
var OpCode;
(function (OpCode) {
    OpCode[OpCode["Check"] = 1] = "Check";
    OpCode[OpCode["EpochReset"] = 2] = "EpochReset";
    OpCode[OpCode["StrDef"] = 3] = "StrDef";
    OpCode[OpCode["NodeNew"] = 32] = "NodeNew";
    OpCode[OpCode["NodeDrop"] = 33] = "NodeDrop";
    OpCode[OpCode["Insert"] = 64] = "Insert";
    OpCode[OpCode["Remove"] = 65] = "Remove";
    OpCode[OpCode["AttrSet"] = 96] = "AttrSet";
    OpCode[OpCode["AttrDel"] = 97] = "AttrDel";
    OpCode[OpCode["TextSet"] = 98] = "TextSet";
})(OpCode || (exports.OpCode = OpCode = {}));
const NAMES = {
    [OpCode.Check]: 'check',
    [OpCode.EpochReset]: 'epochReset',
    [OpCode.StrDef]: 'strDef',
    [OpCode.NodeNew]: 'nodeNew',
    [OpCode.NodeDrop]: 'nodeDrop',
    [OpCode.Insert]: 'insert',
    [OpCode.Remove]: 'remove',
    [OpCode.AttrSet]: 'attrSet',
    [OpCode.AttrDel]: 'attrDel',
    [OpCode.TextSet]: 'textSet',
};
function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
}
/** §1.3 node row `kind`. `Sheet`/`Rule` reserved — not projected by the v0 (DOM-only) producer. */
var NodeKind;
(function (NodeKind) {
    NodeKind[NodeKind["Element"] = 1] = "Element";
    NodeKind[NodeKind["Text"] = 2] = "Text";
    NodeKind[NodeKind["Comment"] = 3] = "Comment";
    NodeKind[NodeKind["Sheet"] = 4] = "Sheet";
    NodeKind[NodeKind["Rule"] = 5] = "Rule";
    NodeKind[NodeKind["Doctype"] = 6] = "Doctype";
})(NodeKind || (exports.NodeKind = NodeKind = {}));
//# sourceMappingURL=opcodes.js.map