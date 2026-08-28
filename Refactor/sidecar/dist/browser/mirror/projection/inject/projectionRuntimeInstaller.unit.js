"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProjectionRuntimeInstallerUnitTests = runProjectionRuntimeInstallerUnitTests;
const assert_1 = __importDefault(require("assert"));
const projectionRuntimeInstaller_1 = require("./projectionRuntimeInstaller");
async function runProjectionRuntimeInstallerUnitTests() {
    const calls = [];
    const rootCdp = {
        send: async (method, params) => {
            calls.push({ method, params });
            return {};
        },
    };
    const childFrame = { url: () => 'https://challenges.cloudflare.com/turnstile' };
    const mainFrame = {
        url: () => 'about:blank',
        evaluate: async () => false,
    };
    const page = {
        mainFrame: () => mainFrame,
        frames: () => [mainFrame, childFrame],
        on: () => { },
    };
    const frameCdpCalls = [];
    const frameCdp = {
        send: async (method, params) => {
            frameCdpCalls.push({ method, params });
            return {};
        },
    };
    const context = {
        newCDPSession: async (frame) => {
            assert_1.default.strictEqual(frame, childFrame);
            return frameCdp;
        },
    };
    const installer = new projectionRuntimeInstaller_1.ProjectionRuntimeInstaller({
        context: context,
        page,
        rootCdp: rootCdp,
        config: {
            sessionId: 'sess-1',
            transport: 'loopback',
            dataPlaneUrl: 'ws://127.0.0.1:40133/',
            planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
            generation: 2,
        },
        launchScripts: [],
        includeCspDiag: false,
    });
    await installer.install();
    await installer.attachFrameForTest(childFrame);
    assert_1.default.ok(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'), 'root must register addScriptToEvaluateOnNewDocument');
    assert_1.default.ok(frameCdpCalls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'), 'OOPIF frame must register addScriptToEvaluateOnNewDocument');
    const rootSource = calls.find((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument')?.params
        ?.source;
    assert_1.default.ok(rootSource?.includes('__SPECULUM_PP_INJECT_V1__'));
    assert_1.default.ok(!rootSource?.includes('<script'));
    console.log('[unit] projectionRuntimeInstaller ok');
}
//# sourceMappingURL=projectionRuntimeInstaller.unit.js.map