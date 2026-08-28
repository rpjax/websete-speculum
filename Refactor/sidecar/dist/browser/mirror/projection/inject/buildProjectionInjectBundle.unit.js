"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBuildProjectionInjectBundleUnitTests = runBuildProjectionInjectBundleUnitTests;
const assert_1 = __importDefault(require("assert"));
const injectSentinel_1 = require("./injectSentinel");
const buildProjectionInjectBundle_1 = require("./buildProjectionInjectBundle");
const injectScriptBodies_1 = require("./injectScriptBodies");
async function runBuildProjectionInjectBundleUnitTests() {
    const bundle = (0, buildProjectionInjectBundle_1.buildProjectionInjectBundle)({
        config: {
            sessionId: 'sess-1',
            transport: 'loopback',
            dataPlaneUrl: 'ws://127.0.0.1:40133/',
            planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
            generation: 1,
        },
        includeCspDiag: false,
    });
    assert_1.default.ok(bundle.startsWith(injectSentinel_1.INJECT_SENTINEL_COMMENT));
    assert_1.default.ok(bundle.includes(injectSentinel_1.INJECT_SENTINEL_MARKER));
    assert_1.default.ok(bundle.includes(injectSentinel_1.INJECT_ARM_GLOBAL));
    assert_1.default.ok(bundle.includes('speculum_pp_inject_once'), 'inject must wrap in arm IIFE');
    const onceIdx = bundle.indexOf('speculum_pp_inject_once');
    const preludeIdx = bundle.indexOf('speculum_pp_inject_boot');
    assert_1.default.ok(onceIdx >= 0 && preludeIdx > onceIdx, 'arm wrapper must enclose prelude');
    assert_1.default.ok(bundle.includes('__speculumScrubInjectScripts'));
    assert_1.default.ok(bundle.includes(injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY.slice(0, 40)));
    assert_1.default.ok(bundle.includes(injectScriptBodies_1.SINGLE_TAB_BODY.slice(0, 30)));
    assert_1.default.ok(bundle.includes('globalThis.__SPECULUM_PROJECTION__'));
    assert_1.default.ok(bundle.includes('speculum_pp_inject_boot'));
    assert_1.default.ok(bundle.includes('speculum_extension_plane_shim'));
    assert_1.default.ok(!bundle.includes('<script'));
    const withDiag = (0, buildProjectionInjectBundle_1.buildProjectionInjectBundle)({
        config: {
            sessionId: 'sess-1',
            transport: 'loopback',
            dataPlaneUrl: 'ws://127.0.0.1:40133/',
            planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
        },
        includeCspDiag: true,
    });
    assert_1.default.ok(withDiag.includes('speculum_csp_diag_probe'));
    assert_1.default.ok(!/new WebSocket\s*\(\s*cfg\.dataPlaneUrl\s*\)/.test(withDiag));
    console.log('[unit] buildProjectionInjectBundle ok');
}
//# sourceMappingURL=buildProjectionInjectBundle.unit.js.map