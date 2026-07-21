"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const Navigation_1 = require("./browser/patchright/Navigation");
const viewport_bounds_1 = require("./browser/patchright/viewport-bounds");
function testDomainMatch() {
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('example.com', ['example.com']), true);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('www.example.com', ['*.example.com']), true);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('evil.com', ['example.com']), false);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('example.com', ['*.example.com']), false);
    console.log('[unit] domain match ok');
}
function testViewportBounds() {
    const start = (0, viewport_bounds_1.normalizeStartViewport)(0, 0);
    assert_1.default.strictEqual(start.width, 1280);
    assert_1.default.strictEqual(start.height, 720);
    const ok = (0, viewport_bounds_1.validateResizeViewport)(800, 600);
    assert_1.default.strictEqual(ok.ok, true);
    const tooSmall = (0, viewport_bounds_1.validateResizeViewport)(10, 10);
    assert_1.default.strictEqual(tooSmall.ok, false);
    const tooBig = (0, viewport_bounds_1.validateResizeViewport)(9000, 9000);
    assert_1.default.strictEqual(tooBig.ok, false);
    console.log('[unit] viewport bounds ok');
}
testDomainMatch();
testViewportBounds();
console.log('[unit] all passed');
//# sourceMappingURL=unit.js.map