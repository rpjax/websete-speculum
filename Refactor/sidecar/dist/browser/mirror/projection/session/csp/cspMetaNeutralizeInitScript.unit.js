"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCspMetaNeutralizeInitScriptUnitTests = runCspMetaNeutralizeInitScriptUnitTests;
const assert_1 = __importDefault(require("assert"));
const cspMetaNeutralizeInitScript_1 = require("./cspMetaNeutralizeInitScript");
async function runCspMetaNeutralizeInitScriptUnitTests() {
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('speculum_csp_meta_neutralize'));
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('appendChild'));
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('insertBefore'));
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('setAttribute'));
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('content-security-policy'));
    assert_1.default.ok(cspMetaNeutralizeInitScript_1.CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('isCspMeta'));
    console.log('[unit] cspMetaNeutralize init script contract ok');
}
//# sourceMappingURL=cspMetaNeutralizeInitScript.unit.js.map