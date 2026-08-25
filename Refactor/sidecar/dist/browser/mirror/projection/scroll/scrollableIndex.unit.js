"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScrollableIndexUnitTests = runScrollableIndexUnitTests;
const assert_1 = __importDefault(require("assert"));
const scrollableIndex_1 = require("@speculum/page-projection/projected/scroll/scrollableIndex");
function runScrollableIndexUnitTests() {
    assert_1.default.strictEqual((0, scrollableIndex_1.isScrollableStyle)({ overflowY: 'auto' }), true);
    assert_1.default.strictEqual((0, scrollableIndex_1.isScrollableStyle)({ overflow: 'hidden' }), false);
    const idx = new scrollableIndex_1.ScrollableIndex();
    idx.onNodeCreate(10, { overflowY: 'scroll' });
    assert_1.default.strictEqual(idx.has(10), true);
    idx.recheck(10, { overflowY: 'hidden' });
    assert_1.default.strictEqual(idx.has(10), false);
    idx.onNodeDrop(10);
    assert_1.default.strictEqual(idx.size, 0);
    console.log('[unit] scrollable index ok');
}
//# sourceMappingURL=scrollableIndex.unit.js.map