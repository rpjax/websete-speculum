"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScriptingOnPaintParityUnitTests = runScriptingOnPaintParityUnitTests;
const assert_1 = __importDefault(require("assert"));
const scriptingOnPaintParity_1 = require("@speculum/page-projection/projected/scriptingOnPaintParity");
function runScriptingOnPaintParityUnitTests() {
    assert_1.default.match(scriptingOnPaintParity_1.SCRIPTING_ON_PAINT_PARITY_CSS, /noscript/);
    assert_1.default.match(scriptingOnPaintParity_1.SCRIPTING_ON_PAINT_PARITY_CSS, /display\s*:\s*none/i);
    console.log('[unit] scripting-on-paint-parity ok');
}
//# sourceMappingURL=scriptingOnPaintParity.unit.js.map