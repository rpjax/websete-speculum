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
const Navigation_1 = require("./browser/patchright/Navigation");
const device_emulation_1 = require("./browser/patchright/device-emulation");
const viewport_bounds_1 = require("./browser/patchright/viewport-bounds");
const contextCrash_1 = require("./browser/patchright/contextCrash");
const mappers_1 = require("./grpc/mappers");
const EventBridge_1 = require("./host/EventBridge");
const DropOldestQueue_1 = require("./host/DropOldestQueue");
const browserRace_1 = require("./host/browserRace");
const collectTelemetry_1 = require("./telemetry/collectTelemetry");
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
    const missingDpr = (0, device_emulation_1.resolveDeviceProfile)({ mobile: false, touch: false });
    assert_1.default.strictEqual(missingDpr.deviceScaleFactor, 1);
    assert_1.default.strictEqual(missingDpr.maxTouchPoints, 0);
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)(null, undefined), true);
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)({ mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0 }, device_emulation_1.DEFAULT_DESKTOP_DEVICE), true);
    assert_1.default.strictEqual((0, device_emulation_1.deviceProfilesEqual)({ mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 }, device_emulation_1.DEFAULT_DESKTOP_DEVICE), false);
    console.log('[unit] resolve device profile defaults ok');
}
async function testApplyLogicalViewportUsesNormalBounds() {
    const calls = [];
    const cdp = {
        send: async (method, params) => {
            calls.push({ method, params });
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 7 };
            if (method === 'Browser.getVersion') {
                return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
            }
            return {};
        },
    };
    const profile = await (0, device_emulation_1.applyLogicalViewport)(cdp, 1024, 768, null);
    assert_1.default.strictEqual(profile.deviceScaleFactor, 1);
    assert_1.default.strictEqual(profile.mobile, false);
    const bounds = calls.find((c) => c.method === 'Browser.setWindowBounds');
    assert_1.default.ok(bounds, 'must set window bounds');
    assert_1.default.deepStrictEqual(bounds.params, {
        windowId: 7,
        bounds: { left: 0, top: 0, width: 1024, height: 768, windowState: 'normal' },
    });
    const metrics = calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    assert_1.default.ok(metrics, 'must apply device metrics');
    assert_1.default.strictEqual(metrics.params.width, 1024);
    assert_1.default.strictEqual(metrics.params.height, 768);
    assert_1.default.strictEqual(metrics.params.deviceScaleFactor, 1);
    assert_1.default.strictEqual(metrics.params.screenWidth, 1024);
    assert_1.default.strictEqual(metrics.params.screenHeight, 768);
    // Soft resize path must never imply fullscreen-on-max display.
    assert_1.default.ok(!calls.some((c) => c.method === 'Browser.setWindowBounds'
        && c.params?.bounds?.windowState === 'fullscreen'));
    // Desktop apply must clear UA (even after prior mobile) — no early-return skip.
    const ua = calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
    assert_1.default.ok(ua, 'desktop apply must set/clear user agent');
    assert_1.default.strictEqual(ua.params.userAgent, 'Mozilla/5.0 Desktop');
    await assert_1.default.rejects(() => (0, device_emulation_1.applyLogicalViewport)({
        send: async (method) => {
            if (method === 'Browser.getWindowForTarget')
                return { windowId: 1 };
            if (method === 'Browser.getVersion')
                return { product: 'Chrome/120.0.0.0' };
            return {};
        },
    }, 800, 600, null), /did not return userAgent/);
    console.log('[unit] apply logical viewport uses normal bounds ok');
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
    const sent = [];
    let resolveSlow = null;
    const slow = new Promise((r) => {
        resolveSlow = r;
    });
    const cdp = {
        send(method, params) {
            sent.push({ method, params: (params ?? {}) });
            if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
                return slow;
            }
            return Promise.resolve({});
        },
    };
    const page = {
        goBack: () => Promise.reject(new Error('should not block')),
        goForward: () => Promise.reject(new Error('should not block')),
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const input = new InputController(page, cdp);
    // Admission must return while a prior CDP call is still in flight.
    input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
    assert_1.default.strictEqual(input.pendingCount, 1, 'in-flight CDP must be visible in telemetry');
    input.enqueue({ type: 'mouseup', x: 1, y: 2, button: 0 });
    input.enqueue({ type: 'keydown', key: 'a' });
    assert_1.default.strictEqual(sent.length, 3, 'second/third CDP must not wait for first');
    // mousemove coalesces to last point via setImmediate
    input.enqueue({ type: 'mousemove', x: 10, y: 10 });
    input.enqueue({ type: 'mousemove', x: 20, y: 20 });
    input.enqueue({ type: 'mousemove', x: 30, y: 30 });
    assert_1.default.ok(input.pendingCount >= 2, 'coalesced pending move must count until flushed');
    await new Promise((r) => setImmediate(r));
    const moves = sent.filter((s) => s.method === 'Input.dispatchMouseEvent' && s.params.type === 'mouseMoved');
    assert_1.default.strictEqual(moves.length, 1);
    assert_1.default.strictEqual(moves[0].params.x, 30);
    assert_1.default.strictEqual(moves[0].params.y, 30);
    // history must not throw / block admission
    input.enqueue({ type: 'goback' });
    input.enqueue({ type: 'goforward' });
    resolveSlow();
    await slow;
    await Promise.resolve();
    assert_1.default.strictEqual(input.pendingCount, 0, 'telemetry input depth must drain after completion');
    console.log('[unit] input fire-and-forget + move coalesce ok');
}
async function testInputKeyDefsIncludeEditingKeys() {
    const sent = [];
    const cdp = {
        send: async (method, params) => {
            sent.push({ method, params: (params ?? {}) });
        },
    };
    const page = {
        goBack: () => Promise.resolve(null),
        goForward: () => Promise.resolve(null),
    };
    const { InputController } = await Promise.resolve().then(() => __importStar(require('./browser/patchright/Input')));
    const input = new InputController(page, cdp);
    input.enqueue({ type: 'keydown', key: 'Backspace' });
    input.enqueue({ type: 'keyup', key: 'Backspace' });
    input.enqueue({ type: 'keydown', key: 'Delete' });
    input.enqueue({ type: 'keydown', key: 'ArrowLeft' });
    input.enqueue({ type: 'keydown', key: 'Home' });
    input.enqueue({ type: 'keydown', key: 'Enter' });
    const keys = sent.filter((s) => s.method === 'Input.dispatchKeyEvent');
    const backspace = keys.find((s) => s.params.key === 'Backspace' && s.params.type === 'rawKeyDown');
    assert_1.default.ok(backspace, 'Backspace must use rawKeyDown');
    assert_1.default.strictEqual(backspace.params.windowsVirtualKeyCode, 8);
    assert_1.default.strictEqual(backspace.params.code, 'Backspace');
    const del = keys.find((s) => s.params.key === 'Delete' && s.params.type === 'rawKeyDown');
    assert_1.default.strictEqual(del?.params.windowsVirtualKeyCode, 46);
    const arrow = keys.find((s) => s.params.key === 'ArrowLeft');
    assert_1.default.strictEqual(arrow?.params.windowsVirtualKeyCode, 37);
    assert_1.default.strictEqual(arrow?.params.code, 'ArrowLeft');
    const home = keys.find((s) => s.params.key === 'Home');
    assert_1.default.strictEqual(home?.params.windowsVirtualKeyCode, 36);
    const enter = keys.find((s) => s.params.key === 'Enter' && s.params.type === 'keyDown');
    assert_1.default.strictEqual(enter?.params.text, '\r');
    assert_1.default.strictEqual(enter?.params.windowsVirtualKeyCode, 13);
    // Shift must set modifiers on subsequent keys (selection / uppercase path).
    input.enqueue({ type: 'keydown', key: 'Shift' });
    input.enqueue({ type: 'keydown', key: 'ArrowRight' });
    const shiftArrow = sent
        .filter((s) => s.method === 'Input.dispatchKeyEvent' && s.params.key === 'ArrowRight')
        .at(-1);
    assert_1.default.strictEqual(shiftArrow?.params.modifiers, 8, 'Shift bitmask must be set');
    assert_1.default.strictEqual(shiftArrow?.params.type, 'rawKeyDown');
    console.log('[unit] input key defs (Backspace/Delete/nav/modifiers) ok');
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
                    getStatus: async () => ({ isOpen: true, tabCount: 1, url: 'about:blank', resizing: false, width: 1, height: 1 }),
                    getTelemetrySnapshot: () => ({ inputPendingCount: 2 }),
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
async function main() {
    testDomainMatch();
    testViewportBounds();
    testResolveDeviceProfileDefaults();
    await testApplyLogicalViewportUsesNormalBounds();
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
    await testInputFireAndForgetAndMoveCoalesce();
    await testInputKeyDefsIncludeEditingKeys();
    await testTelemetryToggleOmission();
    await testTelemetryQueuesReportInputDepthAndDrops();
    await testTelemetryFaultStateSurvivesCrashConsumption();
    console.log('[unit] all passed');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=unit.js.map