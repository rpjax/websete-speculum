"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockBrowserSession = void 0;
exports.createMockBrowserSessionFactory = createMockBrowserSessionFactory;
const HarnessRenderer_1 = require("./mock/HarnessRenderer");
const HarnessScene_1 = require("./mock/HarnessScene");
const validate_1 = require("../grpc/validate");
/**
 * Interactive harness BrowserSession for SPECULUM_BROWSER=mock.
 * Soft resize: logical W×H changes without tearing down; display dims from Launch policy.
 */
class MockBrowserSession {
    sessionId;
    events;
    open = false;
    width = 1280;
    height = 720;
    resizing = false;
    viewportPolicy = null;
    state = {
        cookies: [],
        localStorage: [],
        idbRecords: [],
        history: [],
    };
    frameTimer = null;
    frameBusy = false;
    emitFrames;
    frameIntervalMs;
    scene = null;
    renderer = null;
    emitFps = 0;
    framesThisSecond = 0;
    fpsWindowStart = 0;
    movePending = null;
    moveScheduled = false;
    constructor(sessionId, events, options) {
        this.sessionId = sessionId;
        this.events = events;
        this.emitFrames = options?.emitFrames ?? true;
        this.frameIntervalMs = options?.frameIntervalMs ?? 16;
    }
    displayDims() {
        const policy = this.viewportPolicy;
        if (!policy) {
            return { displayWidth: 0, displayHeight: 0 };
        }
        return { displayWidth: policy.maxWidth, displayHeight: policy.maxHeight };
    }
    async launch(options) {
        this.width = options.width;
        this.height = options.height;
        this.viewportPolicy = options.viewportPolicy;
        this.open = true;
        this.scene = new HarnessScene_1.HarnessScene(this.width, this.height, {
            onLocationChanged: (url) => this.events.onLocationChanged(url),
            onMainFrameNavigationBlocked: (url) => this.events.onMainFrameNavigationBlocked(url),
            onEditableFocusChanged: (editing) => this.events.onEditableFocusChanged(editing),
        });
        this.scene.setAllowedDomains(options.allowedNavigationDomains);
        this.scene.bootstrap('https://mock.local/');
        this.renderer = new HarnessRenderer_1.HarnessRenderer(this.width, this.height);
        this.fpsWindowStart = Date.now();
        this.framesThisSecond = 0;
        this.startFrames();
        return { width: this.width, height: this.height };
    }
    async stop() {
        this.stopFrames();
        this.open = false;
        this.scene = null;
        this.renderer = null;
    }
    async dispose() {
        await this.stop();
    }
    async getStatus() {
        return {
            isOpen: this.open,
            tabCount: 1,
            url: this.scene?.currentUrl ?? 'about:blank',
            resizing: this.resizing,
            width: this.width,
            height: this.height,
        };
    }
    async restoreState(state) {
        this.state = {
            cookies: [...state.cookies],
            localStorage: [...state.localStorage],
            idbRecords: [...state.idbRecords],
            history: [...state.history],
        };
    }
    async exportState() {
        return {
            cookies: [...this.state.cookies],
            localStorage: [...this.state.localStorage],
            idbRecords: [...this.state.idbRecords],
            history: [...this.state.history],
        };
    }
    async navigate(url) {
        this.scene?.navigateTo(url, true);
    }
    async refresh() {
        this.scene?.refresh();
    }
    async resize(request) {
        if (!this.open || !this.viewportPolicy) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: 'session_gone',
                phase: 'resize_apply',
                message: 'browser session is not open',
                ...this.displayDims(),
            };
        }
        const validated = (0, validate_1.validateResizeViewport)(request.width, request.height, this.viewportPolicy);
        if (!validated.ok) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: validated.errorCode,
                phase: 'validate',
                message: validated.message,
                ...this.displayDims(),
            };
        }
        if (this.resizing) {
            return {
                ok: false,
                width: this.width,
                height: this.height,
                errorCode: 'resize_busy',
                phase: 'validate',
                message: 'another resize is in progress',
                ...this.displayDims(),
            };
        }
        // Soft no-op when logical size unchanged (mock has no device profile state).
        if (validated.width === this.width && validated.height === this.height) {
            return {
                ok: true,
                width: this.width,
                height: this.height,
                chromeWidth: this.width,
                chromeHeight: this.height,
                ...this.displayDims(),
            };
        }
        this.resizing = true;
        try {
            this.width = validated.width;
            this.height = validated.height;
            this.scene?.resize(this.width, this.height);
            this.renderer?.resize(this.width, this.height);
            return {
                ok: true,
                width: this.width,
                height: this.height,
                chromeWidth: this.width,
                chromeHeight: this.height,
                ...this.displayDims(),
            };
        }
        finally {
            this.resizing = false;
        }
    }
    async probe(request) {
        return {
            ok: true,
            data: { ops: request.ops, mock: true },
        };
    }
    async evaluate(code) {
        this.scene?.noteEvaluate(code);
        this.events.onConsole(0, `[mock evaluate] ${code.slice(0, 80)}`);
        return { ok: true, value: JSON.stringify({ echo: code }) };
    }
    async pushInput(input) {
        if (!this.scene)
            return;
        if (input.type === 'mousemove') {
            this.queueMouseMove(input.x, input.y);
            return;
        }
        this.scene.applyInput(input);
    }
    async pushCameraFrame(_frame) {
        // accepted no-op
    }
    async pushMicrophoneAudio(_chunk) {
        // accepted no-op
    }
    /** Test helper: ask the bridge/API for camera permission. */
    requestCameraPermission() {
        return this.events.onCameraPermissionRequested();
    }
    queueMouseMove(x, y) {
        this.movePending = { x, y };
        if (this.moveScheduled)
            return;
        this.moveScheduled = true;
        setImmediate(() => {
            this.moveScheduled = false;
            const p = this.movePending;
            this.movePending = null;
            if (!p || !this.scene)
                return;
            this.scene.applyInput({ type: 'mousemove', x: p.x, y: p.y });
        });
    }
    startFrames() {
        if (!this.emitFrames || this.frameTimer)
            return;
        const tick = () => {
            this.frameTimer = null;
            if (!this.open)
                return;
            void this.emitFrame().finally(() => {
                if (!this.open || !this.emitFrames)
                    return;
                this.frameTimer = setTimeout(tick, this.frameIntervalMs);
            });
        };
        this.frameTimer = setTimeout(tick, 0);
    }
    stopFrames() {
        if (this.frameTimer) {
            clearTimeout(this.frameTimer);
            this.frameTimer = null;
        }
    }
    async emitFrame() {
        if (this.frameBusy || !this.scene || !this.renderer || !this.open)
            return;
        this.frameBusy = true;
        try {
            const now = Date.now();
            if (now - this.fpsWindowStart >= 1000) {
                this.emitFps = this.framesThisSecond;
                this.framesThisSecond = 0;
                this.fpsWindowStart = now;
            }
            const snap = this.scene.snapshot({
                nowMs: now,
                emitFps: this.emitFps,
                encodeMs: this.renderer.encodeMs,
                jpegQuality: this.renderer.jpegQuality,
            });
            const jpeg = await this.renderer.renderJpeg(snap);
            if (!this.open)
                return;
            this.events.onVideoFrame(jpeg);
            this.framesThisSecond++;
        }
        catch (err) {
            console.warn('[mock-harness] frame encode failed:', err.message);
        }
        finally {
            this.frameBusy = false;
        }
    }
}
exports.MockBrowserSession = MockBrowserSession;
function createMockBrowserSessionFactory(options) {
    return {
        create(sessionId, events) {
            return new MockBrowserSession(sessionId, events, options);
        },
    };
}
//# sourceMappingURL=MockBrowserSession.js.map