"use strict";
/**
 * Unit: single-tab init script folds target=_blank / window.open into same-tab href.
 * No Chromium — pure string contract + small DOM simulation via vm is overkill;
 * we assert the script source contains the rewrite hooks and export shape.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSingleTabUnitTests = runSingleTabUnitTests;
const assert_1 = __importDefault(require("assert"));
const singleTab_1 = require("./singleTab");
async function runSingleTabUnitTests() {
    assert_1.default.ok(singleTab_1.SINGLE_TAB_INIT_SCRIPT.includes('speculum_single_tab_open'));
    assert_1.default.ok(singleTab_1.SINGLE_TAB_INIT_SCRIPT.includes("target=_blank") || singleTab_1.SINGLE_TAB_INIT_SCRIPT.includes("'_blank'"));
    assert_1.default.ok(singleTab_1.SINGLE_TAB_INIT_SCRIPT.includes('window.location.href'));
    assert_1.default.ok(singleTab_1.SINGLE_TAB_INIT_SCRIPT.includes('preventDefault'));
    console.log('[unit] singleTab init script contract ok');
}
//# sourceMappingURL=singleTab.unit.js.map