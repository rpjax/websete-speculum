"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockBrowserSession = void 0;
exports.createMockBrowserSessionFactory = createMockBrowserSessionFactory;
/**
 * In-memory BrowserSession for composition / gRPC smoke tests.
 * Optionally emits periodic fake video frames after launch.
 */
class MockBrowserSession {
    sessionId;
    events;
    open = false;
    width = 1280;
    height = 720;
    url = 'about:blank';
    resizing = false;
    state = {
        cookies: [],
        localStorage: [],
        idbRecords: [],
        history: [],
    };
    frameTimer = null;
    emitFrames;
    constructor(sessionId, events, options) {
        this.sessionId = sessionId;
        this.events = events;
        this.emitFrames = options?.emitFrames ?? true;
        this.frameIntervalMs = options?.frameIntervalMs ?? 500;
    }
    frameIntervalMs;
    async launch(options) {
        this.width = options.width;
        this.height = options.height;
        this.open = true;
        this.url = 'https://mock.local/';
        this.events.onLocationChanged(this.url);
        this.startFrames();
        return { width: this.width, height: this.height };
    }
    async stop() {
        this.stopFrames();
        this.open = false;
    }
    async dispose() {
        await this.stop();
    }
    async getStatus() {
        return {
            isOpen: this.open,
            tabCount: 1,
            url: this.url,
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
        this.url = url;
        this.events.onLocationChanged(url);
    }
    async refresh() {
        this.events.onLocationChanged(this.url);
    }
    async resize(request) {
        this.resizing = true;
        this.width = request.width;
        this.height = request.height;
        this.resizing = false;
        return {
            ok: true,
            width: this.width,
            height: this.height,
            chromeWidth: this.width,
            chromeHeight: this.height,
            displayWidth: this.width,
            displayHeight: this.height,
        };
    }
    async probe(request) {
        return {
            ok: true,
            data: { ops: request.ops, mock: true },
        };
    }
    async evaluate(code) {
        this.events.onConsole(0, `[mock evaluate] ${code.slice(0, 80)}`);
        return { ok: true, value: JSON.stringify({ echo: code }) };
    }
    async pushInput(input) {
        if (input.type === 'type' || input.type === 'text') {
            this.events.onConsole(0, `[mock input] ${input.type}: ${input.text}`);
        }
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
    startFrames() {
        if (!this.emitFrames || this.frameTimer)
            return;
        this.frameTimer = setInterval(() => {
            if (!this.open)
                return;
            // Minimal JPEG SOI/EOI stub (not a real image — enough for transport smoke).
            this.events.onVideoFrame(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
        }, this.frameIntervalMs);
    }
    stopFrames() {
        if (this.frameTimer) {
            clearInterval(this.frameTimer);
            this.frameTimer = null;
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