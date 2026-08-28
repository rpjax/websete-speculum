"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCspMetaNeutralizeInitScriptUnitTests = runCspMetaNeutralizeInitScriptUnitTests;
const assert_1 = __importDefault(require("assert"));
const injectScriptBodies_1 = require("../../inject/injectScriptBodies");
async function runCspMetaNeutralizeInitScriptUnitTests() {
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('speculum_setAttribute'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('appendChild'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('insertBefore'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('setAttribute'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('content-security-policy'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('isCspMeta'));
    console.log('[unit] cspMetaNeutralizeInitScript ok');
}
//# sourceMappingURL=cspMetaNeutralizeInitScript.unit.js.map