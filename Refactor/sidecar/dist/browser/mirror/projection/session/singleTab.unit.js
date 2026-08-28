"use strict";
/**
 * Unit: single-tab body folds target=_blank / window.open into same-tab href.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSingleTabUnitTests = runSingleTabUnitTests;
const assert_1 = __importDefault(require("assert"));
const injectScriptBodies_1 = require("../inject/injectScriptBodies");
async function runSingleTabUnitTests() {
    assert_1.default.ok(injectScriptBodies_1.SINGLE_TAB_BODY.includes('speculum_single_tab_open'));
    assert_1.default.ok(injectScriptBodies_1.SINGLE_TAB_BODY.includes("target=_blank") || injectScriptBodies_1.SINGLE_TAB_BODY.includes("'_blank'"));
    assert_1.default.ok(injectScriptBodies_1.SINGLE_TAB_BODY.includes('window.location.href'));
    assert_1.default.ok(injectScriptBodies_1.SINGLE_TAB_BODY.includes('preventDefault'));
    console.log('[unit] singleTab init script contract ok');
}
//# sourceMappingURL=singleTab.unit.js.map