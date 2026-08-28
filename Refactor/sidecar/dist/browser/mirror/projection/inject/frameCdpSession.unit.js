"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFrameCdpSessionUnitTests = runFrameCdpSessionUnitTests;
const assert_1 = __importDefault(require("assert"));
const frameCdpSession_1 = require("../session/frameCdpSession");
async function runFrameCdpSessionUnitTests() {
    const state = (0, frameCdpSession_1.createFrameCdpAttachState)();
    const mainFrame = {};
    const childFrame = {};
    let sessionCount = 0;
    const page = {
        mainFrame: () => mainFrame,
        frames: () => [mainFrame, childFrame],
        on: () => { },
    };
    const context = {
        newCDPSession: async (frame) => {
            sessionCount += 1;
            assert_1.default.strictEqual(frame, childFrame);
            return { id: 'frame-cdp' };
        },
    };
    const first = await (0, frameCdpSession_1.attachFrameCdp)(childFrame, page, context, state);
    const second = await (0, frameCdpSession_1.attachFrameCdp)(childFrame, page, context, state);
    assert_1.default.strictEqual(sessionCount, 1, 'attach must be idempotent');
    assert_1.default.strictEqual(first, second);
    const main = await (0, frameCdpSession_1.attachFrameCdp)(mainFrame, page, context, state);
    assert_1.default.strictEqual(main, null);
    let wired = 0;
    await (0, frameCdpSession_1.wireFrameCdpLifecycle)({
        page,
        context,
        state,
        onFrameSession: async (frame) => {
            if (frame === childFrame)
                wired += 1;
        },
    });
    assert_1.default.strictEqual(wired, 1, 'wire must attach existing child frame once');
    console.log('[unit] frameCdpSession ok');
}
//# sourceMappingURL=frameCdpSession.unit.js.map