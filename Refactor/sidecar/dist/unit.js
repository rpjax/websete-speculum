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
const EventBridge_1 = require("./host/EventBridge");
const DropOldestQueue_1 = require("./host/DropOldestQueue");
const browserRace_1 = require("./host/browserRace");
const PageState_1 = require("./browser/patchright/PageState");
const collectTelemetry_1 = require("./telemetry/collectTelemetry");
const hostResources_1 = require("./host/hostResources");
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
    assert_1.default.ok(hwSource.includes('webglVendor') || hwSource.includes('UNMASKED_VENDOR'), 'WebGL UNMASKED spoof required');
    assert_1.default.ok(hwSource.includes('Intel') || hwSource.includes('Mesa'), 'pc kit WebGL must be Linux Intel/Mesa');
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
    assert_1.default.ok(pcSrc.includes('Intel') || pcSrc.includes('Mesa'), 'pc WebGL Linux GPU story');
    assert_1.default.ok(pcSrc.includes('Linux x86_64'), 'pc platform');
    assert_1.default.ok(!pcSrc.includes('Direct3D'), 'pc never D3D11/Windows');
    const nav = (0, device_kits_1.kitNavigatorSpoofSource)({
        kit: phone,
        userAgent: phone.buildUserAgent('120.0.0.0'),
    });
    assert_1.default.ok(nav.includes('hardwareConcurrency'), 'nav spoof cores');
    assert_1.default.ok(nav.includes('Linux armv8l'), 'nav spoof platform');
    assert_1.default.ok(!nav.includes('window.Worker'), 'nav spoof must not wrap Worker ctor');
    assert_1.default.ok(!nav.includes('webglVendor'), 'nav spoof must not patch WebGL');
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
    console.log('[unit] launch environment ok');
}
function testTouchEmulationParams() {
    assert_1.default.deepStrictEqual((0, device_emulation_1.touchEmulationParams)({ touch: false, mobile: false, maxTouchPoints: 0 }), { enabled: false });
    assert_1.default.deepStrictEqual((0, device_emulation_1.touchEmulationParams)({ touch: true, mobile: false, maxTouchPoints: 5 }), { enabled: true, maxTouchPoints: 5 });
    assert_1.default.throws(() => (0, device_emulation_1.touchEmulationParams)({ touch: true, mobile: false, maxTouchPoints: 0 }), /between 1 and 16/);
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
    testTouchEmulationParams();
    testStopDoesNotEnqueueCrash();
    testUnexpectedContextCloseEnqueuesCrash();
    testRecreateKeepsOpenAcrossStaleClose();
    await testStopKeepsBridgeQueuesOpen();
    testBenignBrowserRaceNarrow();
    await testAbortDoesNotStealQueuedCrash();
    testDropOldestQueueTracksDroppedCount();
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
    console.log('[unit] all passed');
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