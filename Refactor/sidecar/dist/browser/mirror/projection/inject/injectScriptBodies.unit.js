"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInjectScriptBodiesUnitTests = runInjectScriptBodiesUnitTests;
const assert_1 = __importDefault(require("assert"));
const injectScriptBodies_1 = require("./injectScriptBodies");
async function runInjectScriptBodiesUnitTests() {
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('speculum_setAttribute'));
    assert_1.default.ok(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.includes('appendChild'));
    assert_1.default.ok(injectScriptBodies_1.SINGLE_TAB_BODY.includes('speculum_single_tab_open'));
    console.log('[unit] injectScriptBodies ok');
}
//# sourceMappingURL=injectScriptBodies.unit.js.map