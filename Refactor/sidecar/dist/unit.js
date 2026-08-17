"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs = __importStar(require("fs"));
const Navigation_1 = require("./browser/patchright/Navigation");
const device_emulation_1 = require("./browser/patchright/device-emulation");
const device_kits_1 = require("./browser/patchright/device-kits");
const worker_target_stealth_1 = require("./browser/patchright/worker-target-stealth");
const ChromeRuntime_1 = require("./browser/patchright/ChromeRuntime");
const viewport_bounds_1 = require("./browser/patchright/viewport-bounds");
const contextCrash_1 = require("./browser/patchright/contextCrash");
const mappers_1 = require("./grpc/mappers");
const screencast_encode_1 = require("./browser/patchright/screencast-encode");
const EventBridge_1 = require("./host/EventBridge");
const DropOldestQueue_1 = require("./host/DropOldestQueue");
const browserRace_1 = require("./host/browserRace");
const PageState_1 = require("./browser/patchright/PageState");
const DomAssetCache_1 = require("./browser/patchright/mirror/dom/DomAssetCache");
const page_unit_1 = require("./browser/patchright/mirror/page/page.unit");
const v4ProjectionSession_unit_1 = require("./browser/mirror/projection/session/v4ProjectionSession.unit");
const srcsetParse_1 = require("./browser/patchright/mirror/dom/srcsetParse");
const parseDataUrl_1 = require("./browser/patchright/mirror/page/parseDataUrl");
const collectTelemetry_1 = require("./telemetry/collectTelemetry");
const hostResources_1 = require("./host/hostResources");
const rowHash_1 = require("./browser/mirror/projection/models/rowHash");
const replicatedTable_1 = require("./browser/mirror/projection/models/replicatedTable");
const tableLiveOracle_1 = require("./browser/mirror/projection/models/tableLiveOracle");
const cssomTableLiveOracle_1 = require("./browser/mirror/projection/models/cssomTableLiveOracle");
const replicatedTableApply_1 = require("./browser/mirror/projection/models/replicatedTableApply");
const opcodes_1 = require("./browser/mirror/projection/models/opcodes");
const elementNs_1 = require("./browser/mirror/projection/models/elementNs");
const frame_1 = require("./browser/mirror/projection/models/frame");
const structuralDiff_1 = require("./browser/mirror/projection/lab/probes/structuralDiff");
const decode_1 = require("./browser/mirror/projection/models/decode");
const applyBatch_1 = require("./browser/mirror/projection/models/applyBatch");
const attrApply_1 = require("./browser/mirror/projection/models/attrApply");
const cssomRuleSet_1 = require("./browser/mirror/projection/models/cssomRuleSet");
const cssomWalk_1 = require("./browser/mirror/projection/virtual/cssom/cssomWalk");
const cssomIds_1 = require("./browser/mirror/projection/virtual/cssom/cssomIds");
const cssomOps_1 = require("./browser/mirror/projection/virtual/cssom/cssomOps");
const telemetry_1 = require("./browser/mirror/projection/models/telemetry");
const tableDigest_1 = require("./browser/mirror/projection/models/tableDigest");
const cssomApplyIndex_1 = require("./browser/mirror/projection/models/cssomApplyIndex");
const binaryFrameEncoder_1 = require("./browser/mirror/projection/virtual/frame/binaryFrameEncoder");
const nodeTableApply_1 = require("./browser/mirror/projection/lab/probes/nodeTableApply");
const validate_1 = require("./browser/mirror/projection/lab/runner/validate");
const hostileFrames_1 = require("./browser/mirror/projection/lab/runner/hostileFrames");
const schedule_1 = require("./browser/mirror/projection/lab/runner/schedule");
const limits_1 = require("./browser/mirror/projection/models/limits");
const fnv32_1 = require("./browser/mirror/projection/virtual/cssom/fnv32");
const cssomReconcile_1 = require("./browser/mirror/projection/virtual/cssom/cssomReconcile");
/** Test stand-in for Sessions.ViewportPolicy — production gets this on Launch. */
const POLICY = {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 4096,
    maxHeight: 2160,
};
function testDomainMatch() {
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('example.com', ['example.com']), true);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('www.example.com', ['*.example.com']), true);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('evil.com', ['example.com']), false);
    assert_1.default.strictEqual((0, Navigation_1.matchesAllowedDomain)('example.com', ['*.example.com']), false);
    console.log('[unit] domain match ok');
}
function testScriptTargetRuleMatch() {
    const anyAny = {
        position: 'HeaderTop',
        type: 'Classic',
        file: '/s.js',
        content: '1',
        targetRules: [{
                domain: { scope: 'Any', labels: [] },
                path: { scope: 'Any', matchType: 'Prefix', segments: [] },
            }],
    };
    assert_1.default.strictEqual((0, Navigation_1.scriptMatchesUrl)(anyAny, new URL('https://a.example.com/x')), true);
    const emptyRules = {
        position: 'HeaderTop',
        type: 'Classic',
        file: '/s.js',
        content: '1',
        targetRules: [],
    };
    assert_1.default.strictEqual((0, Navigation_1.scriptMatchesUrl)(emptyRules, new URL('https://a.example.com/x')), false);
    const wildcard = {
        scope: 'Pattern',
        labels: [
            { match: 'Any', value: '' },
            { match: 'Exact', value: 'example' },
            { match: 'Exact', value: 'com' },
        ],
    };
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(wildcard, 'www.example.com'), true);
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(wildcard, 'a.b.example.com'), true);
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(wildcard, 'example.com'), false);
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(wildcard, 'evil.com'), false);
    const exact = {
        scope: 'Pattern',
        labels: [
            { match: 'Exact', value: 'www' },
            { match: 'Exact', value: 'example' },
            { match: 'Exact', value: 'com' },
        ],
    };
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(exact, 'www.example.com'), true);
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(exact, 'a.www.example.com'), false);
    const midWildcard = {
        scope: 'Pattern',
        labels: [
            { match: 'Exact', value: 'api' },
            { match: 'Any', value: '' },
            { match: 'Exact', value: 'com' },
        ],
    };
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)(midWildcard, 'api.x.com'), false);
    assert_1.default.strictEqual((0, Navigation_1.pathMatches)({ scope: 'Pattern', matchType: 'Prefix', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'), true);
    assert_1.default.strictEqual((0, Navigation_1.pathMatches)({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'), false);
    assert_1.default.strictEqual((0, Navigation_1.pathMatches)({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app'), true);
    // camelCase wire tolerance
    assert_1.default.strictEqual((0, Navigation_1.domainMatches)({ scope: 'any', labels: [] }, 'x.com'), true);
    console.log('[unit] script target rule match ok');
}
function testPermissiveMainFrameCspRewrite() {
    const headers = (0, Navigation_1.relaxMainFrameCspHeaders)([
        { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        { name: 'Content-Security-Policy', value: "default-src 'self'" },
        { name: 'Content-Security-Policy-Report-Only', value: "script-src 'none'" },
    ]);
    assert_1.default.strictEqual(headers.some((h) => h.name.toLowerCase() === 'content-security-policy-report-only'), false);
    assert_1.default.strictEqual(headers.filter((h) => h.name.toLowerCase() === 'content-security-policy').length, 1);
    assert_1.default.ok(headers.some((h) => h.name === 'Content-Security-Policy' && h.value.includes('connect-src *')));
    const html = '<html><head><title>x</title></head><body>ok</body></html>';
    const patched = (0, Navigation_1.injectPermissiveMainFrameCsp)(html);
    assert_1.default.ok(patched.includes('http-equiv="Content-Security-Policy"'));
    assert_1.default.ok(patched.includes("script-src * data: blob: 'unsafe-inline' 'unsafe-eval'"));
    assert_1.default.ok(patched.includes('connect-src * data: blob: ws: wss:'));
    console.log('[unit] permissive main-frame csp rewrite ok');
}
function testViewportBounds() {
    const invalidLaunch = (0, viewport_bounds_1.validateLaunchViewport)(0, 0, POLICY);
    assert_1.default.strictEqual(invalidLaunch.ok, false);
    const validLaunch = (0, viewport_bounds_1.validateLaunchViewport)(800, 600, POLICY);
    assert_1.default.strictEqual(validLaunch.ok, true);
    if (validLaunch.ok) {
        assert_1.default.strictEqual(validLaunch.width, 800);
        assert_1.default.strictEqual(validLaunch.height, 600);
    }
    const ok = (0, viewport_bounds_1.validateResizeViewport)(800, 600, POLICY);
    assert_1.default.strictEqual(ok.ok, true);
    const tooSmall = (0, viewport_bounds_1.validateResizeViewport)(10, 10, POLICY);
    assert_1.default.strictEqual(tooSmall.ok, false);
    const tooBig = (0, viewport_bounds_1.validateResizeViewport)(9000, 9000, POLICY);
    assert_1.default.strictEqual(tooBig.ok, false);
    const tight = { minWidth: 300, minHeight: 200, maxWidth: 1600, maxHeight: 1200 };
    assert_1.default.strictEqual((0, viewport_bounds_1.validateResizeViewport)(299, 600, tight).ok, false);
    assert_1.default.strictEqual((0, viewport_bounds_1.validateResizeViewport)(800, 600, tight).ok, true);
    assert_1.default.throws(() => (0, viewport_bounds_1.requireViewportPolicy)({}), /ViewportPolicy bounds/);
    assert_1.default.deepStrictEqual((0, viewport_bounds_1.requireViewportPolicy)({
        minWidth: 100,
        minHeight: 100,
        displayWidth: 2048,
        displayHeight: 1080,
    }), { minWidth: 100, minHeight: 100, maxWidth: 2048, maxHeight: 1080 });
    console.log('[unit] viewport bounds ok');
}
function testResolveDeviceProfileDefaults() {
    assert_1.default.deepStrictEqual((0, device_emulation_1.resolveDeviceProfile)(null), device_emulation_1.DEFAULT_DESKTOP_DEVICE);
    assert_1.default.deepStrictEqual((0, device_emulation_1.resolveDeviceProfile)(undefined), device_emulation_1.DEFAULT_DESKTOP_DEVICE);
    const partial = (0, device_emulation_1.resolveDeviceProfile)({ mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 });
    assert_1.default.strictEqual(partial.mobile, true);
    assert_1.default.strictEqual(partial.deviceScaleFactor, 2);
    assert_1.default.strictEqual(partial.maxTouchPoints, 5);
    assert_1.default.strictEqual(partial.deviceCategory, 'phone');
    const tablet = (0, device_emulation_1.resolveDeviceProfile)({
        deviceCategory: 'tablet',
        deviceScaleFactor: 2,
        maxTouchPoints: 1,
    });
    assert_1.default.strictEqual(tablet.deviceCategory, 'tablet');
    assert_1.default.strictEqual(tablet.mobile, true);
    assert_1.default.strictEqual(tablet.touch, true);
    assert_1.default.ok((tablet.maxTouchPoints ?? 0) >= 5, 'tablet kit floors mtp');
    const missingDpr = (0, device_emulation_1.resolveDeviceProfile)({ mobile: false, touch: false });
    assert_1.default.strictEqual(missingDpr.deviceScaleFactor, 1);
    assert_1.default.strictEqual(missingDpr.maxTouchPoints, 0);
    assert_1.default.strictEqual(missingDpr.deviceCategory, 'pc');
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)(null, undefined), true);
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)({ mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0 }, device_emulation_1.DEFAULT_DESKTOP_DEVICE), true);
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)({ mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 }, device_emulation_1.DEFAULT_DESKTOP_DEVICE), false);
    console.log('[unit] resolve device profile defaults ok');
}
async function testApplyLogicalViewportUsesBoundsAndMetrics() {
    const calls = [];
    const cdp = {
        send: async (method, params) => {
            calls.push({ method, params });
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 7 };
            if (method === 'Browser.getWindowBounds') {
                return { bounds: { windowState: 'normal', left: 0, top: 0, width: 1024, height: 768 } };
            }
            if (method === 'Browser.getVersion') {
                return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
            }
            if (method === 'Target.getTargets')
                return { targetInfos: [] };
            return {};
        },
        on: () => { },
        off: () => { },
    };
    const profile = await (0, device_emulation_1.applyLogicalViewport)(cdp, 1024, 768, null);
    assert_1.default.strictEqual(profile.deviceScaleFactor, 1);
    assert_1.default.strictEqual(profile.mobile, false);
    const bounds = calls.find((c) => c.method === 'Browser.setWindowBounds');
    assert_1.default.ok(bounds, 'soft logical viewport must set native window bounds');
    const b = bounds.params.bounds;
    assert_1.default.strictEqual(b.windowState, 'normal');
    assert_1.default.strictEqual(b.width, 1024);
    assert_1.default.strictEqual(b.height, 768);
    assert_1.default.strictEqual(b.left, 0);
    assert_1.default.strictEqual(b.top, 0);
    assert_1.default.ok(!calls.some((c) => c.method === 'Browser.setWindowBounds'
        && c.params?.bounds?.windowState === 'fullscreen'), 'must not use fullscreen for logical viewport');
    const metrics = calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    assert_1.default.ok(metrics, 'must apply device metrics');
    assert_1.default.strictEqual(metrics.params.width, 1024);
    assert_1.default.strictEqual(metrics.params.height, 768);
    assert_1.default.strictEqual(metrics.params.deviceScaleFactor, 1);
    assert_1.default.strictEqual(metrics.params.screenWidth, 1024);
    assert_1.default.strictEqual(metrics.params.screenHeight, 768);
    // Desktop apply must clear UA (even after prior mobile) — no early-return skip.
    const ua = calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
    assert_1.default.ok(ua, 'desktop apply must set/clear user agent');
    assert_1.default.strictEqual(ua.params.userAgent, 'Mozilla/5.0 Desktop');
    assert_1.default.strictEqual(ua.params.platform, 'Linux x86_64', 'pc kit must set navigator platform');
    const meta = ua.params
        .userAgentMetadata;
    assert_1.default.ok(meta, 'desktop apply must send userAgentMetadata');
    assert_1.default.strictEqual(meta.mobile, false);
    assert_1.default.strictEqual(meta.platform, 'Linux');
    assert_1.default.ok(Array.isArray(meta.brands) && meta.brands.length >= 3, 'greasy brands required');
    assert_1.default.ok(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'), 'kit hardware spoof must register on new documents');
    const hwInit = calls.find((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
    const hwSource = String(hwInit.params.source);
    assert_1.default.ok(hwSource.includes('hardwareConcurrency'), 'hardwareConcurrency spoof required');
    assert_1.default.ok(hwSource.includes('webglUnmaskedVendor') || hwSource.includes('UNMASKED_VENDOR'), 'WebGL UNMASKED spoof required');
    assert_1.default.ok(hwSource.includes('0x1f00') || hwSource.includes('0x1F00') || hwSource.includes('GL_VENDOR'), 'WebGL VENDOR spoof required');
    assert_1.default.ok(hwSource.includes('WebKit WebGL'), 'masked RENDERER must be WebKit WebGL');
    assert_1.default.ok(hwSource.includes('Intel') || hwSource.includes('Mesa Intel'), 'pc kit WebGL must be Linux Intel');
    assert_1.default.ok(!hwSource.includes('Mesa/X.org'), 'pc kit must not claim Mesa/X.org');
    assert_1.default.ok(!hwSource.includes('Direct3D'), 'pc kit must not claim D3D11/Windows');
    assert_1.default.ok(hwSource.includes('window.Worker'), 'Worker wrap required');
    assert_1.default.ok(hwSource.includes('SharedWorker'), 'SharedWorker wrap required');
    assert_1.default.ok(calls.some((c) => c.method === 'Target.setAutoAttach'), 'worker-target stealth must enable Target.setAutoAttach');
    const boundsIdx = calls.findIndex((c) => c.method === 'Browser.setWindowBounds');
    const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
    assert_1.default.ok(boundsIdx >= 0 && uaIdx > boundsIdx, 'window bounds before UA');
    assert_1.default.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'device metrics must apply after user-agent override');
    await assert_1.default.rejects(() => (0, device_emulation_1.applyLogicalViewport)({
        send: async (method) => {
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 1 };
            if (method === 'Browser.getVersion')
                return { product: 'Chrome/120.0.0.0' };
            return {};
        },
    }, 800, 600, null), /did not return userAgent/);
    console.log('[unit] apply logical viewport uses bounds and metrics ok');
}
async function testProveLogicalViewportUsesCssLayoutMetrics() {
    const calls = [];
    let href = 'about:blank';
    let cssW = 980;
    let cssH = 1688;
    const cdp = {
        send: async (method, params) => {
            calls.push({ method, params });
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 3 };
            if (method === 'Browser.getWindowBounds') {
                return { bounds: { windowState: 'normal', left: 0, top: 0, width: 414, height: 713 } };
            }
            if (method === 'Browser.getVersion') {
                return {
                    product: 'Chrome/120.0.0.0',
                    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                };
            }
            if (method === 'Runtime.evaluate') {
                return { result: { value: href } };
            }
            if (method === 'Page.getFrameTree') {
                return { frameTree: { frame: { id: 'frame-1' } } };
            }
            if (method === 'Page.setDocumentContent') {
                href = 'about:blank#seeded';
                cssW = 414;
                cssH = 713;
                return {};
            }
            if (method === 'Page.getLayoutMetrics') {
                return {
                    cssLayoutViewport: { clientWidth: cssW, clientHeight: cssH },
                    layoutViewport: { clientWidth: cssW, clientHeight: cssH },
                };
            }
            if (method === 'Target.getTargets')
                return { targetInfos: [] };
            return {};
        },
        on: () => { },
        off: () => { },
    };
    const proven = await (0, device_emulation_1.proveLogicalViewport)(cdp, 414, 713, { mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 }, { phase: 'launch' });
    assert_1.default.strictEqual(proven.width, 414);
    assert_1.default.strictEqual(proven.height, 713);
    assert_1.default.strictEqual(proven.device.deviceScaleFactor, 2);
    assert_1.default.ok(calls.some((c) => c.method === 'Browser.setWindowBounds'));
    assert_1.default.ok(calls.some((c) => c.method === 'Page.setDocumentContent'), 'about:blank must seed viewport meta');
    assert_1.default.ok(calls.some((c) => c.method === 'Emulation.setDeviceMetricsOverride'));
    assert_1.default.ok(calls.some((c) => c.method === 'Page.getLayoutMetrics'));
    const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
    assert_1.default.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'mobile metrics must apply after UA (avoid 980px trap)');
    const mobileUa = calls[uaIdx];
    assert_1.default.strictEqual(mobileUa.params.platform, 'Linux armv8l', 'phone kit navigator.platform must be Linux armv8l');
    assert_1.default.ok(String(mobileUa.params.userAgent).includes('Android 13; Pixel 7'), 'phone kit UA');
    await assert_1.default.rejects(() => (0, device_emulation_1.proveLogicalViewport)({
        send: async (method) => {
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 1 };
            if (method === 'Browser.getWindowBounds') {
                return { bounds: { windowState: 'normal', width: 414, height: 713 } };
            }
            if (method === 'Browser.getVersion') {
                return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
            }
            if (method === 'Runtime.evaluate') {
                return { result: { value: 'https://fixture.test/' } };
            }
            if (method === 'Page.getLayoutMetrics') {
                return { cssLayoutViewport: { clientWidth: 980, clientHeight: 1688 } };
            }
            return {};
        },
        on: () => { },
        off: () => { },
    }, 414, 713, null), /css layout viewport 980×1688 != logical 414×713/);
    await assert_1.default.rejects(() => (0, device_emulation_1.readChromeViewport)({
        send: async () => ({}),
    }), /did not return cssLayoutViewport/);
    assert_1.default.ok((0, device_emulation_1.viewportMetricsClose)(414, 713, 415, 712));
    assert_1.default.ok(!(0, device_emulation_1.viewportMetricsClose)(414, 713, 980, 1688));
    console.log('[unit] prove logical viewport uses css layout metrics ok');
}
function testBuildChromeArgsIncludesWebglSpoof() {
    const extensionPath = (0, ChromeRuntime_1.webglSpoofExtensionPath)();
    assert_1.default.ok(fs.existsSync(extensionPath), `extension must exist at ${extensionPath}`);
    const args = (0, ChromeRuntime_1.buildChromeArgs)(1280, 720);
    assert_1.default.ok(args.includes('--use-gl=angle'), 'ANGLE required for HW-or-software path');
    assert_1.default.ok(args.includes('--enable-webgl'), 'webgl must be enabled');
    assert_1.default.ok(args.includes('--ignore-gpu-blocklist'), 'gpu blocklist bypass required');
    assert_1.default.ok(args.includes('--enable-unsafe-swiftshader'), 'software fallback must be allowed');
    assert_1.default.ok(!args.includes('--use-gl=swiftshader'), 'must not force swiftshader (blocks real GPU)');
    assert_1.default.ok(!args.includes('--use-angle=swiftshader'), 'must not force angle=swiftshader (blocks real GPU)');
    assert_1.default.ok(args.some((a) => a.startsWith('--load-extension=') && a.includes('webgl-spoof')), 'load-extension webgl-spoof required');
    assert_1.default.ok(args.some((a) => a.includes('DisableLoadExtensionCommandLineSwitch')), 'Chrome ≥137 load-extension feature flag required');
    assert_1.default.ok(args.includes('--disable-background-timer-throttling'), '§5.3.4 frame clock must not be background-throttled');
    assert_1.default.ok(args.includes('--disable-renderer-backgrounding'), '§5.3.4 renderer must not be backgrounded');
    assert_1.default.ok(args.includes('--disable-backgrounding-occluded-windows'), '§5.3.4 occluded window must not be backgrounded');
    // Product path must not gate on SPECULUM_GL* env.
    process.env['SPECULUM_GL_FALLBACK'] = '0';
    const stillOn = (0, ChromeRuntime_1.buildChromeArgs)(800, 600);
    assert_1.default.ok(stillOn.includes('--enable-webgl'), 'GL must stay on without env knobs');
    delete process.env['SPECULUM_GL_FALLBACK'];
    console.log('[unit] buildChromeArgs webgl spoof ok');
}
function testKitStealthInitSource() {
    const phone = (0, device_kits_1.resolveDeviceKit)({ deviceCategory: 'phone' });
    const phoneSrc = (0, device_kits_1.kitStealthInitSource)({
        kit: phone,
        userAgent: phone.buildUserAgent('120.0.0.0'),
    });
    assert_1.default.ok(phoneSrc.includes('Adreno'), 'phone WebGL must claim Adreno');
    assert_1.default.ok(phoneSrc.includes('WebKit WebGL'), 'phone masked RENDERER');
    assert_1.default.ok(phoneSrc.includes('0x1F00') || phoneSrc.includes('GL_VENDOR'), 'phone must spoof VENDOR');
    assert_1.default.ok(!phoneSrc.includes('Mesa/X.org'), 'phone must not claim Mesa/X.org');
    assert_1.default.ok(phoneSrc.includes('Linux armv8l'), 'phone platform in init');
    assert_1.default.ok(phoneSrc.includes('Android 13'), 'phone UA in worker wrap');
    assert_1.default.ok(phoneSrc.includes('importScripts'), 'worker wrap must use importScripts');
    assert_1.default.ok(phoneSrc.includes('spoof(self.navigator)'), 'worker must spoof live navigator');
    assert_1.default.ok(phoneSrc.includes('JSON.stringify(platform)'), 'worker preamble must quote platform');
    assert_1.default.ok(phoneSrc.includes('JSON.stringify(ua)'), 'worker preamble must quote ua');
    assert_1.default.ok(phoneSrc.includes('window.Worker'), 'Worker wrap');
    assert_1.default.ok(!phoneSrc.includes('Direct3D'), 'never D3D11');
    const pc = (0, device_kits_1.resolveDeviceKit)({ deviceCategory: 'pc' });
    const pcSrc = (0, device_kits_1.kitStealthInitSource)({
        kit: pc,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    assert_1.default.ok(pcSrc.includes('Intel') || pcSrc.includes('Mesa Intel'), 'pc WebGL Linux GPU story');
    assert_1.default.ok(pcSrc.includes('WebKit WebGL'), 'pc masked RENDERER');
    assert_1.default.ok(!pcSrc.includes('Mesa/X.org'), 'pc never Mesa/X.org');
    assert_1.default.ok(pcSrc.includes('Linux x86_64'), 'pc platform');
    assert_1.default.ok(!pcSrc.includes('Direct3D'), 'pc never D3D11/Windows');
    const extJs = fs.readFileSync(require('path').join((0, ChromeRuntime_1.webglSpoofExtensionPath)(), 'content.js'), 'utf8');
    assert_1.default.ok(extJs.includes('WebKit WebGL'), 'extension masked RENDERER');
    assert_1.default.ok(extJs.includes('0x1F00') || extJs.includes('GL_VENDOR'), 'extension spoofs VENDOR');
    assert_1.default.ok(!extJs.includes('Mesa/X.org'), 'extension never Mesa/X.org');
    const nav = (0, device_kits_1.kitNavigatorSpoofSource)({
        kit: phone,
        userAgent: phone.buildUserAgent('120.0.0.0'),
    });
    assert_1.default.ok(nav.includes('hardwareConcurrency'), 'nav spoof cores');
    assert_1.default.ok(nav.includes('Linux armv8l'), 'nav spoof platform');
    assert_1.default.ok(!nav.includes('window.Worker'), 'nav spoof must not wrap Worker ctor');
    assert_1.default.ok(nav.includes('0x1F00') || nav.includes('GL_VENDOR'), 'worker-realm source must spoof WebGL VENDOR');
    assert_1.default.ok(nav.includes('Adreno'), 'worker-realm WebGL must claim Adreno for phone');
    assert_1.default.ok(nav.includes('WebKit WebGL'), 'worker-realm masked RENDERER');
    assert_1.default.ok(!nav.includes('Mesa/X.org'), 'worker-realm must not claim Mesa/X.org');
    console.log('[unit] kitStealthInitSource ok');
}
async function testWorkerTargetStealthAutoAttach() {
    assert_1.default.ok((0, worker_target_stealth_1.isWorkerLikeTargetType)('worker'));
    assert_1.default.ok((0, worker_target_stealth_1.isWorkerLikeTargetType)('shared_worker'));
    assert_1.default.ok((0, worker_target_stealth_1.isWorkerLikeTargetType)('service_worker'));
    assert_1.default.ok(!(0, worker_target_stealth_1.isWorkerLikeTargetType)('page'));
    assert_1.default.ok(!(0, worker_target_stealth_1.isWorkerLikeTargetType)('iframe'));
    const calls = [];
    const handlers = new Map();
    const cdp = {
        send: async (method, params) => {
            calls.push({ method, params });
            if (method === 'Target.getTargets')
                return { targetInfos: [] };
            return {};
        },
        on: (event, fn) => {
            handlers.set(event, fn);
        },
        off: (event) => {
            handlers.delete(event);
        },
    };
    const phone = (0, device_kits_1.resolveDeviceKit)({ deviceCategory: 'phone' });
    const source = (0, device_kits_1.kitNavigatorSpoofSource)({
        kit: phone,
        userAgent: phone.buildUserAgent('120.0.0.0'),
    });
    const handle = await (0, worker_target_stealth_1.ensureWorkerTargetStealth)({
        pageCdp: cdp,
        source,
    });
    assert_1.default.ok(calls.some((c) => c.method === 'Target.setAutoAttach'
        && c.params
            .autoAttach === true
        && c.params.waitForDebuggerOnStart === true
        && c.params.flatten === false), 'must autoAttach workers with waitForDebugger, flatten false');
    assert_1.default.ok(handlers.has('Target.attachedToTarget'), 'must listen for attachedToTarget');
    const onAttached = handlers.get('Target.attachedToTarget');
    await onAttached({
        sessionId: 'sess-worker-1',
        waitingForDebugger: true,
        targetInfo: { type: 'service_worker', url: 'https://example.invalid/sw.js' },
    });
    const sent = calls.filter((c) => c.method === 'Target.sendMessageToTarget');
    assert_1.default.ok(sent.length >= 2, 'must evaluate + resume on worker target');
    const payloads = sent.map((c) => JSON.parse(c.params.message));
    assert_1.default.ok(payloads.some((p) => p.method === 'Runtime.evaluate' && String(p.params.expression).includes('hardwareConcurrency')), 'must inject navigator spoof into worker session');
    assert_1.default.ok(payloads.some((p) => p.method === 'Runtime.runIfWaitingForDebugger'), 'must resume paused worker target');
    // Non-worker paused target must still resume (never hang iframes).
    calls.length = 0;
    await onAttached({
        sessionId: 'sess-other',
        waitingForDebugger: true,
        targetInfo: { type: 'iframe', url: 'https://example.invalid/' },
    });
    const other = calls.filter((c) => c.method === 'Target.sendMessageToTarget');
    assert_1.default.ok(other.length >= 1, 'non-worker must resume');
    assert_1.default.ok(!other.some((c) => JSON.parse(c.params.message).method === 'Runtime.evaluate'), 'must not inject kit into non-worker targets');
    handle.dispose();
    console.log('[unit] worker target stealth autoAttach ok');
}
async function testScreencastRestartThrowsAfterStop() {
    const { Screencast } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Screencast')));
    const cdp = {
        on: () => { },
        off: () => { },
        send: async () => ({}),
    };
    const sc = await Screencast.start(cdp, 100, 100, () => { });
    await sc.stop();
    await assert_1.default.rejects(() => sc.restart(200, 200, () => { }), /restart after stop/);
    console.log('[unit] screencast restart throws after stop ok');
}
function testLaunchEnvironmentIsRequired() {
    assert_1.default.throws(() => (0, mappers_1.toLaunchOptions)({ width: 800, height: 600 }), /ViewportPolicy bounds|locale is required/);
    assert_1.default.throws(() => (0, mappers_1.toLaunchOptions)({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 4096,
        displayHeight: 2160,
    }), /locale is required/);
    const options = (0, mappers_1.toLaunchOptions)({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 2048,
        displayHeight: 1080,
        locale: 'pt-BR',
        language: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        colorScheme: 'light',
        geolocation: {
            latitude: -23.55,
            longitude: -46.63,
            accuracy: 10,
        },
    });
    assert_1.default.strictEqual(options.locale, 'pt-BR');
    assert_1.default.strictEqual(options.geolocation?.accuracy, 10);
    assert_1.default.deepStrictEqual(options.viewportPolicy, {
        minWidth: 100,
        minHeight: 100,
        maxWidth: 2048,
        maxHeight: 1080,
    });
    assert_1.default.strictEqual(options.screencastMaxEncodeScale, 2);
    assert_1.default.strictEqual(options.mirrorMode, 'videoStreaming');
    assert_1.default.strictEqual(options.pageProjectionDiffQueueCapacity, 8192);
    const scaled = (0, mappers_1.toLaunchOptions)({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 2048,
        displayHeight: 1080,
        locale: 'en-US',
        language: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        screencastMaxEncodeScale: 1,
    });
    assert_1.default.strictEqual(scaled.screencastMaxEncodeScale, 1);
    assert_1.default.strictEqual(scaled.mirrorMode, 'videoStreaming');
    const dom = (0, mappers_1.toLaunchOptions)({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 2048,
        displayHeight: 1080,
        locale: 'en-US',
        language: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        mirrorMode: 'pageProjection',
        page_projection_diff_queue_capacity: 4096,
    });
    assert_1.default.strictEqual(dom.mirrorMode, 'pageProjection');
    assert_1.default.strictEqual(dom.pageProjectionDiffQueueCapacity, 4096);
    console.log('[unit] launch environment ok');
}
function testScreencastEncodeSize() {
    const cssOnly = (0, screencast_encode_1.computeScreencastEncodeSize)({
        cssWidth: 1280,
        cssHeight: 720,
        deviceScaleFactor: 2,
        displayWidth: 4096,
        displayHeight: 2160,
        maxEncodeScale: 1,
    });
    assert_1.default.strictEqual(cssOnly.scale, 1);
    assert_1.default.strictEqual(cssOnly.width, 1280);
    assert_1.default.strictEqual(cssOnly.height, 720);
    const retina = (0, screencast_encode_1.computeScreencastEncodeSize)({
        cssWidth: 1280,
        cssHeight: 720,
        deviceScaleFactor: 2,
        displayWidth: 4096,
        displayHeight: 2160,
        maxEncodeScale: 2,
    });
    assert_1.default.strictEqual(retina.scale, 2);
    assert_1.default.strictEqual(retina.width, 2560);
    assert_1.default.strictEqual(retina.height, 1440);
    const dprCapped = (0, screencast_encode_1.computeScreencastEncodeSize)({
        cssWidth: 1280,
        cssHeight: 720,
        deviceScaleFactor: 3,
        displayWidth: 4096,
        displayHeight: 2160,
        maxEncodeScale: 2,
    });
    assert_1.default.strictEqual(dprCapped.scale, 2);
    assert_1.default.strictEqual(dprCapped.width, 2560);
    const xvfbCap = (0, screencast_encode_1.computeScreencastEncodeSize)({
        cssWidth: 1920,
        cssHeight: 1080,
        deviceScaleFactor: 2,
        displayWidth: 2560,
        displayHeight: 1440,
        maxEncodeScale: 2,
    });
    assert_1.default.ok(xvfbCap.scale < 2);
    assert_1.default.strictEqual(xvfbCap.width, 2560);
    assert_1.default.strictEqual(xvfbCap.height, 1440);
    console.log('[unit] screencast encode size ok');
}
async function testScreencastAcceptsCssOrEncodeJpeg() {
    const { Screencast } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Screencast')));
    const { readJpegDimensions } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/jpeg-geometry')));
    // Minimal 2×2 JPEG (SOF0) — write a tiny buffer with known dims via canvas-less fixture.
    // Build SOF0 manually: FF D8 … FF C0 … height/width …
    function jpegWithSize(width, height) {
        // Minimal valid-ish JPEG for readJpegDimensions (SOF0 only path).
        const sof = Buffer.alloc(19);
        sof[0] = 0xff;
        sof[1] = 0xc0;
        sof.writeUInt16BE(17, 2); // segment length
        sof[4] = 8; // precision
        sof.writeUInt16BE(height, 5);
        sof.writeUInt16BE(width, 7);
        return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
    }
    const cdp = {
        on: () => { },
        off: () => { },
        send: async () => ({}),
    };
    const sc = await Screencast.start(cdp, 2560, 1440, () => { }, 1280, 720);
    assert_1.default.deepStrictEqual(readJpegDimensions(jpegWithSize(1280, 720)), { width: 1280, height: 720 });
    assert_1.default.strictEqual(sc._jpegMatchesExpected(jpegWithSize(1280, 720)), true, 'CSS-sized frames must pass');
    assert_1.default.strictEqual(sc._jpegMatchesExpected(jpegWithSize(2560, 1440)), true, 'encode-sized frames must pass');
    assert_1.default.strictEqual(sc._jpegMatchesExpected(jpegWithSize(800, 600)), false, 'stale size must drop');
    await sc.stop();
    console.log('[unit] screencast accepts css or encode jpeg ok');
}
function testTouchEmulationParams() {
    assert_1.default.deepStrictEqual((0, device_emulation_1.touchEmulationParams)({ touch: false, mobile: false, maxTouchPoints: 0 }), { enabled: false });
    // Hybrid desktop (Galaxy Book / Surface): touch capable but mouse-primary —
    // must NOT enable CDP touch emulation or :hover dies.
    assert_1.default.deepStrictEqual((0, device_emulation_1.touchEmulationParams)({ touch: true, mobile: false, maxTouchPoints: 5 }), { enabled: false });
    assert_1.default.deepStrictEqual((0, device_emulation_1.touchEmulationParams)({ touch: true, mobile: true, maxTouchPoints: 5 }), { enabled: true, maxTouchPoints: 5 });
    assert_1.default.throws(() => (0, device_emulation_1.touchEmulationParams)({ touch: true, mobile: true, maxTouchPoints: 0 }), /between 1 and 16/);
    // Hybrid desktop: touch capability must NOT suppress mouse input.
    assert_1.default.strictEqual((0, device_emulation_1.isInputTouchPrimary)({ mobile: false }), false);
    assert_1.default.strictEqual((0, device_emulation_1.isInputTouchPrimary)({ mobile: true }), true);
    assert_1.default.strictEqual((0, device_emulation_1.isInputTouchPrimary)(null), false);
    console.log('[unit] touch emulation params ok');
}
function applyContextClose(bridge, args, session) {
    if (!(0, contextCrash_1.shouldEmitContextCrash)(args))
        return;
    session.open = false;
    bridge.onCrash({
        errorCode: 'browser_closed',
        message: 'Chrome context closed unexpectedly',
        phase: 'runtime',
    });
}
function testStopDoesNotEnqueueCrash() {
    const bridge = new EventBridge_1.EventBridge('s1');
    const session = { open: true };
    // stop/teardown: bump epoch + suppress before close
    applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 0);
    assert_1.default.strictEqual(session.open, true, 'suppressed/stale close must not clear open');
    console.log('[unit] stop_does_not_enqueue_crash ok');
}
function testUnexpectedContextCloseEnqueuesCrash() {
    const bridge = new EventBridge_1.EventBridge('s2');
    const session = { open: true };
    applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 1);
    assert_1.default.strictEqual(session.open, false);
    console.log('[unit] unexpected_context_close_enqueues_crash ok');
}
function testRecreateKeepsOpenAcrossStaleClose() {
    const bridge = new EventBridge_1.EventBridge('s4');
    const session = { open: true };
    // Intentional teardown: invalidate epoch + suppress before old context close
    applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 0);
    assert_1.default.strictEqual(session.open, true);
    // bind new context (epoch 3), session marked open again
    session.open = true;
    // deferred stale close from old context after new bind
    applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 3, suppress: false }, session);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 0);
    assert_1.default.strictEqual(session.open, true);
    // real crash on current context
    applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 1);
    assert_1.default.strictEqual(session.open, false);
    console.log('[unit] stale_context_close_epoch ok');
}
async function testStopKeepsBridgeQueuesOpen() {
    const bridge = new EventBridge_1.EventBridge('s3');
    bridge.onVideoFrame(new Uint8Array([1, 2, 3]));
    // stop() must not call bridge.close — queues stay open for Watch*
    assert_1.default.strictEqual(bridge.video.isClosed, false);
    const frame = await bridge.video.read();
    assert_1.default.ok(frame);
    assert_1.default.strictEqual(frame.length, 3);
    const pending = bridge.video.read();
    const raced = await Promise.race([
        pending.then(() => 'read'),
        new Promise((r) => setTimeout(() => r('timeout'), 40)),
    ]);
    assert_1.default.strictEqual(raced, 'timeout', 'read must block while bridge is open and empty');
    bridge.close();
    const afterClose = await pending;
    assert_1.default.strictEqual(afterClose, null, 'only bridge.close() ends Watch* reads with null');
    assert_1.default.strictEqual(bridge.video.isClosed, true);
    console.log('[unit] stop_keeps_bridge_queues_open ok');
}
function testBenignBrowserRaceNarrow() {
    assert_1.default.strictEqual((0, browserRace_1.isBenignBrowserRace)(new Error('Frame was detached')), true);
    assert_1.default.strictEqual((0, browserRace_1.isBenignBrowserRace)(new Error('Target closed')), true);
    assert_1.default.strictEqual((0, browserRace_1.isBenignBrowserRace)(new Error('Protocol error (Runtime.callFunctionOn)')), false);
    assert_1.default.strictEqual((0, browserRace_1.isBenignBrowserRace)(new Error('Session closed')), false);
    assert_1.default.strictEqual((0, browserRace_1.isBenignBrowserRace)(new Error('Target page, context or browser has been closed')), true);
    console.log('[unit] benign browser race narrow ok');
}
async function testAbortDoesNotStealQueuedCrash() {
    const q = new DropOldestQueue_1.DropOldestQueue(4);
    q.tryWrite({ errorCode: 'browser_closed' });
    const ac = new AbortController();
    ac.abort();
    const stolen = await q.read(ac.signal);
    assert_1.default.strictEqual(stolen, null, 'aborted read must not dequeue');
    assert_1.default.strictEqual(q.pendingCount, 1, 'crash must remain for WatchCrash reopen');
    const next = await q.read();
    assert_1.default.deepStrictEqual(next, { errorCode: 'browser_closed' });
    console.log('[unit] abort_does_not_steal_queued_crash ok');
}
function testDropOldestQueueTracksDroppedCount() {
    const q = new DropOldestQueue_1.DropOldestQueue(2);
    q.tryWrite(1);
    q.tryWrite(2);
    q.tryWrite(3);
    q.tryWrite(4);
    assert_1.default.strictEqual(q.pendingCount, 2);
    assert_1.default.strictEqual(q.droppedCount, 2);
    console.log('[unit] drop_oldest_queue_tracks_dropped_count ok');
}
function testDropAllOnOverflowForSequencedDiffs() {
    const q = new DropOldestQueue_1.DropOldestQueue(2);
    q.tryWriteDropAllOnOverflow({ sequence: 1 });
    q.tryWriteDropAllOnOverflow({ sequence: 2 });
    const overflow = q.tryWriteDropAllOnOverflow({ sequence: 3 });
    assert_1.default.strictEqual(q.pendingCount, 1);
    assert_1.default.strictEqual(q.droppedCount, 2);
    assert_1.default.strictEqual(overflow.dropped, 2);
    assert_1.default.strictEqual(overflow.lowestSequence, 1);
    assert_1.default.strictEqual(overflow.highestSequence, 2);
    console.log('[unit] drop_all_on_overflow_for_sequenced_diffs ok');
}
async function testTryWriteFrontPreservesFifoAsync() {
    const q = new DropOldestQueue_1.DropOldestQueue(4);
    q.tryWrite(2);
    q.tryWrite(3);
    assert_1.default.strictEqual(q.tryWriteFront(1), true);
    assert_1.default.strictEqual(await q.read(), 1);
    assert_1.default.strictEqual(await q.read(), 2);
    assert_1.default.strictEqual(await q.read(), 3);
    console.log('[unit] try_write_front_preserves_fifo ok');
}
async function testTryWriteFrontRejectsWhenFull() {
    const q = new DropOldestQueue_1.DropOldestQueue(2);
    q.tryWrite(1);
    q.tryWrite(2);
    assert_1.default.strictEqual(q.tryWriteFront(0), false);
    assert_1.default.strictEqual(q.pendingCount, 2);
    assert_1.default.strictEqual(await q.read(), 1);
    console.log('[unit] try_write_front_rejects_when_full ok');
}
async function testPumpQueueAwaitsDrainWithoutSkipping() {
    const { EventEmitter } = await Promise.resolve().then(() => __importStar(require('events')));
    const { pumpQueue } = await Promise.resolve().then(() => __importStar(require('./grpc/pumpQueue')));
    const q = new DropOldestQueue_1.DropOldestQueue(8);
    for (let i = 1; i <= 5; i++)
        q.tryWrite({ sequence: i });
    q.close();
    const written = [];
    let writes = 0;
    let drainWaits = 0;
    const call = Object.assign(new EventEmitter(), {
        cancelled: false,
        write(chunk) {
            writes += 1;
            const seq = chunk.sequence;
            written.push(seq);
            // Seq 2 congests the buffer — chunk is still accepted; drain before next.
            if (seq === 2) {
                queueMicrotask(() => {
                    drainWaits += 1;
                    call.emit('drain');
                });
                return false;
            }
            return true;
        },
    });
    const ac = new AbortController();
    await pumpQueue(q, call, (item) => item, ac.signal);
    assert_1.default.deepStrictEqual(written, [1, 2, 3, 4, 5], 'each seq written exactly once');
    assert_1.default.strictEqual(writes, 5, 'must not rewrite after drain');
    assert_1.default.ok(drainWaits >= 1, 'must await drain after false write');
    console.log('[unit] pump_queue_awaits_drain_without_skipping ok');
}
async function testPumpQueueAbortRequeuesFront() {
    const { EventEmitter } = await Promise.resolve().then(() => __importStar(require('events')));
    const { pumpQueue } = await Promise.resolve().then(() => __importStar(require('./grpc/pumpQueue')));
    const q = new DropOldestQueue_1.DropOldestQueue(8);
    q.tryWrite({ sequence: 10 });
    q.tryWrite({ sequence: 11 });
    // Abort before write — dequeued item must return to the front.
    const ac = new AbortController();
    ac.abort();
    const call = Object.assign(new EventEmitter(), {
        cancelled: true,
        write(_chunk) {
            throw new Error('write must not run when already aborted');
        },
    });
    await pumpQueue(q, call, (item) => item, ac.signal);
    assert_1.default.deepStrictEqual(await q.read(), { sequence: 10 }, 'aborted item restored at front');
    assert_1.default.deepStrictEqual(await q.read(), { sequence: 11 });
    console.log('[unit] pump_queue_abort_requeues_front ok');
}
async function testPumpQueueAbortAfterWriteDoesNotRequeue() {
    const { EventEmitter } = await Promise.resolve().then(() => __importStar(require('events')));
    const { pumpQueue } = await Promise.resolve().then(() => __importStar(require('./grpc/pumpQueue')));
    const q = new DropOldestQueue_1.DropOldestQueue(8);
    q.tryWrite({ sequence: 10 });
    q.tryWrite({ sequence: 11 });
    const ac = new AbortController();
    const lost = [];
    const call = Object.assign(new EventEmitter(), {
        cancelled: false,
        write(_chunk) {
            // write()===false still accepted the chunk — abort must not requeue it.
            ac.abort();
            call.cancelled = true;
            return false;
        },
    });
    await pumpQueue(q, call, (item) => item, ac.signal, {
        onInflightLost: (item) => lost.push(item),
    });
    assert_1.default.deepStrictEqual(lost, [{ sequence: 10 }]);
    assert_1.default.deepStrictEqual(await q.read(), { sequence: 11 }, 'accepted chunk must not requeue');
    console.log('[unit] pump_queue_abort_after_write_does_not_requeue ok');
}
async function testEventBridgeQueueDroppedLifecycle() {
    const bridge = new EventBridge_1.EventBridge('s-drop');
    const body = new Uint8Array([1]);
    const cap = bridge.dom.maxCapacity;
    // Fill to capacity then one more → DropAll + lifecycle queue_dropped.
    for (let i = 0; i < cap; i++) {
        bridge.onPageProjectionDiff({
            sequence: i + 1,
            generation: 1,
            plane: 'dom',
            operation: 'patch',
            timestampMs: i,
            body,
        });
    }
    bridge.onPageProjectionDiff({
        sequence: 2000,
        generation: 1,
        plane: 'cssom',
        operation: 'install',
        timestampMs: 999,
        body,
    });
    const ev = await bridge.pageProjectionLifecycle.read();
    assert_1.default.ok(ev);
    assert_1.default.strictEqual(ev.kind, 'queue_dropped');
    assert_1.default.strictEqual(ev.reason, 'sidecar_bridge');
    assert_1.default.strictEqual(ev.url, 'cssom');
    assert_1.default.strictEqual(ev.diffKind, 'install');
    assert_1.default.strictEqual(ev.sequence, 2000);
    assert_1.default.strictEqual(ev.toGeneration, 1);
    assert_1.default.ok((ev.droppedCount ?? 0) >= cap);
    assert_1.default.strictEqual(ev.capacity, cap);
    assert_1.default.strictEqual(ev.lowestDroppedSequence, 1);
    assert_1.default.strictEqual(ev.highestDroppedSequence, cap);
    assert_1.default.strictEqual(bridge.dom.pendingCount, 1);
    bridge.close();
    console.log('[unit] event_bridge_queue_dropped_lifecycle ok');
}
async function testPermissionClearRespectsEpoch() {
    const bridge = new EventBridge_1.EventBridge('s-perm');
    const sinkA = () => { };
    const sinkB = () => { };
    const epochA = bridge.setPermissionSink(sinkA);
    const epochB = bridge.setPermissionSink(sinkB);
    // Waiter created under sink B must survive old Control A's cleanup.
    const pending = bridge.onCameraPermissionRequested();
    bridge.clearPermissionSink(sinkA, epochA);
    let settled = false;
    void pending.then(() => {
        settled = true;
    });
    await new Promise((r) => setImmediate(r));
    assert_1.default.strictEqual(settled, false, 'waiter from epoch B must not be denied by epoch A clear');
    bridge.resolvePermission(1, true);
    assert_1.default.strictEqual(await pending, 'allow');
    bridge.clearPermissionSink(sinkB, epochB);
    console.log('[unit] permission_clear_respects_epoch ok');
}
async function testInputFireAndForgetAndMoveCoalesce() {
    const ops = [];
    let resolveSlow = null;
    const slow = new Promise((r) => { resolveSlow = r; });
    let moveCount = 0;
    let lastMoveX = 0;
    let lastMoveY = 0;
    const page = {
        mouse: {
            move: async () => { throw new Error('page.mouse must not be used'); },
            down: async () => { throw new Error('page.mouse must not be used'); },
            up: async () => { throw new Error('page.mouse must not be used'); },
            wheel: async () => { throw new Error('page.mouse must not be used'); },
        },
        keyboard: {
            down: async (_k) => { ops.push('kdown'); },
            up: async (_k) => { ops.push('kup'); },
            type: async () => { throw new Error('keyboard.type must not be used'); },
        },
        goBack: () => Promise.reject(new Error('should not block')),
        goForward: () => Promise.reject(new Error('should not block')),
        evaluate: async () => null,
    };
    const cdp = {
        send: async (method, params) => {
            if (method !== 'Input.dispatchMouseEvent')
                return;
            if (params?.type === 'mouseMoved') {
                ops.push('move');
                moveCount++;
                lastMoveX = params.x ?? 0;
                lastMoveY = params.y ?? 0;
                return;
            }
            if (params?.type === 'mousePressed') {
                ops.push('down');
                await slow;
                return;
            }
            if (params?.type === 'mouseReleased') {
                ops.push('up');
            }
        },
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const { PatchrightInputBackend } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/input/PatchrightInputBackend')));
    const input = new InputController(page, new PatchrightInputBackend(page, cdp));
    input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
    input.enqueue({ type: 'mouseup', x: 1, y: 2, button: 0 });
    input.enqueue({ type: 'keydown', key: 'a' });
    for (let i = 0; i < 8; i++)
        await Promise.resolve();
    assert_1.default.ok(ops.includes('down'), 'mousedown must have started');
    assert_1.default.ok(!ops.includes('up'), 'mouseup must be held behind slow mousedown');
    input.enqueue({ type: 'mousemove', x: 10, y: 10 });
    input.enqueue({ type: 'mousemove', x: 20, y: 20 });
    input.enqueue({ type: 'mousemove', x: 30, y: 30 });
    const movesBeforeFlush = moveCount;
    await new Promise((r) => setImmediate(r));
    assert_1.default.strictEqual(moveCount, movesBeforeFlush, 'coalesced move must not flush while chain is held');
    input.enqueue({ type: 'goback' });
    input.enqueue({ type: 'goforward' });
    resolveSlow();
    for (let i = 0; i < 30; i++)
        await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 30; i++)
        await Promise.resolve();
    assert_1.default.ok(ops.indexOf('down') < ops.indexOf('up'), 'down before up');
    assert_1.default.ok(ops.indexOf('up') < ops.indexOf('kdown'), 'up before keydown');
    assert_1.default.ok(moveCount > movesBeforeFlush, 'coalesced move must flush after chain drains');
    assert_1.default.strictEqual(lastMoveX, 30, 'coalesced to last move x=30');
    assert_1.default.strictEqual(lastMoveY, 30, 'coalesced to last move y=30');
    assert_1.default.strictEqual(input.pendingCount, 0, 'pendingCount must drain after completion');
    console.log('[unit] input admit-sync + chain + move coalesce ok');
}
async function testInputKeyDefsIncludeEditingKeys() {
    const downs = [];
    const ups = [];
    const inserts = [];
    const page = {
        mouse: { move: async () => { }, down: async () => { }, up: async () => { }, wheel: async () => { } },
        keyboard: {
            down: async (k) => { downs.push(k); },
            up: async (k) => { ups.push(k); },
            type: async () => { throw new Error('keyboard.type must not be used'); },
        },
        goBack: () => Promise.resolve(null),
        goForward: () => Promise.resolve(null),
        evaluate: async () => null,
    };
    const cdp = {
        send: async (method, params) => {
            if (method === 'Input.insertText' && params?.text)
                inserts.push(params.text);
        },
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const { PatchrightInputBackend } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/input/PatchrightInputBackend')));
    const input = new InputController(page, new PatchrightInputBackend(page, cdp));
    input.enqueue({ type: 'keydown', key: 'Backspace' });
    input.enqueue({ type: 'keyup', key: 'Backspace' });
    input.enqueue({ type: 'keydown', key: 'Delete' });
    input.enqueue({ type: 'keydown', key: 'ArrowLeft' });
    input.enqueue({ type: 'keydown', key: 'Home' });
    input.enqueue({ type: 'keydown', key: 'Enter' });
    input.enqueue({ type: 'keydown', key: 'ã' });
    input.enqueue({ type: 'text', text: 'olá' });
    await new Promise((r) => setTimeout(r, 30));
    assert_1.default.ok(downs.includes('Backspace'), 'Backspace routed to keyboard.down');
    assert_1.default.ok(ups.includes('Backspace'), 'Backspace keyup routed to keyboard.up');
    assert_1.default.ok(downs.includes('Delete'), 'Delete routed');
    assert_1.default.ok(downs.includes('ArrowLeft'), 'ArrowLeft routed');
    assert_1.default.ok(downs.includes('Home'), 'Home routed');
    assert_1.default.ok(downs.includes('Enter'), 'Enter routed');
    assert_1.default.ok(inserts.includes('ã'), 'non-ASCII keydown via Input.insertText');
    assert_1.default.ok(inserts.includes('olá'), 'text via Input.insertText');
    const upsBefore = ups.length;
    input.enqueue({ type: 'keyup', key: 'ã' });
    await new Promise((r) => setTimeout(r, 20));
    assert_1.default.strictEqual(ups.length, upsBefore, 'keyup of non-ASCII must be ignored');
    console.log('[unit] input key routing (keyboard.down/up + insertText) ok');
}
async function testTouchMoveCoalesceAndStormWrites() {
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const { TouchMoveCoalescer } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/input/TouchMoveCoalescer')));
    let flushes = 0;
    let lastLen = 0;
    const coalescer = new TouchMoveCoalescer((pts) => {
        flushes++;
        lastLen = pts.length;
    });
    coalescer.queue([{ id: 1, x: 1, y: 1 }]);
    coalescer.queue([{ id: 1, x: 2, y: 2 }, { id: 2, x: 3, y: 3 }]);
    coalescer.queue([{ id: 1, x: 9, y: 9 }]);
    await new Promise((r) => setImmediate(r));
    assert_1.default.strictEqual(flushes, 1, 'touchmove must coalesce to one flush per turn');
    assert_1.default.strictEqual(lastLen, 1, 'latest touchmove sample wins');
    const stolen = (() => {
        const c = new TouchMoveCoalescer(() => {
            throw new Error('cancelled flush must not run');
        });
        c.queue([{ id: 1, x: 1, y: 1 }]);
        const pending = c.takePending();
        assert_1.default.ok(pending && pending[0].x === 1);
        return pending;
    })();
    await new Promise((r) => setImmediate(r));
    assert_1.default.ok(stolen);
    let moves = 0;
    let downs = 0;
    let evaluates = 0;
    const page = {
        mouse: { move: async () => { }, down: async () => { }, up: async () => { }, wheel: async () => { } },
        keyboard: { down: async () => { }, up: async () => { }, type: async () => { } },
        goBack: () => Promise.resolve(null),
        goForward: () => Promise.resolve(null),
        evaluate: async () => {
            evaluates++;
            return null;
        },
    };
    const backend = {
        move: async () => {
            moves++;
        },
        down: async () => {
            downs++;
        },
        up: async () => { },
        wheel: async () => { },
        keyDown: async () => { },
        keyUp: async () => { },
        typeText: async () => { },
        touch: async () => { },
        dispose: async () => { },
    };
    const input = new InputController(page, backend);
    for (let i = 0; i < 200; i++) {
        input.enqueue({ type: 'mousemove', x: i, y: i });
    }
    input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
    assert_1.default.strictEqual(moves, 0, 'admit path must stay sync (no await on enqueue)');
    assert_1.default.strictEqual(downs, 0, 'admit path must not await inject');
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 40; i++)
        await Promise.resolve();
    assert_1.default.ok(moves <= 2, `move storm must coalesce (got ${moves} writes)`);
    assert_1.default.strictEqual(downs, 1, 'mousedown still injects once');
    assert_1.default.strictEqual(evaluates, 0, 'production hot path must not page.evaluate');
    console.log('[unit] touch coalesce + move-storm write bound ok');
}
async function testInputMousePressReleaseOrdered() {
    const order = [];
    let resolveDown = null;
    const slowDown = new Promise((r) => { resolveDown = r; });
    const page = {
        mouse: {
            move: async () => { throw new Error('page.mouse must not be used'); },
            down: async () => { throw new Error('page.mouse must not be used'); },
            up: async () => { throw new Error('page.mouse must not be used'); },
            wheel: async () => { },
        },
        keyboard: { down: async () => { }, up: async () => { }, type: async () => { } },
        goBack: () => Promise.resolve(null),
        goForward: () => Promise.resolve(null),
        evaluate: async () => null,
    };
    const cdp = {
        send: async (_method, params) => {
            if (params?.type === 'mousePressed') {
                order.push('down');
                await slowDown;
                return;
            }
            if (params?.type === 'mouseReleased')
                order.push('up');
        },
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const { PatchrightInputBackend } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/input/PatchrightInputBackend')));
    const input = new InputController(page, new PatchrightInputBackend(page, cdp));
    input.enqueue({ type: 'mousedown', x: 10, y: 10, button: 0 });
    input.enqueue({ type: 'mouseup', x: 10, y: 10, button: 0 });
    for (let i = 0; i < 8; i++)
        await Promise.resolve();
    assert_1.default.ok(order.includes('down'), 'mousedown must have started');
    assert_1.default.ok(!order.includes('up'), 'mouseup must be held until mousedown completes');
    resolveDown();
    await new Promise((r) => setTimeout(r, 40));
    assert_1.default.ok(order.indexOf('down') < order.indexOf('up'), 'down must precede up');
    console.log('[unit] input mouse press/release order ok');
}
async function testInputPendingCountIncludesChainDepth() {
    let resolveDown = null;
    const slowDown = new Promise((r) => { resolveDown = r; });
    const page = {
        mouse: { move: async () => { }, down: async () => { }, up: async () => { }, wheel: async () => { } },
        keyboard: { down: async () => { }, up: async () => { }, type: async () => { } },
        goBack: () => Promise.resolve(null),
        goForward: () => Promise.resolve(null),
        evaluate: async () => null,
    };
    const backend = {
        move: async () => { },
        down: async () => { await slowDown; },
        up: async () => { },
        wheel: async () => { },
        keyDown: async () => { },
        keyUp: async () => { },
        typeText: async () => { },
        touch: async () => { },
        dispose: async () => { },
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const input = new InputController(page, backend);
    input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
    input.enqueue({ type: 'mouseup', x: 1, y: 1, button: 0 });
    await Promise.resolve();
    assert_1.default.strictEqual(input.pendingCount, 2, 'pendingCount must include queued chain work');
    assert_1.default.strictEqual(input.chainDepth, 2, 'chainDepth must reflect queued inject operations');
    resolveDown();
    await new Promise((r) => setTimeout(r, 40));
    assert_1.default.strictEqual(input.pendingCount, 0, 'pendingCount must drain after inject completes');
    console.log('[unit] input pending count includes chain depth ok');
}
async function testTelemetryToggleOmission() {
    const registry = { list: () => [] };
    const empty = await (0, collectTelemetry_1.collectTelemetry)({}, registry);
    assert_1.default.deepStrictEqual(empty, {});
    const processOnly = await (0, collectTelemetry_1.collectTelemetry)({ includeProcess: true }, registry);
    assert_1.default.ok(processOnly.process);
    assert_1.default.strictEqual(processOnly.eventLoop, undefined);
    assert_1.default.strictEqual(processOnly.chrome, undefined);
    assert_1.default.strictEqual(processOnly.queues, undefined);
    assert_1.default.strictEqual(processOnly.sessions, undefined);
    const sectioned = await (0, collectTelemetry_1.collectTelemetry)({ includeChrome: true, includeQueues: true }, registry);
    assert_1.default.ok(sectioned.chrome);
    assert_1.default.ok(sectioned.queues);
    assert_1.default.strictEqual('totalJsHeapUsed' in sectioned.chrome, false);
    assert_1.default.strictEqual(sectioned.queues.inputDepth, 0);
    assert_1.default.strictEqual(sectioned.queues.inputChainDepth, 0);
    assert_1.default.strictEqual(sectioned.queues.droppedTotal, 0);
    console.log('[unit] telemetry toggles omit sections ok');
}
async function testTelemetryQueuesReportInputDepthAndDrops() {
    const bridge = new EventBridge_1.EventBridge('telemetry-session');
    bridge.video.tryWrite(new Uint8Array([1]));
    bridge.video.tryWrite(new Uint8Array([2]));
    bridge.video.tryWrite(new Uint8Array([3]));
    const registry = {
        list: () => [
            {
                bridge,
                session: {
                    sessionId: 'telemetry-session',
                    getStatus: async () => ({
                        isOpen: true,
                        tabCount: 1,
                        url: 'about:blank',
                        resizing: false,
                        width: 390,
                        height: 844,
                        displayWidth: 4096,
                        displayHeight: 2160,
                        chromeWidth: 390,
                        chromeHeight: 844,
                    }),
                    getTelemetrySnapshot: () => ({
                        inputPendingCount: 2,
                        inputChainDepth: 1,
                        displayAllocated: true,
                        displayWidth: 4096,
                        displayHeight: 2160,
                        logicalWidth: 390,
                        logicalHeight: 844,
                        chromeWidth: 390,
                        chromeHeight: 844,
                        inputBackend: 'os',
                        touchPrimary: true,
                        userDataDirPresent: true,
                    }),
                },
            },
        ],
    };
    const sample = await (0, collectTelemetry_1.collectTelemetry)({ includeQueues: true }, registry);
    assert_1.default.deepStrictEqual(sample.queues, {
        videoDepth: 2,
        audioDepth: 0,
        consoleDepth: 0,
        inputDepth: 2,
        inputChainDepth: 1,
        droppedTotal: 1,
    });
    console.log('[unit] telemetry queues report input depth and drops ok');
}
async function testTelemetryFaultStateSurvivesCrashConsumption() {
    const bridge = new EventBridge_1.EventBridge('faulted-session');
    bridge.onCrash({
        errorCode: 'browser_closed',
        message: 'Chrome context closed unexpectedly',
        phase: 'runtime',
    });
    const consumed = await bridge.crash.read();
    assert_1.default.ok(consumed);
    assert_1.default.strictEqual(bridge.crash.pendingCount, 0);
    const registry = {
        list: () => [{
                bridge,
                session: {
                    sessionId: 'faulted-session',
                    getStatus: async () => ({ isOpen: false, tabCount: 0 }),
                },
            }],
    };
    const telemetry = await (0, collectTelemetry_1.collectTelemetry)({ includeSessionsSummary: true, includeFaultedIds: true }, registry);
    assert_1.default.strictEqual(telemetry.sessions?.faulted, 1);
    assert_1.default.deepStrictEqual(telemetry.sessions?.faultedSessionIds, ['faulted-session']);
    console.log('[unit] telemetry fault state survives crash consumption ok');
}
async function testTelemetryAllocationsSummaryAndSessions() {
    const bridge = new EventBridge_1.EventBridge('alloc-session');
    const registry = {
        list: () => [{
                bridge,
                session: {
                    sessionId: 'alloc-session',
                    getStatus: async () => ({
                        isOpen: true,
                        tabCount: 1,
                        url: 'about:blank',
                        resizing: false,
                        width: 390,
                        height: 844,
                        displayWidth: 4096,
                        displayHeight: 2160,
                        chromeWidth: 390,
                        chromeHeight: 844,
                    }),
                    getTelemetrySnapshot: () => ({
                        displayAllocated: true,
                        displayWidth: 4096,
                        displayHeight: 2160,
                        logicalWidth: 390,
                        logicalHeight: 844,
                        chromeWidth: 390,
                        chromeHeight: 844,
                        inputBackend: 'os',
                        touchPrimary: false,
                        userDataDirPresent: true,
                    }),
                },
            }],
    };
    const summaryOnly = await (0, collectTelemetry_1.collectTelemetry)({ includeAllocationsSummary: true }, registry);
    assert_1.default.strictEqual(summaryOnly.allocations?.summary?.allocatedSessions, 1);
    assert_1.default.strictEqual(summaryOnly.allocations?.summary?.allocatedDisplayPixels, 4096 * 2160);
    assert_1.default.strictEqual(summaryOnly.allocations?.summary?.osInputSessions, 1);
    assert_1.default.strictEqual(summaryOnly.allocations?.sessions, undefined);
    const withSessions = await (0, collectTelemetry_1.collectTelemetry)({ includeAllocationsSummary: true, includeAllocationSessions: true }, registry);
    assert_1.default.strictEqual(withSessions.allocations?.sessions?.length, 1);
    assert_1.default.strictEqual(withSessions.allocations?.sessions?.[0]?.sessionId, 'alloc-session');
    assert_1.default.strictEqual(withSessions.allocations?.sessions?.[0]?.displayAllocated, true);
    assert_1.default.strictEqual(withSessions.allocations?.sessions?.[0]?.inputBackend, 'os');
    console.log('[unit] telemetry allocations summary and sessions ok');
}
function testLogicalToDeviceTransform() {
    const { createLogicalWindowTransform, mapLogicalToAbs } = require('./browser/patchright/input/logical-to-device');
    // 1:1 into logical window region (absMax = logical-1), not stretch-to-display.
    const t = createLogicalWindowTransform(414, 711);
    assert_1.default.strictEqual(t.logicalWidth, 414);
    assert_1.default.strictEqual(t.logicalHeight, 711);
    assert_1.default.strictEqual(t.absMaxX, 413);
    assert_1.default.strictEqual(t.absMaxY, 710);
    assert_1.default.deepStrictEqual(mapLogicalToAbs(t, 0, 0), { x: 0, y: 0 });
    assert_1.default.deepStrictEqual(mapLogicalToAbs(t, 414, 711), { x: 413, y: 710 });
    assert_1.default.deepStrictEqual(mapLogicalToAbs(t, 200, 350), { x: 200, y: 350 });
    assert_1.default.deepStrictEqual(mapLogicalToAbs(t, -10, 5000), { x: 0, y: 710 });
    // Must not stretch mid-canvas toward Xvfb capacity (4096×2160).
    assert_1.default.notDeepStrictEqual(mapLogicalToAbs(t, 207, 355), { x: 2048, y: 1080 });
    assert_1.default.throws(() => createLogicalWindowTransform(0, 100), /positive/);
    console.log('[unit] logical-to-device transform ok');
}
function testKeycodeResolve() {
    const { resolveKeyStroke, KEY } = require('./browser/patchright/input/keycodes');
    assert_1.default.strictEqual(resolveKeyStroke('Enter')?.code, KEY.ENTER);
    assert_1.default.strictEqual(resolveKeyStroke('a')?.code, KEY.A);
    assert_1.default.strictEqual(resolveKeyStroke('A')?.shift, true);
    assert_1.default.strictEqual(resolveKeyStroke(''), null);
    assert_1.default.strictEqual(resolveKeyStroke('Unobtanium'), null);
    console.log('[unit] keycode resolve ok');
}
function testXorgInputIsolationFlags() {
    const { buildXorgDummyConfigForTest } = require('./browser/patchright/Display');
    const hotplug = buildXorgDummyConfigForTest(1280, 720);
    assert_1.default.ok(hotplug.includes('Option "AutoAddDevices" "true"'), 'patchright path keeps AutoAdd');
    assert_1.default.ok(hotplug.includes('Option "AutoEnableDevices" "false"'), 'foreign devices not auto-enable');
    const bound = buildXorgDummyConfigForTest(1280, 720, {
        pointerEventPath: '/dev/input/event4',
        keyboardEventPath: '/dev/input/event6',
        touchEventPath: '/dev/input/event5',
        pointerName: 'speculum-ptr-test',
        keyboardName: 'speculum-kbd-test',
        touchName: 'speculum-mt-test',
    });
    assert_1.default.ok(bound.includes('Option "AutoAddDevices" "false"'), 'os path disables AutoAdd');
    assert_1.default.ok(bound.includes('Driver "evdev"'), 'os path binds evdev');
    assert_1.default.ok(bound.includes('Option "Device" "/dev/input/event4"'), 'pointer event bound');
    assert_1.default.ok(bound.includes('Option "Device" "/dev/input/event6"'), 'keyboard event bound');
    assert_1.default.ok(bound.includes('Option "Device" "/dev/input/event5"'), 'touch event bound');
    assert_1.default.ok(bound.includes('InputDevice "speculum-ptr-test" "CorePointer"'), 'pointer in layout');
    assert_1.default.ok(bound.includes('InputDevice "speculum-kbd-test" "CoreKeyboard"'), 'keyboard in layout');
    const ptrSection = bound
        .split(/Section "InputDevice"/)
        .find((s) => s.includes('Identifier "speculum-ptr-test"'));
    assert_1.default.ok(ptrSection && !ptrSection.includes('Mode" "Absolute"'), 'pointer is relative');
    assert_1.default.ok(ptrSection.includes('AccelerationScheme" "none"'), 'pointer acceleration disabled for software cursor');
    console.log('[unit] xorg input isolation flags ok');
}
/** Regression: koffi variadic ioctl(fd, req, arg) throws; fixed 3-arg prototype must not. */
function testIoctlKoffiPrototype() {
    if (process.platform !== 'linux') {
        console.log('[unit] ioctl koffi prototype skip (non-linux)');
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const libc = koffi.load('libc.so.6');
    const bad = libc.func('int ioctl(int fd, unsigned long request, ...)');
    assert_1.default.throws(() => bad(0, 0x5501, 0), (err) => err instanceof Error && /Missing value argument for variadic call/.test(err.message));
    const good = libc.func('int ioctl(int fd, unsigned long request, int arg)');
    const rc = good(0, 0x5501, 0);
    assert_1.default.strictEqual(typeof rc, 'number');
    console.log('[unit] ioctl koffi prototype ok');
}
/** frame-protocol.md §1.5 Stage 1 gate — H64 primitives: deterministic, input-sensitive, mod-2^64-correct. */
function testRowHashPrimitives() {
    assert_1.default.strictEqual((0, rowHash_1.h64Str)('div'), (0, rowHash_1.h64Str)('div'), 'h64Str must be deterministic');
    assert_1.default.notStrictEqual((0, rowHash_1.h64Str)('div'), (0, rowHash_1.h64Str)('span'), 'different strings must (almost certainly) hash differently');
    assert_1.default.notStrictEqual((0, rowHash_1.h64Str)(''), 0n, 'empty string must not hash to the identity element');
    assert_1.default.strictEqual((0, rowHash_1.h64Bytes)(new Uint8Array([1, 2, 3])), (0, rowHash_1.h64Bytes)(new Uint8Array([1, 2, 3])));
    assert_1.default.notStrictEqual((0, rowHash_1.h64Bytes)(new Uint8Array([1, 2, 3])), (0, rowHash_1.h64Bytes)(new Uint8Array([3, 2, 1])), 'byte order must matter');
    assert_1.default.strictEqual((0, rowHash_1.h64U32)(0), (0, rowHash_1.h64U32)(0));
    assert_1.default.notStrictEqual((0, rowHash_1.h64U32)(1), (0, rowHash_1.h64U32)(2));
    assert_1.default.notStrictEqual((0, rowHash_1.h64U32)(0x100), (0, rowHash_1.h64U32)(1), 'byte-shifted values must not collide');
    assert_1.default.notStrictEqual((0, rowHash_1.h64U32)(0xffffffff), (0, rowHash_1.h64U32)(0), 'top bit must be mixed in');
    // Tag-prefixed content hashes must not collide across field kinds for the same underlying text.
    assert_1.default.notStrictEqual((0, rowHash_1.hashName)('x'), (0, rowHash_1.hashValue)('x'), 'hashName/hashValue must not collide for equal text');
    assert_1.default.notStrictEqual((0, rowHash_1.hashName)('x'), (0, rowHash_1.hashAttr)('x', ''), 'hashName/hashAttr must not collide for equal text');
    assert_1.default.notStrictEqual((0, rowHash_1.hashAttr)('a', 'b'), (0, rowHash_1.hashAttr)('ab', ''), 'attr name/value separator must prevent splicing collisions');
    assert_1.default.notStrictEqual((0, rowHash_1.hashAttr)('a', 'b'), (0, rowHash_1.hashAttr)('a', 'bx'), 'attr value must be part of the hash');
    // mod 2^64 wraparound — subMod64 must invert addMod64 for any operand pair, including near the mask boundary.
    const MASK64 = 0xffffffffffffffffn;
    assert_1.default.strictEqual((0, rowHash_1.addMod64)(MASK64, 1n), 0n, 'addMod64 must wrap at 2^64');
    assert_1.default.strictEqual((0, rowHash_1.subMod64)(0n, 1n), MASK64, 'subMod64 must wrap negative results to unsigned mod 2^64');
    const a = (0, rowHash_1.h64Str)('alpha');
    const b = (0, rowHash_1.h64Str)('beta');
    assert_1.default.strictEqual((0, rowHash_1.subMod64)((0, rowHash_1.addMod64)(a, b), b), a, 'subMod64 must invert addMod64');
    // computeRowHash must be sensitive to every one of its five fields independently.
    const base = (0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Element, 1, 0, 0n);
    assert_1.default.notStrictEqual((0, rowHash_1.computeRowHash)(11, opcodes_1.NodeKind.Element, 1, 0, 0n), base, 'id must affect rowHash');
    assert_1.default.notStrictEqual((0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Text, 1, 0, 0n), base, 'kind must affect rowHash');
    assert_1.default.notStrictEqual((0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Element, 2, 0, 0n), base, 'parent must affect rowHash');
    assert_1.default.notStrictEqual((0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Element, 1, 5, 0n), base, 'prevSibling must affect rowHash');
    assert_1.default.notStrictEqual((0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Element, 1, 0, 1n), base, 'contentHash must affect rowHash');
    console.log('[unit] rowHash primitives (deterministic, sensitive, mod-2^64-correct) ok');
}
/** §1.5 — TableHashTracker's running sum must be order-independent and correctly reversible. */
function testTableHashTrackerOrderIndependence() {
    const rows = new Map([
        [1, (0, rowHash_1.h64Str)('a')],
        [2, (0, rowHash_1.h64Str)('b')],
        [3, (0, rowHash_1.h64Str)('c')],
    ]);
    const forward = new rowHash_1.TableHashTracker();
    for (const [id, h] of rows)
        forward.upsert(id, h);
    const reversed = new rowHash_1.TableHashTracker();
    for (const [id, h] of [...rows].reverse())
        reversed.upsert(id, h);
    assert_1.default.strictEqual(forward.value, reversed.value, 'tableHash (a running sum mod 2^64) must not depend on upsert order');
    assert_1.default.strictEqual(forward.size, 3);
    // Replacing an existing row's hash must retract the old contribution, not add to it.
    const before = forward.value;
    forward.upsert(2, (0, rowHash_1.h64Str)('b-updated'));
    assert_1.default.notStrictEqual(forward.value, before, 'replacing a row hash must change the total');
    forward.upsert(2, rows.get(2));
    assert_1.default.strictEqual(forward.value, before, 'restoring the original row hash must restore the original total');
    // remove() must exactly undo upsert() — final total after removing everything is the identity (0).
    forward.remove(1);
    forward.remove(2);
    forward.remove(3);
    assert_1.default.strictEqual(forward.value, 0n, 'removing every row must return the tracker to the zero identity');
    assert_1.default.strictEqual(forward.size, 0);
    console.log('[unit] TableHashTracker order-independent sum + exact remove ok');
}
/** §1.3/§1.5 — ReplicatedTable row construction: contentHash/rowHash formulas match the spec, ATTR_DEL absent-key is a no-op. */
function testReplicatedTableRowContentHash() {
    const table = new replicatedTable_1.ReplicatedTable();
    table.createElementRow(10, 'div', [{ name: 'class', value: 'a' }]);
    const afterCreate = table.getRow(10);
    assert_1.default.ok(afterCreate);
    const expectedCreateContent = (0, rowHash_1.addMod64)((0, rowHash_1.addMod64)((0, rowHash_1.hashName)('div'), (0, rowHash_1.hashNs)(elementNs_1.ElementNs.Html)), (0, rowHash_1.hashAttr)('class', 'a'));
    assert_1.default.strictEqual(afterCreate.contentHash, expectedCreateContent, '§1.3 element contentHash = Σ(ns hash, tag name hash, attr hashes)');
    assert_1.default.strictEqual(afterCreate.rowHash, (0, rowHash_1.computeRowHash)(10, opcodes_1.NodeKind.Element, 0, 0, expectedCreateContent));
    table.setAttrs(10, [{ name: 'id', value: 'root' }]);
    const expectedAfterSet = (0, rowHash_1.addMod64)(expectedCreateContent, (0, rowHash_1.hashAttr)('id', 'root'));
    assert_1.default.strictEqual(table.getRow(10).contentHash, expectedAfterSet, 'ATTR_SET must add the new attribute contribution');
    // §4.4 — deleting an attribute that was never set is a documented no-op, not an error.
    table.delAttrs(10, ['does-not-exist']);
    assert_1.default.strictEqual(table.getRow(10).contentHash, expectedAfterSet, 'absent-attribute ATTR_DEL must be a no-op');
    table.delAttrs(10, ['class']);
    const expectedAfterDel = (0, rowHash_1.subMod64)(expectedAfterSet, (0, rowHash_1.hashAttr)('class', 'a'));
    assert_1.default.strictEqual(table.getRow(10).contentHash, expectedAfterDel, 'ATTR_DEL must retract exactly that attribute\'s contribution');
    table.createLeafRow(20, opcodes_1.NodeKind.Text, 'hello');
    assert_1.default.strictEqual(table.getRow(20).contentHash, (0, rowHash_1.hashValue)('hello'), '§1.3 text/comment contentHash = hashValue(text)');
    table.setValue(20, 'world');
    assert_1.default.strictEqual(table.getRow(20).contentHash, (0, rowHash_1.hashValue)('world'), 'TEXT_SET must replace, not accumulate, contentHash');
    table.createLeafRow(30, opcodes_1.NodeKind.Doctype, 'html');
    assert_1.default.strictEqual(table.getRow(30).contentHash, (0, rowHash_1.hashValue)('html'), 'doctype contentHash uses its name field as the single content string');
    console.log('[unit] ReplicatedTable row contentHash/rowHash formulas ok');
}
/** §4.3 — INSERT/REMOVE topology: exact prevSibling repair on link/unlink/move, without a table-wide scan. */
function testReplicatedTableTopologyRepair() {
    const table = new replicatedTable_1.ReplicatedTable();
    const NONE = 0;
    for (const id of [10, 11, 12, 13])
        table.createElementRow(id, 'div', []);
    table.insertBatch(1, NONE, [10]);
    table.insertBatch(10, NONE, [11, 12]);
    assert_1.default.strictEqual(table.getRow(11).prevSibling, NONE);
    assert_1.default.strictEqual(table.getRow(12).prevSibling, 11);
    // Insert 13 before 11 — must repair 11's prevSibling without touching 12.
    const beforeHash12 = table.getRow(12).rowHash;
    table.insertBatch(10, 11, [13]);
    assert_1.default.strictEqual(table.getRow(13).prevSibling, NONE, '13 lands first (before 11, which had no prevSibling)');
    assert_1.default.strictEqual(table.getRow(11).prevSibling, 13, '11 must be relinked after 13');
    assert_1.default.strictEqual(table.getRow(12).rowHash, beforeHash12, '12 must be untouched by an insert that does not neighbor it');
    // Remove 11 (the middle node) — 12 must be relinked directly after 13, skipping 11.
    table.removeBatch(10, [11]);
    assert_1.default.strictEqual(table.getRow(11).parent, NONE, 'removed row is detached');
    assert_1.default.strictEqual(table.getRow(11).prevSibling, NONE);
    assert_1.default.strictEqual(table.getRow(12).prevSibling, 13, '12 must skip over the removed 11 and relink to 13');
    // Re-insert 11 at the end (append) — must land after the current last child (12).
    table.insertBatch(10, NONE, [11]);
    assert_1.default.strictEqual(table.getRow(11).parent, 10);
    assert_1.default.strictEqual(table.getRow(11).prevSibling, 12, 're-inserted-at-end must link after the current last child');
    // Moving a node already attached elsewhere must unlink it from its old position first (§4.3 "a move").
    table.insertBatch(1, NONE, [12]); // move 12 out from under 10, to the end of parent 1 (after 10)
    assert_1.default.strictEqual(table.getRow(12).parent, 1);
    assert_1.default.strictEqual(table.getRow(11).prevSibling, 13, '11 must be relinked to 13 once 12 (its former follower) moves away');
    // dropRow (§4.2 NODE_DROP, Stage 3) must remove the row's contribution from tableHash entirely.
    const totalBeforeDrop = table.tableHash;
    const droppedRowHash = table.getRow(13).rowHash;
    table.dropRow(13);
    assert_1.default.strictEqual(table.has(13), false);
    assert_1.default.strictEqual(table.tableHash, (0, rowHash_1.subMod64)(totalBeforeDrop, droppedRowHash));
    console.log('[unit] ReplicatedTable INSERT/REMOVE topology repair (prevSibling, move, drop) ok');
}
/**
 * OPEN-7 — insert-before-existing must set nextSiblingOf[last] = before so REMOVE of last
 * repairs hashed before.prevSibling. The topology test above removes a *middle* node whose
 * reverse link was already set by a prior append, so it cannot catch this.
 */
function testReplicatedTableInsertBeforeNextSiblingRepair() {
    const table = new replicatedTable_1.ReplicatedTable();
    const NONE = 0;
    const P = 10;
    const X = 11;
    const A = 12;
    const L = 13;
    for (const id of [P, X, A, L])
        table.createElementRow(id, 'div', []);
    table.insertBatch(1, NONE, [P]);
    table.insertBatch(P, NONE, [X]);
    table.insertBatch(P, X, [A, L]);
    assert_1.default.strictEqual(table.getRow(A).prevSibling, NONE);
    assert_1.default.strictEqual(table.getRow(L).prevSibling, A);
    assert_1.default.strictEqual(table.getRow(X).prevSibling, L);
    const xHashAfterInsert = table.getRow(X).rowHash;
    table.removeBatch(P, [L]);
    assert_1.default.strictEqual(table.getRow(L).parent, NONE);
    assert_1.default.strictEqual(table.getRow(A).prevSibling, NONE);
    assert_1.default.strictEqual(table.getRow(X).prevSibling, A, 'OPEN-7: REMOVE of last-inserted-before must relink X.prevSibling to A');
    assert_1.default.notStrictEqual(table.getRow(X).rowHash, xHashAfterInsert, 'hashed prevSibling on X must change when L is removed');
    const first = new replicatedTable_1.ReplicatedTable();
    first.createElementRow(P, 'div', []);
    first.createElementRow(X, 'div', []);
    first.createElementRow(14, 'div', []);
    first.insertBatch(1, NONE, [P]);
    first.insertBatch(P, NONE, [X]);
    first.insertBatch(P, X, [14]);
    first.removeBatch(P, [14]);
    assert_1.default.strictEqual(first.getRow(X).prevSibling, NONE, 'OPEN-7: REMOVE of a single prepended id must restore first-child prevSibling=0');
    console.log('[unit] ReplicatedTable insert-before nextSiblingOf repair (OPEN-7) ok');
}
/**
 * prepend-stress shape at the table layer: INSERT-before-first batches + tail REMOVE + aged NODE_DROP.
 * Derived lastChildOf walk must stay identical to hashed parent (OPEN-8: live O2 failed this shape).
 */
function testReplicatedTablePrependEvictDerivedLinks() {
    const table = new replicatedTable_1.ReplicatedTable();
    const LIST = 19;
    const BATCH = 50;
    const MAX_LIVE = 400;
    const AGE = 20;
    table.createElementRow(LIST, 'div', []);
    table.insertBatch(1, 0, [LIST]);
    let nextId = 100;
    const live = [];
    const detachedAt = new Map();
    for (let seq = 1; seq <= 200; seq++) {
        table.setSequence(seq);
        const batch = [];
        for (let i = 0; i < BATCH; i++) {
            const id = nextId++;
            table.createElementRow(id, 'div', []);
            batch.push(id);
        }
        const before = live[0] ?? 0;
        table.insertBatch(LIST, before, batch);
        live.unshift(...batch);
        while (live.length > MAX_LIVE) {
            const old = live.pop();
            table.removeBatch(LIST, [old]);
            detachedAt.set(old, seq);
        }
        const droppable = [];
        for (const [id, at] of detachedAt) {
            if (seq - at >= AGE)
                droppable.push(id);
        }
        for (const id of droppable) {
            table.dropSubtree(id);
            detachedAt.delete(id);
        }
        const walked = table.orderedChildIds(LIST);
        const hashed = table.countAttachedChildren(LIST);
        if (walked.length !== hashed) {
            const lastId = table.lastChildId(LIST);
            const lastRow = table.getRow(lastId);
            assert_1.default.fail(`seq ${seq}: lastChildOf walk ${walked.length} !== hashed parent ${hashed}` +
                ` lastChildId=${lastId} lastRow=${lastRow ? `parent=${lastRow.parent} prev=${lastRow.prevSibling}` : 'missing'}` +
                ` liveFirst=${live[0]} liveLast=${live[live.length - 1]}`);
        }
        assert_1.default.strictEqual(walked.length, live.length, `seq ${seq}: walk ${walked.length} !== live ${live.length}`);
        assert_1.default.deepStrictEqual(walked, live, `seq ${seq}: sibling order diverged from prepend+evict model`);
    }
    console.log('[unit] ReplicatedTable prepend+evict derived lastChildOf matches hashed parent ok');
}
function open7Table() {
    const table = new replicatedTable_1.ReplicatedTable();
    const NONE = 0;
    for (const id of [10, 11, 12, 13])
        table.createElementRow(id, 'div', []);
    table.insertBatch(1, NONE, [10]);
    table.insertBatch(10, NONE, [11]);
    table.insertBatch(10, 11, [12, 13]);
    table.removeBatch(10, [13]);
    return table;
}
/** O2 local — table child order vs a synthetic live map (no DOM). */
function testTableLiveOracle() {
    const P = 10;
    const X = 11;
    const A = 12;
    const L = 13;
    const table = open7Table();
    const matching = new Map([
        [1, [P]],
        [P, [A, X]],
    ]);
    const ok = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, matching);
    assert_1.default.strictEqual(ok.identical, true, `expected identical, got ${JSON.stringify(ok.divergences)}`);
    const stale = new Map([
        [1, [P]],
        [P, [A, L, X]],
    ]);
    const staleResult = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, stale);
    assert_1.default.strictEqual(staleResult.identical, false);
    assert_1.default.ok(staleResult.divergences.some((d) => d.kind === 'child_order_mismatch'), `expected child_order_mismatch, got ${JSON.stringify(staleResult.divergences)}`);
    const missingLive = new Map([[1, [P]]]);
    const extra = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, missingLive);
    assert_1.default.strictEqual(extra.identical, false);
    assert_1.default.ok(extra.divergences.some((d) => d.kind === 'extra_attached_in_table'), `expected extra_attached_in_table, got ${JSON.stringify(extra.divergences)}`);
    const withDetached = new Map([
        [1, [P]],
        [P, [A, X]],
    ]);
    // L remains detached (parent=0) and omitted from live — OPEN-2, not a failure.
    const detachedOk = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, withDetached);
    assert_1.default.strictEqual(detachedOk.identical, true);
    // REMOVE leaves descendants attached to the detached row (§4.3) — not a live-tree failure.
    table.createLeafRow(99, opcodes_1.NodeKind.Text, 'ghost');
    table.insertBatch(L, 0, [99]);
    const subtreeDetached = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, withDetached);
    assert_1.default.strictEqual(subtreeDetached.identical, true, `detached subtree under L must not fail O2: ${JSON.stringify(subtreeDetached.divergences)}`);
    console.log('[unit] tableLiveOracle O2 local (OPEN-7 shape + mismatch + detached) ok');
}
function testDomO2IgnoresSheetRows() {
    const table = new replicatedTable_1.ReplicatedTable();
    table.createElementRow(10, 'html', []);
    table.insertBatch(1, 0, [10]);
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        {
            op: opcodes_1.OpCode.SheetNew,
            id: 80,
            scope: frame_1.CSSOM_SCOPE_MAIN,
            hostNode: 0,
            before: frame_1.INSERT_AT_END,
        },
    ]);
    const live = new Map([
        [1, [10]],
        [10, []],
    ]);
    const result = (0, tableLiveOracle_1.compareTableToLiveOrder)(table, live);
    assert_1.default.strictEqual(result.identical, true, `Sheet under document must not fail DOM O2: ${JSON.stringify(result.divergences)}`);
    console.log('[unit] DOM O2 ignores Sheet/Rule rows under document ok');
}
function testCssomTableLiveOracle() {
    const sheetId = 80;
    const ruleId = 81;
    const text = 'a { color: red }';
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.SheetNew, id: sheetId, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        { op: opcodes_1.OpCode.RuleNew, sheet: sheetId, id: ruleId, before: frame_1.INSERT_AT_END, text },
    ]);
    const ok = (0, cssomTableLiveOracle_1.compareTableToLiveCssom)(table, [
        { id: sheetId, ruleIds: [ruleId], ruleHashes: [(0, rowHash_1.hashValue)(text)] },
    ]);
    assert_1.default.strictEqual(ok.identical, true, JSON.stringify(ok.divergences));
    const mismatch = (0, cssomTableLiveOracle_1.compareTableToLiveCssom)(table, [
        { id: sheetId, ruleIds: [ruleId], ruleHashes: [(0, rowHash_1.hashValue)('a { color: blue }')] },
    ]);
    assert_1.default.strictEqual(mismatch.identical, false);
    assert_1.default.ok(mismatch.divergences.some((d) => d.kind === 'rule_content_mismatch'), `expected rule_content_mismatch, got ${JSON.stringify(mismatch.divergences)}`);
    console.log('[unit] cssomTableLiveOracle contentHash mismatch ok');
}
/**
 * frame-protocol.md §1.5 Stage 1 GATE — "unit tests proving producer and client compute identical
 * rowHash/tableHash for the same sequence of mutations." Two independent `ReplicatedTable`
 * instances (standing in for the producer's table and the client's table) fed the exact same
 * `FrameOp` sequence through the one shared `applyOpsToTable` interpreter must end up byte-for-byte
 * identical — same `tableHash`, same per-row snapshot for every id — and a real divergence must be
 * detectable (tableHash actually changes), so this is not a vacuously-true comparison.
 */
function testReplicatedTableApplyOpsParity() {
    const ops = [
        { op: opcodes_1.OpCode.NodeNew, id: 10, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [{ name: 'class', value: 'a' }] },
        { op: opcodes_1.OpCode.NodeNew, id: 11, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'span', attrs: [] },
        { op: opcodes_1.OpCode.NodeNew, id: 12, kind: opcodes_1.NodeKind.Text, value: 'hello' },
        { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [10] },
        { op: opcodes_1.OpCode.Insert, parent: 10, before: 0, ids: [11, 12] },
        { op: opcodes_1.OpCode.AttrSet, node: 10, attrs: [{ name: 'id', value: 'root' }] },
        { op: opcodes_1.OpCode.NodeNew, id: 13, kind: opcodes_1.NodeKind.Comment, value: 'c' },
        { op: opcodes_1.OpCode.Insert, parent: 10, before: 11, ids: [13] },
        { op: opcodes_1.OpCode.TextSet, node: 12, value: 'world' },
        { op: opcodes_1.OpCode.AttrDel, node: 10, names: ['class'] },
        { op: opcodes_1.OpCode.Remove, parent: 10, ids: [11] },
        { op: opcodes_1.OpCode.Insert, parent: 10, before: 0, ids: [11] },
        { op: opcodes_1.OpCode.NodeNew, id: 14, kind: opcodes_1.NodeKind.Doctype, name: 'html' },
    ];
    const producerTable = new replicatedTable_1.ReplicatedTable();
    const clientTable = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(producerTable, ops);
    (0, replicatedTableApply_1.applyOpsToTable)(clientTable, ops);
    assert_1.default.strictEqual(producerTable.size, clientTable.size);
    assert_1.default.strictEqual(producerTable.tableHash, clientTable.tableHash, 'independently-built producer/client tables must agree on tableHash for identical ops');
    for (const id of [10, 11, 12, 13, 14]) {
        assert_1.default.deepStrictEqual(clientTable.getRow(id), producerTable.getRow(id), `row ${id} must be identical across producer/client tables`);
    }
    // Correctness against the spec's own INSERT semantics, not just "the two sides agree with each other":
    // final expected order under 10 is [13, 12, 11] after the move/reorder/remove/reinsert sequence above.
    assert_1.default.strictEqual(producerTable.getRow(13).prevSibling, 0);
    assert_1.default.strictEqual(producerTable.getRow(12).prevSibling, 13);
    assert_1.default.strictEqual(producerTable.getRow(11).prevSibling, 12);
    assert_1.default.strictEqual(producerTable.getRow(12).contentHash, (0, rowHash_1.hashValue)('world'), 'TEXT_SET must have taken effect');
    // A real divergence (client applies one extra, different mutation) must be a detectable tableHash change —
    // proves the equality above is a meaningful signal, not a test that would pass no matter what.
    clientTable.setValue(12, 'DIVERGED');
    assert_1.default.notStrictEqual(clientTable.tableHash, producerTable.tableHash, 'a genuine state divergence must change tableHash');
    console.log('[unit] ReplicatedTable producer/client hash parity across full op sequence (Stage 1 gate) ok');
}
/** §5.8 — a resync-flagged frame must wipe the table wholesale, not extend it. */
function testReplicatedTableResyncWholesaleReplace() {
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.NodeNew, id: 10, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [10] },
    ]);
    assert_1.default.strictEqual(table.has(10), true);
    const resyncOps = [
        { op: opcodes_1.OpCode.NodeNew, id: 99, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'section', attrs: [] },
        { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [99] },
    ];
    (0, replicatedTableApply_1.applyFrameToTable)(table, true, resyncOps);
    assert_1.default.strictEqual(table.has(10), false, 'resync must clear rows not re-described by the resync frame');
    assert_1.default.strictEqual(table.has(99), true);
    assert_1.default.strictEqual(table.size, 1);
    const expectedResyncTable = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(expectedResyncTable, resyncOps);
    assert_1.default.strictEqual(table.tableHash, expectedResyncTable.tableHash, 'post-resync tableHash must equal a table built fresh from just the resync ops');
    console.log('[unit] ReplicatedTable resync wholesale replace ok');
}
const STAGE2_OPS = [
    { op: opcodes_1.OpCode.NodeNew, id: 10, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [{ name: 'class', value: 'a' }] },
    { op: opcodes_1.OpCode.NodeNew, id: 11, kind: opcodes_1.NodeKind.Text, value: 'hi' },
    { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [10] },
    { op: opcodes_1.OpCode.Insert, parent: 10, before: 0, ids: [11] },
];
/**
 * frame-protocol.md §6/§4.1 Stage 2 GATE — a well-formed frame (real `preTableHash` +
 * whole-table `CHECK` computed from a table built the same way, e.g. by `resync.ts`)
 * must apply cleanly through `applyFrameToTableChecked`: `ok: true`, and the table ends up
 * in exactly the state a plain, unchecked `applyOpsToTable` would produce for the same ops.
 */
function testApplyFrameToTableCheckedAcceptsValidFrame() {
    const reference = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(reference, STAGE2_OPS);
    const table = new replicatedTable_1.ReplicatedTable();
    const ops = [
        ...STAGE2_OPS,
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: reference.tableHash },
    ];
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, ops);
    assert_1.default.strictEqual(result.ok, true, 'a CHECK matching the actual post-apply tableHash must pass');
    assert_1.default.strictEqual(table.tableHash, reference.tableHash);
    console.log('[unit] applyFrameToTableChecked accepts a valid preTableHash+CHECK frame ok');
}
/**
 * frame-protocol.md §6/§P3 Stage 2 GATE — "a deliberately-corrupted frame (wrong preTableHash,
 * or a mid-frame CHECK mismatch) touches zero DOM nodes and produces a precondition failure."
 * This proves the table-level half of that contract: `applyFrameToTableChecked` must report
 * `ok: false` with the exact expected/actual hashes on a CHECK mismatch, and the caller
 * (`client/applyDom.ts`) must be able to tell from the return value alone, without inspecting
 * the table, that phase 2 (the DOM) must never run for this frame.
 */
function testApplyFrameToTableCheckedRejectsCorruptedCheck() {
    const table = new replicatedTable_1.ReplicatedTable();
    const wrongHash = 0xdeadbeefn;
    const ops = [
        ...STAGE2_OPS,
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: wrongHash },
    ];
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, ops);
    assert_1.default.strictEqual(result.ok, false, 'a CHECK whose hash disagrees with the table must fail, not silently pass');
    if (!result.ok && result.opName === 'check') {
        assert_1.default.strictEqual(result.expected, wrongHash, 'failure must report the CHECK op\'s claimed hash as "expected"');
        assert_1.default.notStrictEqual(result.actual, wrongHash, 'failure must report the table\'s real hash as "actual", distinct from the bogus claim');
        assert_1.default.strictEqual(result.failedOpIndex, ops.length - 1, 'the CHECK is the last op in this fixture');
        assert_1.default.strictEqual(result.scope, frame_1.CHECK_SCOPE_TABLE);
    }
    else if (!result.ok) {
        assert_1.default.fail(`expected a CHECK failure, got opName=${result.opName}`);
    }
    console.log('[unit] applyFrameToTableChecked rejects a corrupted CHECK with expected/actual hashes ok');
}
/**
 * §4.1 `CHECK.scope = 1` (`CHECK_SCOPE_RANGE`) — a range CHECK must evaluate against exactly the
 * `[lo, hi]` rows (`ReplicatedTable.hashRange`), independent of rows outside that range: a
 * corruption outside `[lo, hi]` must not trip a range CHECK that covers a different, unaffected
 * span, and a corruption inside it must.
 */
function testApplyFrameToTableCheckedRangeScope() {
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, STAGE2_OPS);
    const rangeHash = table.hashRange(10, 10);
    const okResult = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
    ]);
    assert_1.default.strictEqual(okResult.ok, true, 'a range CHECK matching hashRange(lo, hi) must pass');
    // Mutate a row outside [10, 10] — must not affect a CHECK scoped only to id 10.
    table.setValue(11, 'changed-outside-range');
    const stillOk = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
    ]);
    assert_1.default.strictEqual(stillOk.ok, true, 'a mutation outside [lo, hi] must not trip a range CHECK scoped elsewhere');
    // Mutate the row actually inside the range — must now trip the same CHECK hash.
    table.setAttrs(10, [{ name: 'id', value: 'changed-inside-range' }]);
    const nowFails = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
    ]);
    assert_1.default.strictEqual(nowFails.ok, false, 'a mutation inside [lo, hi] must trip a range CHECK covering it');
    if (!nowFails.ok && nowFails.opName === 'check') {
        assert_1.default.strictEqual(nowFails.expected, rangeHash);
        assert_1.default.notStrictEqual(nowFails.actual, rangeHash);
    }
    console.log('[unit] applyFrameToTableChecked CHECK_SCOPE_RANGE evaluates only [lo, hi] ok');
}
/** §4.1 scope=1 must survive encode → decode — producer writes the same `scope u8` as table CHECK. */
function testCheckScopeRangeEncodeDecode() {
    const ops = [
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_RANGE, lo: 10, hi: 40, hash: 0xabcdefn },
    ];
    const frame = (0, frame_1.createFrame)({ generation: 1, sequence: 3, ops, preTableHash: 99n });
    const bytes = new binaryFrameEncoder_1.BinaryFrameEncoder().encode(frame)[0];
    const decoded = (0, decode_1.decodeFramePart)(bytes, new decode_1.PersistentStringTable());
    assert_1.default.ok(decoded.ok, 'range CHECK frame must decode');
    if (!decoded.ok)
        return;
    const check = decoded.part.ops[0];
    assert_1.default.strictEqual(check?.op, opcodes_1.OpCode.Check);
    if (check?.op !== opcodes_1.OpCode.Check)
        return;
    assert_1.default.strictEqual(check.scope, frame_1.CHECK_SCOPE_RANGE);
    assert_1.default.strictEqual(check.lo, 10);
    assert_1.default.strictEqual(check.hi, 40);
    assert_1.default.strictEqual(check.hash, 0xabcdefn);
    console.log('[unit] CHECK_SCOPE_RANGE encode/decode round-trip ok');
}
function frameLocalStrCount(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
}
function patchNodeNewNsByte(bytes, ns) {
    const out = bytes.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let o = 24;
    const strCount = view.getUint32(o, true);
    o += 4;
    for (let i = 0; i < strCount; i++) {
        const len = view.getUint32(o, true);
        o += 4 + len;
    }
    const opCount = view.getUint32(o, true);
    o += 4;
    assert_1.default.strictEqual(opCount, 1);
    assert_1.default.strictEqual(out[o], opcodes_1.OpCode.NodeNew);
    o += 1 + 4; // opcode + id
    assert_1.default.strictEqual(out[o], opcodes_1.NodeKind.Element);
    o += 1; // kind
    out[o] = ns;
    return out;
}
function withEmptyFirstFrameString(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = 24;
    const strCount = view.getUint32(header, true);
    let o = header + 4;
    const firstLen = view.getUint32(o, true);
    const rest = bytes.subarray(o + 4 + firstLen);
    const out = new Uint8Array(header + 4 + 4 + rest.length);
    out.set(bytes.subarray(0, header));
    const ov = new DataView(out.buffer);
    ov.setUint32(header, strCount, true);
    ov.setUint32(header + 4, 0, true);
    out.set(rest, header + 8);
    return out;
}
/** SEAL-DOM-P1-SVG / PP-F-SVG-1 — NODE_NEW Element ns enum, version 2, hash split. */
function testNodeNewElementNsWire() {
    assert_1.default.strictEqual(frame_1.FRAME_WIRE_VERSION, 2);
    const htmlOp = {
        op: opcodes_1.OpCode.NodeNew,
        id: 10,
        kind: opcodes_1.NodeKind.Element,
        ns: elementNs_1.ElementNs.Html,
        name: 'a',
        attrs: [],
    };
    const htmlBytes = new binaryFrameEncoder_1.BinaryFrameEncoder().encode((0, frame_1.createFrame)({ generation: 1, sequence: 1, ops: [htmlOp] }))[0];
    const htmlDecoded = (0, decode_1.decodeFramePart)(htmlBytes, new decode_1.PersistentStringTable());
    assert_1.default.ok(htmlDecoded.ok, 'html NODE_NEW must decode');
    if (!htmlDecoded.ok)
        return;
    assert_1.default.strictEqual(htmlDecoded.part.version, 2);
    const htmlGot = htmlDecoded.part.ops[0];
    assert_1.default.strictEqual(htmlGot?.op, opcodes_1.OpCode.NodeNew);
    if (htmlGot?.op !== opcodes_1.OpCode.NodeNew || htmlGot.kind !== opcodes_1.NodeKind.Element)
        return;
    assert_1.default.strictEqual(htmlGot.ns, elementNs_1.ElementNs.Html);
    assert_1.default.strictEqual(htmlGot.uri, undefined);
    assert_1.default.strictEqual(frameLocalStrCount(htmlBytes), 1, 'html ns must not emit a namespace StrRef');
    const svgOp = {
        op: opcodes_1.OpCode.NodeNew,
        id: 11,
        kind: opcodes_1.NodeKind.Element,
        ns: elementNs_1.ElementNs.Svg,
        name: 'a',
        attrs: [],
    };
    const svgBytes = new binaryFrameEncoder_1.BinaryFrameEncoder().encode((0, frame_1.createFrame)({ generation: 1, sequence: 1, ops: [svgOp] }))[0];
    const svgDecoded = (0, decode_1.decodeFramePart)(svgBytes, new decode_1.PersistentStringTable());
    assert_1.default.ok(svgDecoded.ok, 'svg NODE_NEW must decode');
    if (!svgDecoded.ok)
        return;
    const svgGot = svgDecoded.part.ops[0];
    assert_1.default.strictEqual(svgGot?.op, opcodes_1.OpCode.NodeNew);
    if (svgGot?.op !== opcodes_1.OpCode.NodeNew || svgGot.kind !== opcodes_1.NodeKind.Element)
        return;
    assert_1.default.strictEqual(svgGot.ns, elementNs_1.ElementNs.Svg);
    assert_1.default.strictEqual(svgGot.uri, undefined);
    assert_1.default.strictEqual(frameLocalStrCount(svgBytes), 1, 'svg ns must not emit a namespace StrRef');
    const customOp = {
        op: opcodes_1.OpCode.NodeNew,
        id: 12,
        kind: opcodes_1.NodeKind.Element,
        ns: elementNs_1.ElementNs.Custom,
        uri: 'http://example.com/ns',
        name: 'a',
        attrs: [],
    };
    const customBytes = new binaryFrameEncoder_1.BinaryFrameEncoder().encode((0, frame_1.createFrame)({ generation: 1, sequence: 1, ops: [customOp] }))[0];
    const customDecoded = (0, decode_1.decodeFramePart)(customBytes, new decode_1.PersistentStringTable());
    assert_1.default.ok(customDecoded.ok, 'custom NODE_NEW must decode');
    if (!customDecoded.ok)
        return;
    const customGot = customDecoded.part.ops[0];
    assert_1.default.strictEqual(customGot?.op, opcodes_1.OpCode.NodeNew);
    if (customGot?.op !== opcodes_1.OpCode.NodeNew || customGot.kind !== opcodes_1.NodeKind.Element)
        return;
    assert_1.default.strictEqual(customGot.ns, elementNs_1.ElementNs.Custom);
    assert_1.default.strictEqual(customGot.uri, 'http://example.com/ns');
    assert_1.default.strictEqual(frameLocalStrCount(customBytes), 2, 'custom ns must carry a uri StrRef');
    const badNs = (0, decode_1.decodeFramePart)(patchNodeNewNsByte(htmlBytes, 5), new decode_1.PersistentStringTable());
    assert_1.default.strictEqual(badNs.ok, false);
    if (!badNs.ok)
        assert_1.default.strictEqual(badNs.reason, 'malformed');
    assert_1.default.throws(() => new binaryFrameEncoder_1.BinaryFrameEncoder().encode((0, frame_1.createFrame)({
        generation: 1,
        sequence: 1,
        ops: [{ op: opcodes_1.OpCode.NodeNew, id: 13, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Custom, uri: '', name: 'a', attrs: [] }],
    })));
    const emptyCustom = (0, decode_1.decodeFramePart)(withEmptyFirstFrameString(customBytes), new decode_1.PersistentStringTable());
    assert_1.default.strictEqual(emptyCustom.ok, false);
    if (!emptyCustom.ok)
        assert_1.default.strictEqual(emptyCustom.reason, 'malformed');
    const v1 = htmlBytes.slice();
    v1[2] = 1;
    const oldVer = (0, decode_1.decodeFramePart)(v1, new decode_1.PersistentStringTable());
    assert_1.default.strictEqual(oldVer.ok, false);
    if (!oldVer.ok)
        assert_1.default.strictEqual(oldVer.reason, 'unknown_version');
    const htmlTable = new replicatedTable_1.ReplicatedTable();
    const svgTable = new replicatedTable_1.ReplicatedTable();
    htmlTable.createElementRow(10, 'a', [], elementNs_1.ElementNs.Html);
    svgTable.createElementRow(10, 'a', [], elementNs_1.ElementNs.Svg);
    assert_1.default.notStrictEqual(htmlTable.getRow(10).contentHash, svgTable.getRow(10).contentHash, 'HTML <a> and SVG <a> must not share contentHash');
    console.log('[unit] NODE_NEW Element ns wire + hash split ok');
}
function testStructuralDiffNsMismatch() {
    const sameTagWrongNs = (0, structuralDiff_1.diffTrees)({ tag: 'a', ns: 'svg' }, { tag: 'a' });
    assert_1.default.strictEqual(sameTagWrongNs.identical, false);
    assert_1.default.ok(sameTagWrongNs.divergences.some((d) => d.kind === 'ns_mismatch'), `expected ns_mismatch, got ${JSON.stringify(sameTagWrongNs.divergences)}`);
    const bothSvg = (0, structuralDiff_1.diffTrees)({ tag: 'circle', ns: 'svg' }, { tag: 'circle', ns: 'svg' });
    assert_1.default.strictEqual(bothSvg.identical, true);
    console.log('[unit] structuralDiff ns_mismatch ok');
}
/**
 * frame-protocol.md §2 Stage 2 GATE — the client's own precondition check (`preTableHash`
 * against its table's current `tableHash`, `client/applyDom.ts` phase 1) is the first gate
 * *before* `applyFrameToTableChecked` ever runs; this proves the table-level primitive
 * `applyFrameToTableChecked` gates on, in isolation from the DOM-bound caller: ops before a
 * failing CHECK still mutate the table (§P3 — "phase 1 is pure memory, not DOM, and is not
 * rolled back"), which is exactly why the caller must treat any `ok: false` as "abort, and the
 * next frame's preTableHash — or a future resync — is what heals this", never "retry phase 1".
 */
function testApplyFrameToTableCheckedDoesNotRollBackPriorOps() {
    const table = new replicatedTable_1.ReplicatedTable();
    const ops = [
        ...STAGE2_OPS,
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 0n }, // deliberately wrong
    ];
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, ops);
    assert_1.default.strictEqual(result.ok, false);
    // The NODE_NEW/INSERT ops before the failing CHECK are NOT undone — table still reflects them.
    assert_1.default.strictEqual(table.has(10), true, 'ops before the failing CHECK must still have applied to the table (no rollback)');
    assert_1.default.strictEqual(table.getRow(10).parent, 1);
    console.log('[unit] applyFrameToTableChecked does not roll back ops preceding a failed CHECK (§P3) ok');
}
/**
 * frame-protocol.md §4.1 `EPOCH_RESET` Stage 3 GATE — its `Table` effect ("clear the table,
 * restart id allocation") must actually clear every row and derived index, not just report
 * `size === 0` — `tableHash` must also return to the fresh-table value (`0n`), proving the
 * `TableHashTracker` itself was cleared, not merely emptied of live rows one at a time.
 */
function testEpochResetClearsReplicatedTable() {
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, STAGE2_OPS);
    assert_1.default.ok(table.size > 0, 'sanity: STAGE2_OPS must populate rows before EPOCH_RESET');
    assert_1.default.notStrictEqual(table.tableHash, 0n, 'sanity: a populated table must have a non-zero tableHash');
    (0, replicatedTableApply_1.applyOpToTable)(table, { op: opcodes_1.OpCode.EpochReset, generation: 2 });
    assert_1.default.strictEqual(table.size, 0, 'EPOCH_RESET must clear every row (frame-protocol.md §4.1)');
    assert_1.default.strictEqual(table.tableHash, 0n, 'EPOCH_RESET must reset tableHash to the fresh-table value');
    assert_1.default.strictEqual(table.has(10), false);
    // The table must still be fully usable afterwards — EPOCH_RESET is "restart id allocation",
    // not "table is now unusable".
    (0, replicatedTableApply_1.applyOpsToTable)(table, STAGE2_OPS);
    assert_1.default.strictEqual(table.size, 2, 'table must accept new rows after EPOCH_RESET');
    console.log('[unit] EPOCH_RESET clears ReplicatedTable (rows + tableHash) ok');
}
/**
 * frame-protocol.md §4.2 `NODE_DROP` Stage 3 GATE (OPEN-1/OPEN-2) — dropping a detached
 * subtree's root must also drop every descendant (§4.2: "drops each row and all its
 * descendants — a detached row may still have children"), and `tableHash` must end up exactly
 * where a table that never had those rows would be — proving the O(1) subtract-per-row in
 * `dropSubtree`/`dropRow` is exact, not approximate.
 */
function testNodeDropRemovesSubtreeAndDescendants() {
    const table = new replicatedTable_1.ReplicatedTable();
    // root(10) -> mid(11) -> leaf(12); root(10) also has a second child leaf(13).
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.NodeNew, id: 10, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        { op: opcodes_1.OpCode.NodeNew, id: 11, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'span', attrs: [] },
        { op: opcodes_1.OpCode.NodeNew, id: 12, kind: opcodes_1.NodeKind.Text, value: 'leaf' },
        { op: opcodes_1.OpCode.NodeNew, id: 13, kind: opcodes_1.NodeKind.Text, value: 'leaf2' },
        { op: opcodes_1.OpCode.Insert, parent: 10, before: 0, ids: [11] },
        { op: opcodes_1.OpCode.Insert, parent: 11, before: 0, ids: [12] },
        { op: opcodes_1.OpCode.Insert, parent: 10, before: 0, ids: [13] },
        // Detach the whole subtree at its root — NODE_DROP's own precondition (§4.2) requires
        // `parent = 0` before a row is droppable.
        { op: opcodes_1.OpCode.Remove, parent: 1, ids: [10] },
    ]);
    assert_1.default.strictEqual(table.size, 4, 'sanity: all four rows present, root now detached');
    const ids = table.dropSubtree(10);
    assert_1.default.deepStrictEqual(new Set(ids), new Set([10, 11, 12, 13]), 'dropSubtree must return root + every descendant');
    assert_1.default.strictEqual(table.size, 0, 'all four rows must be gone after dropping the subtree root');
    assert_1.default.strictEqual(table.tableHash, 0n, 'tableHash must return to the fresh-table value once every row is dropped');
    for (const id of [10, 11, 12, 13])
        assert_1.default.strictEqual(table.has(id), false, `row ${id} must no longer exist`);
    console.log('[unit] NODE_DROP dropSubtree removes root + all descendants, tableHash exact ok');
}
/**
 * frame-protocol.md §1.6/OPEN-2 Stage 3 GATE — `collectDroppableIds` must select only detached
 * (`parent === 0`) subtree roots whose `lms` is at least `maxAge` sequences stale, must never
 * select a non-root descendant of a detached subtree (those are collected transitively once
 * their root is chosen, §4.2), and must respect the `limit` bound (same family as
 * `MAX_DIRTY_NODES`, §8) rather than returning every eligible row in one sweep.
 */
function testCollectDroppableIdsAgeAndLimitBound() {
    const table = new replicatedTable_1.ReplicatedTable();
    table.setSequence(1);
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.NodeNew, id: 20, kind: opcodes_1.NodeKind.Text, value: 'old-detached-root' },
        { op: opcodes_1.OpCode.NodeNew, id: 21, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
    ]);
    table.insertBatch(21, 0, [20]); // 20 is now attached under 21 — not droppable
    table.removeBatch(21, [20]); // detach 20 again — its lms is still stamped at sequence=1
    table.setSequence(2);
    (0, replicatedTableApply_1.applyOpsToTable)(table, [{ op: opcodes_1.OpCode.NodeNew, id: 22, kind: opcodes_1.NodeKind.Text, value: 'young-detached-root' }]);
    // At sequence 100 with maxAge=50: id 20 (lms=1, age=99) is eligible; id 22 (lms=2, age=98) is
    // also eligible by age but is attached to nothing and simply detached on its own — both are
    // legitimate detached roots, so both are eligible; id 21 is attached (Document is its parent
    // only via insertBatch's own bookkeeping — it was never actually inserted under 1, so recheck
    // via an explicit still-attached row for the "attached must never be selected" half below.
    (0, replicatedTableApply_1.applyOpsToTable)(table, [{ op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [21] }]); // 21 now genuinely attached
    table.setSequence(200);
    const unbounded = table.collectDroppableIds(200, 50, 1000);
    assert_1.default.ok(unbounded.includes(20), 'a detached root older than maxAge must be selected');
    assert_1.default.ok(unbounded.includes(22), 'every detached root past the age threshold is eligible, regardless of arrival order');
    assert_1.default.ok(!unbounded.includes(21), 'an attached row must never be selected, no matter its age');
    const tooYoung = table.collectDroppableIds(2, 50, 1000);
    assert_1.default.deepStrictEqual(tooYoung, [], 'nothing must be selected before any row has crossed the age threshold');
    const bounded = table.collectDroppableIds(200, 50, 1);
    assert_1.default.strictEqual(bounded.length, 1, 'the limit bound must cap the sweep result, same as MAX_DIRTY_NODES (§8)');
    console.log('[unit] collectDroppableIds respects age threshold + detached-only + limit bound (§1.6/OPEN-2) ok');
}
/**
 * frame-protocol.md §1.6/OPEN-2 Stage 3 GATE — the same-tick sibling of the subtree-resurrection
 * bug fixed in `emitNodeDropSweep`/`replicatedTable.ts` (2026-08-14): a row that crosses the GC
 * age threshold in the *same* tick a live reference reattaches it must never be selected by
 * `collectDroppableIds`, or the producer would emit a self-contradictory frame (an `INSERT`
 * reattaching an id and a `NODE_DROP` of that same id). `tableFrameBuilder.ts`'s `build()` avoids
 * this by folding this tick's own structural ops into the table *before* running the GC sweep —
 * this test locks in that ordering requirement directly against the shared
 * `ReplicatedTable`/`applyOpsToTable` primitives, independent of the DOM-coupled builder.
 */
function testCollectDroppableIdsExcludesSameTickReattach() {
    const table = new replicatedTable_1.ReplicatedTable();
    table.setSequence(1);
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.NodeNew, id: 1, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] }, // root
        { op: opcodes_1.OpCode.NodeNew, id: 20, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'span', attrs: [] },
    ]);
    table.insertBatch(1, 0, [20]);
    table.removeBatch(1, [20]); // 20 is now a detached root, lms stamped at sequence=1
    // Sequence 100, maxAge 50: id 20's age (99) now crosses the threshold — but this tick's own
    // (not-yet-applied) ops reattach it. `ops` mirrors exactly what `TableFrameBuilder.build()`
    // would have queued from this tick's MutationRecords before the ordering fix's `applyOpsToTable`
    // call runs.
    const thisTicksOps = [{ op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [20] }];
    const beforeApply = table.collectDroppableIds(100, 50, 1000);
    assert_1.default.ok(beforeApply.includes(20), 'sanity: querying before this tick\'s own ops are applied still sees id 20 as stale-detached (the bug\'s precondition)');
    // The fix: fold this tick's ops into the table first, exactly as `build()` now does.
    table.setSequence(100);
    (0, replicatedTableApply_1.applyOpsToTable)(table, thisTicksOps);
    const afterApply = table.collectDroppableIds(100, 50, 1000);
    assert_1.default.ok(!afterApply.includes(20), 'a row reattached by this tick\'s own ops must never be selected by the GC sweep that runs after them');
    assert_1.default.strictEqual(table.getRow(20).parent, 1, 'id 20 must genuinely be attached under 1 after the INSERT');
    console.log('[unit] collectDroppableIds excludes a row reattached earlier in the same tick (same-tick GC race) ok');
}
/**
 * frame-protocol.md §4.2 / OPEN-1 CLOSED — NODE_DROP of an absent id is malformed.
 */
function testApplyFrameToTableCheckedRejectsNodeDropAbsentId() {
    const table = new replicatedTable_1.ReplicatedTable();
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [{ op: opcodes_1.OpCode.NodeDrop, ids: [999] }]);
    assert_1.default.strictEqual(result.ok, false, 'NODE_DROP of an id the table has never seen must fail');
    if (!result.ok && result.opName !== 'check') {
        assert_1.default.strictEqual(result.reason, 'malformed', 'an absent-id NODE_DROP is malformed (§4.2 / OPEN-1)');
        assert_1.default.strictEqual(result.opName, 'nodeDrop');
        assert_1.default.strictEqual(result.id, 999);
    }
    else {
        assert_1.default.fail(`expected a nodeDrop op failure, got ${JSON.stringify(result)}`);
    }
    console.log('[unit] applyFrameToTableChecked rejects NODE_DROP of an absent id as malformed (OPEN-1) ok');
}
/**
 * frame-protocol.md §4.2 Stage 3 GATE — "NODE_DROP of an attached row" is the instruction's own
 * documented precondition violation, distinct from OPEN-1's absent-id case: the row exists, but
 * dropping it while still attached would silently orphan whatever the wire still thinks is its
 * parent — a `precondition` failure, not `malformed`.
 */
function testApplyFrameToTableCheckedRejectsNodeDropAttachedId() {
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.NodeNew, id: 30, kind: opcodes_1.NodeKind.Text, value: 'attached' },
        { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [30] },
    ]);
    assert_1.default.strictEqual(table.getRow(30).parent, 1, 'sanity: row 30 is attached to the Document');
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [{ op: opcodes_1.OpCode.NodeDrop, ids: [30] }]);
    assert_1.default.strictEqual(result.ok, false, 'NODE_DROP of a still-attached row must fail');
    if (!result.ok && result.opName !== 'check') {
        assert_1.default.strictEqual(result.reason, 'precondition', 'an attached-id NODE_DROP is a precondition violation (§4.2)');
        assert_1.default.strictEqual(result.opName, 'nodeDrop');
        assert_1.default.strictEqual(result.id, 30);
    }
    else {
        assert_1.default.fail(`expected a nodeDrop op failure, got ${JSON.stringify(result)}`);
    }
    assert_1.default.strictEqual(table.has(30), true, 'a rejected NODE_DROP must never actually drop the row');
    console.log('[unit] applyFrameToTableChecked rejects NODE_DROP of an attached row as precondition (§4.2) ok');
}
/**
 * frame-protocol.md §8 Stage 3 GATE — `MAX_ROWS` bounds table growth per session on the client's
 * defensive side; a `NODE_NEW` that would push a table already at the cap over it must fail
 * *before* the row is created (§8: "checked before any allocation"), not after.
 */
function testApplyFrameToTableCheckedEnforcesMaxRows() {
    const table = new replicatedTable_1.ReplicatedTable();
    for (let id = 2; id < 2 + limits_1.MAX_ROWS; id++)
        table.createLeafRow(id, opcodes_1.NodeKind.Text, 'x');
    assert_1.default.strictEqual(table.size, limits_1.MAX_ROWS, 'sanity: table pre-populated to exactly MAX_ROWS');
    const overflowId = 2 + limits_1.MAX_ROWS;
    const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
        { op: opcodes_1.OpCode.NodeNew, id: overflowId, kind: opcodes_1.NodeKind.Text, value: 'overflow' },
    ]);
    assert_1.default.strictEqual(result.ok, false, 'a NODE_NEW that would exceed MAX_ROWS must fail');
    if (!result.ok && result.opName !== 'check') {
        assert_1.default.strictEqual(result.reason, 'precondition', 'MAX_ROWS overflow is a precondition violation (§8)');
        assert_1.default.strictEqual(result.opName, 'nodeNew');
        assert_1.default.strictEqual(result.id, overflowId);
    }
    else {
        assert_1.default.fail(`expected a nodeNew op failure, got ${JSON.stringify(result)}`);
    }
    assert_1.default.strictEqual(table.has(overflowId), false, 'the rejected row must never actually be created');
    // A NODE_NEW that merely re-describes an id the table already has (e.g. a resync-adjacent
    // re-announce) must never be blocked by MAX_ROWS — the check only guards net-new growth.
    const existingId = 2;
    const reannounce = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
        { op: opcodes_1.OpCode.NodeNew, id: existingId, kind: opcodes_1.NodeKind.Text, value: 'still-x' },
    ]);
    assert_1.default.strictEqual(reannounce.ok, true, 'MAX_ROWS must not block re-describing an id the table already holds');
    console.log('[unit] applyFrameToTableChecked enforces MAX_ROWS on net-new rows only (§8) ok');
}
/**
 * PP-APPLY-3 / SEAL-DOM-P0-PHASE1 — §4 Pre falsifiers: failing op must not apply; prior ops in the
 * same frame stay (no rollback). One case per structural / node-state / CSSOM class.
 */
function testApplyFrameToTableCheckedPhase1Pres() {
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.Insert, parent: 99, before: 0, ids: [2] },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'insert');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
        assert_1.default.strictEqual(table.getRow(2).parent, 0, 'failed INSERT must not attach');
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
            { op: opcodes_1.OpCode.NodeNew, id: 3, kind: opcodes_1.NodeKind.Text, value: 't' },
            { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids: [2] },
            { op: opcodes_1.OpCode.Insert, parent: 2, before: 0, ids: [3] },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.Remove, parent: 1, ids: [3] },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'remove');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
        assert_1.default.strictEqual(table.getRow(3).parent, 2, 'failed REMOVE must not detach');
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Text, value: 't' },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.AttrSet, node: 2, attrs: [{ name: 'id', value: 'x' }] },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'attrSet');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.TextSet, node: 2, value: 'nope' },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'textSet');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.RuleSet, id: 2, text: 'a{}' },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'ruleSet');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            {
                op: opcodes_1.OpCode.SheetNew,
                id: 50,
                scope: frame_1.CSSOM_SCOPE_PIERCE_HOST,
                hostNode: 999,
                before: frame_1.INSERT_AT_END,
            },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'sheetNew');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
        assert_1.default.strictEqual(table.has(50), false, 'failed SHEET_NEW must not create a row');
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.SheetNew, id: 50, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        ]);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.RuleNew, sheet: 50, id: 51, before: 999, text: 'a{}' },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'ruleNew');
            assert_1.default.strictEqual(result.reason, 'precondition');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
        assert_1.default.strictEqual(table.has(51), false);
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        (0, replicatedTableApply_1.applyOpsToTable)(table, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        ]);
        const ids = new Array(limits_1.MAX_CHILDREN_PER_OP + 1).fill(2);
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.Insert, parent: 1, before: 0, ids },
        ]);
        assert_1.default.strictEqual(result.ok, false);
        if (!result.ok && result.opName !== 'check') {
            assert_1.default.strictEqual(result.opName, 'insert');
            assert_1.default.strictEqual(result.reason, 'malformed');
        }
        else
            assert_1.default.fail(JSON.stringify(result));
    }
    {
        const table = new replicatedTable_1.ReplicatedTable();
        const ok = (0, replicatedTableApply_1.applyFrameToTableChecked)(table, false, [
            { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
            { op: opcodes_1.OpCode.Insert, parent: 1, before: frame_1.INSERT_AT_END, ids: [2] },
        ]);
        assert_1.default.strictEqual(ok.ok, true, 'INSERT under Document id 1 remains valid');
        assert_1.default.strictEqual(table.getRow(2).parent, 1);
    }
    console.log('[unit] applyFrameToTableChecked §4 Pre falsifiers (PP-APPLY-3) ok');
}
function testNodeTableApplierDigestMatchesDirectApply() {
    const ops = [
        { op: opcodes_1.OpCode.NodeNew, id: 2, kind: opcodes_1.NodeKind.Element, ns: elementNs_1.ElementNs.Html, name: 'div', attrs: [] },
        { op: opcodes_1.OpCode.NodeNew, id: 3, kind: opcodes_1.NodeKind.Text, value: 'hi' },
        { op: opcodes_1.OpCode.Insert, parent: 1, before: frame_1.INSERT_AT_END, ids: [2] },
        { op: opcodes_1.OpCode.Insert, parent: 2, before: frame_1.INSERT_AT_END, ids: [3] },
    ];
    const frame = (0, frame_1.createFrame)({ generation: 1, sequence: 1, ops, preTableHash: 0n });
    const parts = new binaryFrameEncoder_1.BinaryFrameEncoder().encode(frame);
    assert_1.default.ok(parts.length >= 1, 'encoder must emit at least one part');
    const expected = new replicatedTable_1.ReplicatedTable();
    const direct = (0, replicatedTableApply_1.applyFrameToTableChecked)(expected, false, ops, 1);
    assert_1.default.strictEqual(direct.ok, true);
    const applier = new nodeTableApply_1.NodeTableApplier();
    for (const part of parts)
        applier.observeFrameBytes(part);
    assert_1.default.strictEqual(applier.lastApplyError, null);
    assert_1.default.strictEqual(applier.sequence, 1);
    assert_1.default.deepStrictEqual(applier.digest(), (0, tableDigest_1.digestReplicatedTable)(expected));
    applier.observeFrameBytes(new binaryFrameEncoder_1.BinaryFrameEncoder().encode((0, frame_1.createFrame)({
        generation: 1,
        sequence: 2,
        ops: [{ op: opcodes_1.OpCode.NodeDrop, ids: [999] }],
        preTableHash: expected.tableHash,
    }))[0]);
    assert_1.default.ok(applier.lastApplyError, 'absent NODE_DROP must fail apply');
    assert_1.default.strictEqual(applier.sequence, 1, 'failed apply must not advance sequence');
    console.log('[unit] NodeTableApplier digest matches direct applyFrameToTableChecked ok');
}
/** PP-APPLY-1 / SEAL-DOM-P0-FLUSH: mid-batch desync must not apply later frames. */
function testDomFrameApplierFlushStopsOnDesync() {
    const applied = [];
    const batch = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }];
    // Mirror DomFrameApplier.flush: onDesync resets; later frames must not run.
    const result = (0, applyBatch_1.applyFramesUntilDesync)(batch, (frame) => {
        if (frame.sequence === 1) {
            // desync on first frame (same as bad preTableHash) — production resets here
            return false;
        }
        applied.push(frame.sequence);
        return true;
    });
    assert_1.default.strictEqual(result.stoppedEarly, true);
    assert_1.default.strictEqual(result.lastIndex, 0);
    assert_1.default.strictEqual(applied.length, 0, 'PP-APPLY-1: no apply of later batch frames after mid-batch desync');
    const appliedOk = [];
    const allOk = (0, applyBatch_1.applyFramesUntilDesync)([{ sequence: 10 }, { sequence: 11 }], (frame) => {
        appliedOk.push(frame.sequence);
        return true;
    });
    assert_1.default.strictEqual(allOk.stoppedEarly, false);
    assert_1.default.deepStrictEqual(appliedOk, [10, 11]);
    console.log('[unit] DomFrameApplier flush stops on mid-batch desync (PP-APPLY-1) ok');
}
/** PP-APPLY-2 / SEAL-DOM-P0-ATTR: failed setAttribute must not be swallowed. */
function testApplyAttrPairsReportsFailure() {
    const calls = [];
    assert_1.default.strictEqual((0, attrApply_1.applyAttrPairs)((name, value) => {
        calls.push({ name, value });
    }, [
        { name: 'id', value: 'a' },
        { name: 'class', value: 'x' },
    ]), true);
    assert_1.default.strictEqual(calls.length, 2);
    assert_1.default.strictEqual(calls[0].name, 'id');
    assert_1.default.strictEqual(calls[1].name, 'class');
    const partial = [];
    assert_1.default.strictEqual((0, attrApply_1.applyAttrPairs)((name, value) => {
        if (name === 'bad')
            throw new Error('InvalidCharacterError');
        partial.push(`${name}=${value}`);
    }, [
        { name: 'ok', value: '1' },
        { name: 'bad', value: '2' },
        { name: 'never', value: '3' },
    ]), false, 'PP-APPLY-2: throw from setAttribute → false (callers desync)');
    assert_1.default.strictEqual(partial.length, 1);
    assert_1.default.strictEqual(partial[0], 'ok=1');
    console.log('[unit] applyAttrPairs reports setAttribute failure (PP-APPLY-2) ok');
}
/** PP-CSSOM-A-1 / SEAL-CSSOM-P0-RULESET: non-CSSStyleRule RULE_SET → desync plan. */
function testPlanRuleSetApplySealScope() {
    assert_1.default.strictEqual((0, cssomRuleSet_1.planRuleSetApply)(true).mode, 'styleDeclarations');
    assert_1.default.strictEqual((0, cssomRuleSet_1.planRuleSetApply)(false).mode, 'desync');
    console.log('[unit] planRuleSetApply CSSStyleRule-only seal (PP-CSSOM-A-1) ok');
}
function testLabBlueprintValidateCycleAndParallelSnap() {
    const cyclic = {
        id: 'cyclic',
        description: 'x',
        sessionPolicy: 'cold',
        queues: [
            {
                name: 'main',
                actions: [
                    { id: 'a', type: 'sleep', params: { ms: 1 }, dependsOn: ['b'] },
                    { id: 'b', type: 'sleep', params: { ms: 1 }, dependsOn: ['a'] },
                ],
            },
        ],
    };
    const c = (0, validate_1.validateBlueprint)(cyclic);
    assert_1.default.strictEqual(c.ok, false);
    const parallelSnap = {
        id: 'par',
        description: 'x',
        sessionPolicy: 'cold',
        queues: [
            {
                name: 'a',
                actions: [{ id: 's1', type: 'snap', params: { id: '1', cssom: 'scan' } }],
            },
            {
                name: 'b',
                actions: [{ id: 's2', type: 'snap', params: { id: '2', cssom: 'scan' } }],
            },
        ],
    };
    const p = (0, validate_1.validateBlueprint)(parallelSnap);
    assert_1.default.strictEqual(p.ok, false);
    console.log('[unit] lab blueprint validate cycle + parallel snap ok');
}
async function testLabBlueprintScheduleDependsAndAwaits() {
    const order = [];
    const bp = {
        id: 'sched',
        description: 'x',
        sessionPolicy: 'cold',
        queues: [
            {
                name: 'main',
                actions: [
                    { id: 'boot', type: 'sleep', params: { ms: 0 } },
                    { id: 'work', type: 'sleep', params: { ms: 0 }, dependsOn: ['boot'] },
                    { id: 'fold', type: 'fold', awaits: ['work', 'side'], params: { ruleset: 'soak' } },
                ],
            },
            {
                name: 'side',
                actions: [{ id: 'side', type: 'sleep', params: { ms: 0 }, dependsOn: ['boot'] }],
            },
        ],
    };
    const r = await (0, schedule_1.runBlueprintSchedule)(bp, {
        runAction: async (action) => {
            order.push(action.id);
            return { ok: true };
        },
    });
    assert_1.default.strictEqual(r.ok, true);
    assert_1.default.ok(order.indexOf('boot') < order.indexOf('work'));
    assert_1.default.ok(order.indexOf('boot') < order.indexOf('side'));
    assert_1.default.ok(order.indexOf('fold') > order.indexOf('work'));
    assert_1.default.ok(order.indexOf('fold') > order.indexOf('side'));
    console.log('[unit] lab blueprint schedule depends/awaits ok');
}
function testCssomFnvAndRuleDiff() {
    const a = (0, fnv32_1.fnv1a32)('color: red');
    const b = (0, fnv32_1.fnv1a32)('color: blue');
    assert_1.default.notStrictEqual(a, b);
    assert_1.default.strictEqual((0, fnv32_1.fnv1a32)('color: red'), a);
    const k1 = {};
    const k2 = {};
    const inplace = (0, cssomReconcile_1.diffRules)([{ key: k1, contentHash: a }], [{ key: k1, contentHash: b }]);
    assert_1.default.strictEqual(inplace.rulesTextChangedInPlace, 1);
    assert_1.default.strictEqual(inplace.rulesAppeared, 0);
    assert_1.default.strictEqual(inplace.rulesDisappeared, 0);
    assert_1.default.strictEqual(inplace.ruleListChanged, false);
    const replace = (0, cssomReconcile_1.diffRules)([{ key: k1, contentHash: a }], [{ key: k2, contentHash: a }]);
    assert_1.default.strictEqual(replace.ruleListChanged, true);
    assert_1.default.strictEqual(replace.rulesDisappeared, 1);
    assert_1.default.strictEqual(replace.rulesAppeared, 1);
    assert_1.default.strictEqual(replace.rulesTextChangedInPlace, 0);
    console.log('[unit] cssom fnv + rule diff ok');
}
function testCssomWalkSkipVsAbort() {
    assert_1.default.strictEqual((0, cssomWalk_1.shouldAbortSheet)(10, 9, 10), true, '90% stale aborts');
    assert_1.default.ok(cssomWalk_1.MASS_ABORT_STALE_FRACTION === 0.9);
    assert_1.default.strictEqual((0, cssomWalk_1.shouldAbortSheet)(10, 8, 10), false, 'below 90% is skip, not abort');
    assert_1.default.strictEqual((0, cssomWalk_1.shouldAbortSheet)(10, 0, 0), true, 'live length << copy aborts');
    assert_1.default.strictEqual((0, cssomWalk_1.shouldAbortSheet)(10, 0, 21), true, 'live length exploded aborts');
    const sheet = {};
    const live = [{ parentStyleSheet: sheet }];
    assert_1.default.strictEqual((0, cssomWalk_1.isRuleSlotLive)(live[0], sheet, live), true);
    assert_1.default.strictEqual((0, cssomWalk_1.isRuleSlotLive)({}, sheet, live), false, 'dead slot skipped');
    console.log('[unit] cssom walk skip vs abort ok');
}
/** SEAL-CSSOM-P1-IDSPACE — Sheet/Rule ids share the session mint; no high-bit Cssom range. */
function testSessionIdsSharedDomAndCssom() {
    let next = 2;
    const mint = () => {
        const id = next;
        next += 1;
        return id;
    };
    const ids = new cssomIds_1.CssomIds(mint);
    const firstDom = mint();
    const sheet = {};
    const rule = {};
    const sheetId = ids.idOfSheet(sheet);
    const ruleId = ids.idOfRule(rule);
    assert_1.default.strictEqual(firstDom, 2, 'allocator starts at 2 (Document is 1)');
    assert_1.default.strictEqual(sheetId, 3);
    assert_1.default.strictEqual(ruleId, 4);
    assert_1.default.strictEqual(ids.idOfSheet(sheet), 3, 'same sheet object keeps id');
    assert_1.default.ok(sheetId < 0x80000000, 'Cssom must not reserve the pre-V4 high-bit range');
    assert_1.default.ok(ruleId < 0x80000000);
    console.log('[unit] session ids shared DOM+CSSOM (SEAL-CSSOM-P1-IDSPACE) ok');
}
function testCssomOpsAndTableApply() {
    class CSSStyleRule {
    }
    const ids = new cssomIds_1.CssomIds();
    const sheet = {};
    const r1 = new CSSStyleRule();
    const r2 = new CSSStyleRule();
    const texts = new Map([
        [r1, 'a { color: red }'],
        [r2, 'b { color: blue }'],
    ]);
    const snaps = [
        { key: r1, contentHash: 1 },
        { key: r2, contentHash: 2 },
    ];
    const resync = (0, cssomOps_1.emitResyncCssomOps)(ids, [{ sheet, snaps, texts }]);
    assert_1.default.strictEqual(resync[0]?.op, opcodes_1.OpCode.SheetNew);
    assert_1.default.strictEqual(resync[1]?.op, opcodes_1.OpCode.RuleNew);
    assert_1.default.strictEqual(resync[2]?.op, opcodes_1.OpCode.RuleNew);
    assert_1.default.strictEqual(resync[0].id, 2);
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, resync);
    const sheetId = ids.peekSheet(sheet);
    const ruleId = ids.peekRule(r1);
    assert_1.default.strictEqual(table.getRow(sheetId)?.kind, opcodes_1.NodeKind.Sheet);
    assert_1.default.strictEqual(table.getRow(ruleId)?.kind, opcodes_1.NodeKind.Rule);
    assert_1.default.deepStrictEqual(table.orderedChildIds(sheetId), [ids.peekRule(r1), ids.peekRule(r2)]);
    const live = (0, cssomOps_1.emitLiveCssomOps)(ids, [sheet], [{ sheet, snaps: [{ key: r1, contentHash: 3 }], texts: new Map([[r1, 'a { color: green }']]) }], new WeakMap([[sheet, snaps]]));
    assert_1.default.ok(live.some((op) => op.op === opcodes_1.OpCode.RuleDrop));
    assert_1.default.ok(live.some((op) => op.op === opcodes_1.OpCode.RuleSet));
    (0, replicatedTableApply_1.applyOpsToTable)(table, live);
    assert_1.default.deepStrictEqual(table.orderedChildIds(sheetId), [ids.peekRule(r1)]);
    const r3 = {};
    const r4 = {};
    const grown = (0, cssomOps_1.emitLiveCssomOps)(ids, [sheet], [
        {
            sheet,
            snaps: [
                { key: r1, contentHash: 3 },
                { key: r3, contentHash: 4 },
                { key: r4, contentHash: 5 },
            ],
            texts: new Map([
                [r1, 'a { color: green }'],
                [r3, 'c {}'],
                [r4, 'd {}'],
            ]),
        },
    ], new WeakMap([[sheet, [{ key: r1, contentHash: 3 }]]]));
    for (const op of grown) {
        if (op.op !== opcodes_1.OpCode.RuleNew)
            continue;
        const before = op.before;
        assert_1.default.ok(before === frame_1.INSERT_AT_END || table.has(before), `RULE_NEW must not use a ghost before=${before}`);
    }
    (0, replicatedTableApply_1.applyOpsToTable)(table, grown);
    assert_1.default.deepStrictEqual(table.orderedChildIds(sheetId), [
        ids.peekRule(r1),
        ids.peekRule(r3),
        ids.peekRule(r4),
    ]);
    const aborted = (0, cssomOps_1.emitLiveCssomOps)(ids, [sheet], [{ sheet, snaps, texts, skipOps: true }], new WeakMap([[sheet, [{ key: r1, contentHash: 3 }]]]));
    assert_1.default.ok(!aborted.some((op) => op.op === opcodes_1.OpCode.SheetDrop), 'abort must not DROP the sheet');
    assert_1.default.ok(!aborted.some((op) => op.op === opcodes_1.OpCode.RuleDrop || op.op === opcodes_1.OpCode.RuleNew));
    console.log('[unit] cssom ops + table apply ok');
}
/** Producer: grouping-rule content change → DROP+NEW (not RULE_SET). Table: old id gone, new text on new id. */
function testCssomGroupingContentChangeEmitsDropNew() {
    class CSSMediaRule {
    }
    class CSSStyleRule {
    }
    assert_1.default.strictEqual((0, cssomRuleSet_1.ruleAcceptsInPlaceSet)(new CSSStyleRule()), true);
    assert_1.default.strictEqual((0, cssomRuleSet_1.ruleAcceptsInPlaceSet)(new CSSMediaRule()), false);
    const ids = new cssomIds_1.CssomIds();
    const sheet = {};
    const media = new CSSMediaRule();
    const texts = new Map([[media, '@media (max-width: 1px){.a{color:red}}']]);
    const snaps = [{ key: media, contentHash: 1 }];
    const resync = (0, cssomOps_1.emitResyncCssomOps)(ids, [{ sheet, snaps, texts }]);
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, resync);
    const sheetId = ids.peekSheet(sheet);
    const oldId = ids.peekRule(media);
    assert_1.default.strictEqual(table.getRow(oldId)?.kind, opcodes_1.NodeKind.Rule);
    assert_1.default.strictEqual(table.getRow(oldId)?.contentHash, (0, rowHash_1.hashValue)('@media (max-width: 1px){.a{color:red}}'));
    const nextText = '@media (max-width: 2px){.a{color:blue}}';
    const live = (0, cssomOps_1.emitLiveCssomOps)(ids, [sheet], [{ sheet, snaps: [{ key: media, contentHash: 2 }], texts: new Map([[media, nextText]]) }], new WeakMap([[sheet, snaps]]));
    assert_1.default.ok(!live.some((op) => op.op === opcodes_1.OpCode.RuleSet), 'grouping content change must not RULE_SET');
    assert_1.default.ok(live.some((op) => op.op === opcodes_1.OpCode.RuleDrop));
    assert_1.default.ok(live.some((op) => op.op === opcodes_1.OpCode.RuleNew));
    const newId = ids.peekRule(media);
    assert_1.default.notStrictEqual(newId, oldId, 'replace allocates a new id');
    (0, replicatedTableApply_1.applyOpsToTable)(table, live);
    assert_1.default.strictEqual(table.getRow(oldId), undefined, 'old rule id gone after DROP');
    assert_1.default.strictEqual(table.getRow(newId)?.kind, opcodes_1.NodeKind.Rule);
    assert_1.default.strictEqual(table.getRow(newId)?.contentHash, (0, rowHash_1.hashValue)(nextText));
    assert_1.default.deepStrictEqual(table.orderedChildIds(sheetId), [newId]);
    console.log('[unit] cssom grouping content change DROP+NEW + table parity (PP-CSSOM-A-1) ok');
}
function testCssomApplyIndex() {
    const a = 80;
    const b = 81;
    const c = 82;
    assert_1.default.strictEqual((0, cssomApplyIndex_1.insertIndexFromBefore)([], frame_1.INSERT_AT_END), 0);
    assert_1.default.strictEqual((0, cssomApplyIndex_1.insertIndexFromBefore)([a], frame_1.INSERT_AT_END), 1);
    assert_1.default.strictEqual((0, cssomApplyIndex_1.insertIndexFromBefore)([a, c], b), -1);
    assert_1.default.strictEqual((0, cssomApplyIndex_1.insertIndexFromBefore)([a, c], c), 1);
    assert_1.default.strictEqual((0, cssomApplyIndex_1.insertIndexFromBefore)([a, c], a), 0);
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.SheetNew, id: a, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        { op: opcodes_1.OpCode.SheetNew, id: b, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
    ]);
    assert_1.default.deepStrictEqual((0, cssomApplyIndex_1.orderedSheetIds)(table), [a, b]);
    assert_1.default.strictEqual((0, cssomApplyIndex_1.declarationBlockFromRuleText)('.app{background:#161310;color:#f3ead8}'), 'background:#161310;color:#f3ead8');
    assert_1.default.strictEqual((0, cssomApplyIndex_1.declarationBlockFromRuleText)('color:red'), 'color:red');
    console.log('[unit] cssom apply index ok');
}
/** PP-CSSOM-A-3 / SEAL-CSSOM-P0-EOF: end-of-frame sheet+rule membership/order. */
function testCssomEndOfFrameMatch() {
    const sheet = 100;
    const r1 = 101;
    const r2 = 102;
    const table = new replicatedTable_1.ReplicatedTable();
    (0, replicatedTableApply_1.applyOpsToTable)(table, [
        { op: opcodes_1.OpCode.SheetNew, id: sheet, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        { op: opcodes_1.OpCode.RuleNew, sheet, id: r1, before: frame_1.INSERT_AT_END, text: '.a{}' },
        { op: opcodes_1.OpCode.RuleNew, sheet, id: r2, before: frame_1.INSERT_AT_END, text: '.b{}' },
    ]);
    assert_1.default.deepStrictEqual((0, cssomApplyIndex_1.orderedRuleIds)(table, sheet), [r1, r2]);
    const tableSheets = (0, cssomApplyIndex_1.orderedSheetIds)(table);
    const tableRules = new Map([[sheet, (0, cssomApplyIndex_1.orderedRuleIds)(table, sheet)]]);
    const ok = (0, cssomApplyIndex_1.matchCssomEndOfFrame)(tableSheets, tableRules, new Set([sheet]), new Map([[sheet, [r1, r2]]]));
    assert_1.default.strictEqual(ok.ok, true);
    const missSheet = (0, cssomApplyIndex_1.matchCssomEndOfFrame)(tableSheets, tableRules, new Set(), new Map());
    assert_1.default.strictEqual(missSheet.ok, false);
    if (!missSheet.ok) {
        assert_1.default.strictEqual(missSheet.op, 'sheetNew');
        assert_1.default.strictEqual(missSheet.id, sheet);
    }
    const missRule = (0, cssomApplyIndex_1.matchCssomEndOfFrame)(tableSheets, tableRules, new Set([sheet]), new Map([[sheet, [r1]]]));
    assert_1.default.strictEqual(missRule.ok, false);
    if (!missRule.ok) {
        assert_1.default.strictEqual(missRule.op, 'ruleNew');
        assert_1.default.strictEqual(missRule.id, r2);
    }
    const badOrder = (0, cssomApplyIndex_1.matchCssomEndOfFrame)(tableSheets, tableRules, new Set([sheet]), new Map([[sheet, [r2, r1]]]));
    assert_1.default.strictEqual(badOrder.ok, false);
    if (!badOrder.ok) {
        assert_1.default.strictEqual(badOrder.op, 'ruleOrder');
        assert_1.default.strictEqual(badOrder.id, r1);
    }
    console.log('[unit] cssom end-of-frame match (PP-CSSOM-A-3) ok');
}
function testCssomEncodeDecode() {
    const ops = [
        { op: opcodes_1.OpCode.SheetNew, id: 2, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        { op: opcodes_1.OpCode.RuleNew, sheet: 2, id: 3, before: frame_1.INSERT_AT_END, text: '.x { color: red }' },
        { op: opcodes_1.OpCode.RuleSet, id: 3, text: '.x { color: blue }' },
        { op: opcodes_1.OpCode.SheetOrder, ids: [2] },
    ];
    const frame = (0, frame_1.createFrame)({ generation: 1, sequence: 1, ops, preTableHash: 0n });
    const bytes = new binaryFrameEncoder_1.BinaryFrameEncoder().encode(frame)[0];
    const decoded = (0, decode_1.decodeFramePart)(bytes, new decode_1.PersistentStringTable());
    assert_1.default.ok(decoded.ok, 'cssom frame must decode');
    if (!decoded.ok)
        return;
    assert_1.default.deepStrictEqual(decoded.part.ops, ops);
    const spliced = (0, frame_1.spliceCssomBeforeCheck)([{ op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 1n }], ops);
    assert_1.default.strictEqual(spliced[spliced.length - 1]?.op, opcodes_1.OpCode.Check);
    assert_1.default.strictEqual(spliced[0]?.op, opcodes_1.OpCode.SheetNew);
    console.log('[unit] cssom encode/decode + splice before CHECK ok');
}
function testHostileHonestyFramesEncodeDecode() {
    const attr = (0, decode_1.decodeFramePart)((0, hostileFrames_1.encodeAttrDesyncFrame)(1, 2, 99n), new decode_1.PersistentStringTable());
    assert_1.default.ok(attr.ok, 'ATTR hostile frame must decode');
    if (!attr.ok)
        return;
    const nodeNew = attr.part.ops[0];
    assert_1.default.strictEqual(nodeNew?.op, opcodes_1.OpCode.NodeNew);
    if (nodeNew?.op !== opcodes_1.OpCode.NodeNew)
        return;
    assert_1.default.strictEqual(nodeNew.kind, opcodes_1.NodeKind.Element);
    assert_1.default.strictEqual(nodeNew.attrs[0]?.name, 'foo bar');
    const ruleset = (0, decode_1.decodeFramePart)((0, hostileFrames_1.encodeRulesetDesyncFrame)(1, 2, 99n), new decode_1.PersistentStringTable());
    assert_1.default.ok(ruleset.ok, 'RULESET hostile frame must decode');
    if (!ruleset.ok)
        return;
    const sheet = ruleset.part.ops[0];
    const last = ruleset.part.ops[ruleset.part.ops.length - 1];
    assert_1.default.strictEqual(sheet?.op, opcodes_1.OpCode.SheetNew);
    if (sheet?.op !== opcodes_1.OpCode.SheetNew)
        return;
    assert_1.default.strictEqual(sheet.hostNode, 0, 'constructed SHEET_NEW hostNode must be 0');
    assert_1.default.strictEqual(last?.op, opcodes_1.OpCode.RuleSet);
    if (last?.op !== opcodes_1.OpCode.RuleSet)
        return;
    assert_1.default.ok(last.text.includes('@media'), 'RULE_SET must target the grouping rule text');
    const eof = (0, decode_1.decodeFramePart)((0, hostileFrames_1.encodeEofSetupFrame)(1, 2, 99n), new decode_1.PersistentStringTable());
    assert_1.default.ok(eof.ok, 'EOF setup frame must decode');
    if (!eof.ok)
        return;
    const eofSheet = eof.part.ops[0];
    const eofRule = eof.part.ops[1];
    assert_1.default.strictEqual(eofSheet?.op, opcodes_1.OpCode.SheetNew);
    if (eofSheet?.op !== opcodes_1.OpCode.SheetNew)
        return;
    assert_1.default.strictEqual(eofSheet.hostNode, 0, 'EOF constructed SHEET_NEW hostNode must be 0');
    assert_1.default.strictEqual(eofRule?.op, opcodes_1.OpCode.RuleNew);
    if (eofRule?.op !== opcodes_1.OpCode.RuleNew)
        return;
    assert_1.default.ok(eofRule.text.includes('.lab-eof'), 'EOF setup must insert a style rule');
    console.log('[unit] hostile honesty frames encode/decode (hostNode=0, foo bar, RULE_SET @media) ok');
}
function testCssomPollTelemetrySchema() {
    const hist = (0, telemetry_1.countCssomOps)([
        { op: opcodes_1.OpCode.SheetNew, id: 2, scope: frame_1.CSSOM_SCOPE_MAIN, hostNode: 0, before: frame_1.INSERT_AT_END },
        { op: opcodes_1.OpCode.RuleNew, sheet: 2, id: 3, before: frame_1.INSERT_AT_END, text: '.x{}' },
        { op: opcodes_1.OpCode.RuleSet, id: 3, text: '.x{color:red}' },
        { op: opcodes_1.OpCode.Check, scope: frame_1.CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 0n },
    ]);
    assert_1.default.strictEqual(hist.opCount, 3);
    assert_1.default.strictEqual(hist.opSheetNew, 1);
    assert_1.default.strictEqual(hist.opRuleNew, 1);
    assert_1.default.strictEqual(hist.opRuleSet, 1);
    assert_1.default.strictEqual(hist.opSheetDrop, 0);
    const stamped = (0, telemetry_1.stampCssomPoll)((0, telemetry_1.emptyCssomPollStats)(), {
        source: 'resync',
        sequence: 1,
        sheetsAborted: 2,
        slotsSkipped: 4,
        ...hist,
    });
    const json = JSON.parse(JSON.stringify(stamped));
    for (const key of telemetry_1.CSSOM_POLL_STAT_KEYS) {
        assert_1.default.ok(Object.prototype.hasOwnProperty.call(json, key), `cssomPoll JSON missing ${key}`);
        assert_1.default.notStrictEqual(json[key], undefined, `cssomPoll ${key} must not be skip-if-absent`);
    }
    assert_1.default.strictEqual(json.source, 'resync');
    assert_1.default.strictEqual(json.sequence, 1);
    console.log('[unit] cssom poll telemetry schema ok');
}
async function main() {
    // Debug instrumentation posts to the ingest server; don't hang unit runs on it.
    globalThis.fetch = (async () => new Response('{}', { status: 204 }));
    testDomainMatch();
    testScriptTargetRuleMatch();
    testPermissiveMainFrameCspRewrite();
    testViewportBounds();
    testResolveDeviceProfileDefaults();
    await testApplyLogicalViewportUsesBoundsAndMetrics();
    await testProveLogicalViewportUsesCssLayoutMetrics();
    testBuildChromeArgsIncludesWebglSpoof();
    testKitStealthInitSource();
    await testWorkerTargetStealthAutoAttach();
    await testScreencastRestartThrowsAfterStop();
    testLaunchEnvironmentIsRequired();
    testScreencastEncodeSize();
    await testScreencastAcceptsCssOrEncodeJpeg();
    testTouchEmulationParams();
    testStopDoesNotEnqueueCrash();
    testUnexpectedContextCloseEnqueuesCrash();
    testRecreateKeepsOpenAcrossStaleClose();
    await testStopKeepsBridgeQueuesOpen();
    testBenignBrowserRaceNarrow();
    await testAbortDoesNotStealQueuedCrash();
    testDropOldestQueueTracksDroppedCount();
    testDropAllOnOverflowForSequencedDiffs();
    await testTryWriteFrontPreservesFifoAsync();
    await testTryWriteFrontRejectsWhenFull();
    await testPumpQueueAwaitsDrainWithoutSkipping();
    await testPumpQueueAbortRequeuesFront();
    await testPumpQueueAbortAfterWriteDoesNotRequeue();
    await testEventBridgeQueueDroppedLifecycle();
    await testPermissionClearRespectsEpoch();
    testLogicalToDeviceTransform();
    testKeycodeResolve();
    testXorgInputIsolationFlags();
    testIoctlKoffiPrototype();
    await testInputFireAndForgetAndMoveCoalesce();
    await testInputKeyDefsIncludeEditingKeys();
    await testTouchMoveCoalesceAndStormWrites();
    await testInputMousePressReleaseOrdered();
    await testInputPendingCountIncludesChainDepth();
    await testTelemetryToggleOmission();
    await testTelemetryQueuesReportInputDepthAndDrops();
    await testTelemetryFaultStateSurvivesCrashConsumption();
    await testTelemetryAllocationsSummaryAndSessions();
    testHostResourcesApplySkipsRemountOffLinux();
    testCookieSanitizeMatrix();
    testDomAssetCache();
    testDomAssetCacheRespectsByteCap();
    await testBrowserPoolWarmUpAndAcquire();
    testBrowserPoolRefillThrottle();
    await testBrowserPoolExhaustionFallsBackToOnDemandLaunch();
    await testBrowserPoolRegistryPolicy();
    testSrcsetParseCloudinary();
    testParseDataUrlHardening();
    testRowHashPrimitives();
    testTableHashTrackerOrderIndependence();
    testReplicatedTableRowContentHash();
    testReplicatedTableTopologyRepair();
    testReplicatedTableInsertBeforeNextSiblingRepair();
    testReplicatedTablePrependEvictDerivedLinks();
    testTableLiveOracle();
    testDomO2IgnoresSheetRows();
    testCssomTableLiveOracle();
    testReplicatedTableApplyOpsParity();
    testReplicatedTableResyncWholesaleReplace();
    testApplyFrameToTableCheckedAcceptsValidFrame();
    testApplyFrameToTableCheckedRejectsCorruptedCheck();
    testApplyFrameToTableCheckedRangeScope();
    testCheckScopeRangeEncodeDecode();
    testNodeNewElementNsWire();
    testStructuralDiffNsMismatch();
    testApplyFrameToTableCheckedDoesNotRollBackPriorOps();
    testEpochResetClearsReplicatedTable();
    testNodeDropRemovesSubtreeAndDescendants();
    testCollectDroppableIdsAgeAndLimitBound();
    testCollectDroppableIdsExcludesSameTickReattach();
    testApplyFrameToTableCheckedRejectsNodeDropAbsentId();
    testApplyFrameToTableCheckedRejectsNodeDropAttachedId();
    testApplyFrameToTableCheckedEnforcesMaxRows();
    testApplyFrameToTableCheckedPhase1Pres();
    testNodeTableApplierDigestMatchesDirectApply();
    testDomFrameApplierFlushStopsOnDesync();
    testApplyAttrPairsReportsFailure();
    testPlanRuleSetApplySealScope();
    testLabBlueprintValidateCycleAndParallelSnap();
    await testLabBlueprintScheduleDependsAndAwaits();
    testCssomFnvAndRuleDiff();
    testCssomWalkSkipVsAbort();
    testSessionIdsSharedDomAndCssom();
    testCssomOpsAndTableApply();
    testCssomGroupingContentChangeEmitsDropNew();
    testCssomApplyIndex();
    testCssomEndOfFrameMatch();
    testCssomEncodeDecode();
    testHostileHonestyFramesEncodeDecode();
    testCssomPollTelemetrySchema();
    await (0, page_unit_1.runPageProjectionUnitTests)();
    await (0, v4ProjectionSession_unit_1.runV4ProjectionSessionUnitTests)();
    console.log('[unit] all passed');
}
function testSrcsetParseCloudinary() {
    const raw = 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, '
        + 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w';
    const parsed = (0, srcsetParse_1.parseSrcset)(raw);
    assert_1.default.deepStrictEqual(parsed, [
        {
            url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg',
            descriptor: '1920w',
        },
        {
            url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg',
            descriptor: '800w',
        },
    ]);
    const mapped = (0, srcsetParse_1.mapSrcset)(raw, (u) => `/w7s/virtual-assets/${u}`);
    assert_1.default.ok(mapped.includes('f_avif,q_auto,w_1920'));
    assert_1.default.ok(!mapped.includes('/f_avif 1920w'));
    console.log('[unit] srcsetParse Cloudinary ok');
}
function testParseDataUrlHardening() {
    const png = 'data:image/png;charset=utf-8;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const ok = (0, parseDataUrl_1.parseDataUrl)(png);
    assert_1.default.ok(ok, 'charset before base64 must parse');
    assert_1.default.ok(ok.body.length > 0);
    assert_1.default.ok(ok.contentType.includes('image/png'));
    assert_1.default.strictEqual((0, parseDataUrl_1.parseDataUrl)('data:image/png;base64'), null, 'missing comma must fail');
    assert_1.default.strictEqual((0, parseDataUrl_1.parseDataUrl)('not-a-data-url'), null);
    assert_1.default.strictEqual((0, parseDataUrl_1.parseDataUrl)('data:text/plain,hello')?.body.toString('utf8'), 'hello');
    console.log('[unit] parseDataUrl hardening contract ok');
}
function testDomAssetCache() {
    const cache = new DomAssetCache_1.DomAssetCache(1024, 2);
    const a = cache.put('k1', Buffer.from('aaa'), 'text/css');
    const b = cache.put('k2', Buffer.from('bbb'), 'image/png');
    assert_1.default.ok(a);
    assert_1.default.ok(b);
    assert_1.default.strictEqual(cache.get('k1')?.contentType, 'text/css');
    const c = cache.put('k3', Buffer.from('ccc'), 'font/woff2');
    assert_1.default.ok(c);
    assert_1.default.strictEqual(cache.size, 2);
    assert_1.default.strictEqual(cache.get('k1'), undefined);
    console.log('[unit] DomAssetCache put/get/LRU ok');
}
/** PP-ASSET-4 — the L1 cache must respect its LRU byte cap, not just entry count. */
function testDomAssetCacheRespectsByteCap() {
    const cache = new DomAssetCache_1.DomAssetCache(10, 100); // byte cap of 10, generous entry count
    cache.put('a', Buffer.from('aaaa'), 'text/css'); // 4 bytes, total 4
    cache.put('b', Buffer.from('bbbb'), 'text/css'); // 4 bytes, total 8
    assert_1.default.strictEqual(cache.currentBytes, 8);
    assert_1.default.ok(cache.get('a'), 'a survives under the byte cap');
    assert_1.default.ok(cache.get('b'), 'b survives under the byte cap');
    cache.put('c', Buffer.from('cccc'), 'text/css'); // 4 bytes, total would be 12 > 10 → evict oldest
    assert_1.default.strictEqual(cache.get('a'), undefined, 'oldest entry evicted once the byte cap is exceeded');
    assert_1.default.ok(cache.get('b'), 'b still present');
    assert_1.default.ok(cache.get('c'), 'c still present');
    assert_1.default.ok(cache.currentBytes <= 10, `currentBytes ${cache.currentBytes} must respect the 10-byte cap`);
    // Re-putting an existing key must not double-count its bytes nor leak its old hash.
    const cache2 = new DomAssetCache_1.DomAssetCache(1024, 100);
    const hash1 = cache2.put('k', Buffer.from('x'), 'text/plain');
    const hash2 = cache2.put('k', Buffer.from('yy'), 'text/plain');
    assert_1.default.strictEqual(cache2.currentBytes, 2, 'replacing a key must replace its byte accounting, not add to it');
    assert_1.default.strictEqual(cache2.size, 1);
    assert_1.default.ok(hash1 && hash2 && hash1 !== hash2);
    assert_1.default.strictEqual(cache2.getByHash(hash1), undefined, 'stale hash of a replaced key must not resolve');
    assert_1.default.ok(cache2.getByHash(hash2), 'current hash must resolve');
    console.log('[unit] DomAssetCache respects byte cap ok');
}
/** WP13 §5.13 — pre-warmed pool: warm-up, throttled refill, and destroy-on-release (PP-SESS-2). */
async function testBrowserPoolWarmUpAndAcquire() {
    const { BrowserPool } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/BrowserPool')));
    let launches = 0;
    const closedProcesses = [];
    const closedContexts = [];
    const launch = async () => {
        const id = ++launches;
        return {
            newContext: async () => ({
                close: async () => {
                    closedContexts.push(id);
                },
            }),
            close: async () => {
                closedProcesses.push(id);
            },
        };
    };
    const pool = new BrowserPool({ size: 2, refillPerSec: 1000, launch });
    await pool.warmUp();
    assert_1.default.strictEqual(pool.availableCount, 2, 'warmUp must pre-warm to size');
    assert_1.default.strictEqual(launches, 2);
    const acquired = await pool.acquire();
    await acquired.release();
    // Released id 1 proves acquire() handed out the first pre-warmed instance
    // (ids assigned in launch order) rather than launching a fresh one.
    assert_1.default.deepStrictEqual(closedContexts, [1], 'acquire must consume a pre-warmed instance, not launch a new one');
    assert_1.default.deepStrictEqual(closedProcesses, [1], 'release must destroy the process — never recycle (PP-SESS-2)');
    // Refill throttle: fast refillPerSec here means the opportunistic refill on
    // acquire should have already replenished back toward size.
    for (let i = 0; i < 20 && pool.availableCount < 2; i++)
        await Promise.resolve();
    assert_1.default.strictEqual(pool.availableCount, 2, 'pool must refill back toward size after a consuming acquire');
    await pool.dispose();
    console.log('[unit] BrowserPool warm-up + acquire + destroy-on-release ok');
}
/** tryRefill must honor the refillPerSec throttle using an injectable clock — no real timers. */
function testBrowserPoolRefillThrottle() {
    const { BrowserPool } = require('./browser/patchright/BrowserPool');
    let launches = 0;
    let clock = 0;
    const launch = async () => {
        launches++;
        return { newContext: async () => ({ close: async () => { } }), close: async () => { } };
    };
    const pool = new BrowserPool({ size: 5, refillPerSec: 2, launch, now: () => clock }); // 500ms min interval
    assert_1.default.strictEqual(pool.tryRefill(), true, 'first refill always allowed');
    assert_1.default.strictEqual(pool.tryRefill(), false, 'immediate second refill must be throttled');
    clock += 499;
    assert_1.default.strictEqual(pool.tryRefill(), false, 'just under the interval must still be throttled');
    clock += 2;
    assert_1.default.strictEqual(pool.tryRefill(), true, 'past the interval must allow another refill');
    console.log('[unit] BrowserPool refill throttle (injectable clock) ok');
}
/** Pool exhaustion must fall back to an on-demand launch rather than reusing an instance. */
async function testBrowserPoolExhaustionFallsBackToOnDemandLaunch() {
    const { BrowserPool } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/BrowserPool')));
    let launches = 0;
    const launch = async () => {
        launches++;
        return { newContext: async () => ({ close: async () => { } }), close: async () => { } };
    };
    const pool = new BrowserPool({ size: 0, refillPerSec: 1, launch });
    assert_1.default.strictEqual(pool.availableCount, 0);
    const a = await pool.acquire();
    assert_1.default.strictEqual(launches, 1, 'exhausted pool must launch on demand rather than block or reuse');
    await a.release();
    console.log('[unit] BrowserPool exhaustion falls back to on-demand launch ok');
}
/**
 * BrowserPoolRegistry policy (§5.13 wiring): size 0 must never touch the launch factory,
 * a first successful acquire must geometry-lock the singleton pool, a later request for a
 * different geometry must miss (never a wrong-sized Display), and release must destroy the
 * underlying process — never recycle (PP-SESS-2).
 */
async function testBrowserPoolRegistryPolicy() {
    const { BrowserPoolRegistry } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/BrowserPoolRegistry')));
    const { DisplayAllocator } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Display')));
    let launches = 0;
    const closedProcesses = [];
    const launchFactory = async () => {
        const id = ++launches;
        return {
            newContext: async () => ({ close: async () => { } }),
            close: async () => {
                closedProcesses.push(id);
            },
        };
    };
    const registry = new BrowserPoolRegistry(launchFactory);
    const displays = new DisplayAllocator();
    const disabled = await registry.tryAcquire({
        size: 0,
        refillPerSec: 1000,
        maxWidth: 800,
        maxHeight: 600,
        displays,
    });
    assert_1.default.strictEqual(disabled, null, 'size 0 must disable pooling entirely');
    assert_1.default.strictEqual(launches, 0, 'size 0 must never invoke the launch factory');
    const first = await registry.tryAcquire({
        size: 2,
        refillPerSec: 1000,
        maxWidth: 800,
        maxHeight: 600,
        displays,
    });
    // The very first acquire races an unawaited warmUp() — it may consume a pre-warmed
    // instance or trigger its own on-demand launch; either way, correctness holds.
    assert_1.default.notStrictEqual(first, null, 'first request must acquire (pre-warmed or on-demand)');
    assert_1.default.ok(launches >= 2, `pool creation must have launched at least size instances (got ${launches})`);
    const mismatched = await registry.tryAcquire({
        size: 2,
        refillPerSec: 1000,
        maxWidth: 1024,
        maxHeight: 768,
        displays,
    });
    assert_1.default.strictEqual(mismatched, null, 'a different max viewport than the geometry-locked pool must miss, not resize');
    await first.release();
    assert_1.default.strictEqual(closedProcesses.length, 1, 'release must destroy exactly the acquired process — never recycle (PP-SESS-2)');
    const second = await registry.tryAcquire({
        size: 2,
        refillPerSec: 1000,
        maxWidth: 800,
        maxHeight: 600,
        displays,
    });
    assert_1.default.notStrictEqual(second, null, 'matching geometry must keep hitting the same locked pool');
    await second.release();
    await registry.disposeForTests();
    console.log('[unit] BrowserPoolRegistry geometry-lock + fallback + destroy-on-release ok');
}
function testCookieSanitizeMatrix() {
    const dirty = {
        name: 'sf_marker',
        value: 'state-cookie',
        domain: 'fixture.test',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: '',
    };
    const clean = (0, PageState_1.sanitizeCookieForCdp)(dirty);
    assert_1.default.ok(clean);
    assert_1.default.strictEqual(clean.name, 'sf_marker');
    assert_1.default.strictEqual('expires' in clean, false);
    assert_1.default.strictEqual('sameSite' in clean, false);
    const ms = (0, PageState_1.sanitizeCookieForCdp)({
        name: 'ms',
        value: 'v',
        domain: 'd.com',
        path: '/',
        expires: 1_700_000_000_000,
    });
    assert_1.default.strictEqual(ms.expires, 1_700_000_000);
    const none = (0, PageState_1.sanitizeCookieForCdp)({
        name: 'x',
        value: '1',
        domain: 'd.com',
        path: '/',
        secure: false,
        sameSite: 'none',
    });
    assert_1.default.strictEqual(none.sameSite, 'None');
    assert_1.default.strictEqual(none.secure, true);
    assert_1.default.strictEqual((0, PageState_1.sanitizeCookieForCdp)({
        name: '',
        value: '1',
        domain: 'd.com',
        path: '/',
    }), null);
    const batch = (0, PageState_1.sanitizeCookieBatch)([
        { name: 'good', value: '1', domain: 'd.com', path: '/' },
        { name: '', value: 'bad', domain: 'd.com', path: '/' },
        { name: 'ok', value: '2', domain: 'd.com', path: '/', sameSite: 'LAX', expires: -1 },
    ]);
    assert_1.default.strictEqual(batch.valid.length, 2);
    assert_1.default.strictEqual(batch.skippedCount, 1);
    assert_1.default.ok(batch.normalizedCount >= 1);
    console.log('[unit] cookie sanitize ok');
}
function testHostResourcesApplySkipsRemountOffLinux() {
    if (process.platform === 'linux') {
        console.log('[unit] host resources remount skip (linux — exercised in container)');
        return;
    }
    const result = (0, hostResources_1.applyHostResources)({
        shmSizeBytes: 4 * 1024 * 1024 * 1024,
        raiseUlimits: true,
        nofile: 4096,
        nproc: 1024,
    });
    assert_1.default.ok(result.warnings.some((w) => /shm remount skipped/i.test(w)));
    assert_1.default.strictEqual(result.ulimitsRaised, false);
    console.log('[unit] host resources apply skip off-linux ok');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=unit.js.map