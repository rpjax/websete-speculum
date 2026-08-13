"use strict";
/**
 * §5.4 — one opcode space for Dom + Cssom (no `plane` header).
 * Values are wire-stable: never renumber, only append.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpCode = void 0;
exports.opCodeName = opCodeName;
exports.opCodePlane = opCodePlane;
var OpCode;
(function (OpCode) {
    OpCode[OpCode["EstablishBegin"] = 1] = "EstablishBegin";
    OpCode[OpCode["EstablishChunk"] = 2] = "EstablishChunk";
    OpCode[OpCode["EstablishEnd"] = 3] = "EstablishEnd";
    OpCode[OpCode["ChildList"] = 4] = "ChildList";
    OpCode[OpCode["Patch"] = 5] = "Patch";
    OpCode[OpCode["ScrollViewport"] = 6] = "ScrollViewport";
    OpCode[OpCode["ScrollElement"] = 7] = "ScrollElement";
    OpCode[OpCode["CssomInstall"] = 8] = "CssomInstall";
    OpCode[OpCode["CssomSheetList"] = 9] = "CssomSheetList";
    OpCode[OpCode["CssomRuleList"] = 10] = "CssomRuleList";
    OpCode[OpCode["CssomPatch"] = 11] = "CssomPatch";
    /** title/lang/dir/meta viewport — appended; never renumber. */
    OpCode[OpCode["DocumentState"] = 12] = "DocumentState";
})(OpCode || (exports.OpCode = OpCode = {}));
const NAMES = {
    [OpCode.EstablishBegin]: 'establishBegin',
    [OpCode.EstablishChunk]: 'establishChunk',
    [OpCode.EstablishEnd]: 'establishEnd',
    [OpCode.ChildList]: 'childList',
    [OpCode.Patch]: 'patch',
    [OpCode.ScrollViewport]: 'scrollViewport',
    [OpCode.ScrollElement]: 'scrollElement',
    [OpCode.CssomInstall]: 'cssomInstall',
    [OpCode.CssomSheetList]: 'cssomSheetList',
    [OpCode.CssomRuleList]: 'cssomRuleList',
    [OpCode.CssomPatch]: 'cssomPatch',
    [OpCode.DocumentState]: 'documentState',
};
function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
}
const CSSOM_CODES = new Set([
    OpCode.CssomInstall,
    OpCode.CssomSheetList,
    OpCode.CssomRuleList,
    OpCode.CssomPatch,
]);
function opCodePlane(code) {
    return CSSOM_CODES.has(code) ? 'cssom' : 'dom';
}
//# sourceMappingURL=opcodes.js.map