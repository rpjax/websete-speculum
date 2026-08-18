"use strict";
/**
 * docs/page-projection/spec/frame-protocol.md §3–§4 — one opcode space, table + structure + node state.
 * Values are wire-stable: never renumber, only append. Ranges match §3 exactly.
 *
 * CSSOM opcodes `0xA0–0xA5` (§4.6) are on the wire. Lab client phase 2 materializes owned
 * constructed sheets on `adoptedStyleSheets` + `CSSStyleRule` (C6); pierce still desyncs.
 * `Check`/`NodeDrop` are used. OPEN-2 deferred GC still applies to DOM rows.
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
    OpCode[OpCode["PropSet"] = 99] = "PropSet";
    OpCode[OpCode["SheetNew"] = 160] = "SheetNew";
    OpCode[OpCode["SheetDrop"] = 161] = "SheetDrop";
    OpCode[OpCode["SheetOrder"] = 162] = "SheetOrder";
    OpCode[OpCode["RuleNew"] = 163] = "RuleNew";
    OpCode[OpCode["RuleDrop"] = 164] = "RuleDrop";
    OpCode[OpCode["RuleSet"] = 165] = "RuleSet";
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
    [OpCode.PropSet]: 'propSet',
    [OpCode.SheetNew]: 'sheetNew',
    [OpCode.SheetDrop]: 'sheetDrop',
    [OpCode.SheetOrder]: 'sheetOrder',
    [OpCode.RuleNew]: 'ruleNew',
    [OpCode.RuleDrop]: 'ruleDrop',
    [OpCode.RuleSet]: 'ruleSet',
};
function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
}
/** §1.3 node row `kind`. Sheet/Rule are table rows (phase 1); owned CSSOM apply is C6. */
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