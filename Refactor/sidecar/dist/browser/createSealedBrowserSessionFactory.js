"use strict";
/**
 * Sealed-mode factory adapting the legacy {@link BrowserSessionFactory} Create→Launch shape.
 * Selects PageProjection vs VideoStreaming at {@link BrowserSession.launch} from mirrorMode.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSealedBrowserSessionFactory = createSealedBrowserSessionFactory;
const PageProjectionBrowserSession_1 = require("./mirror/projection/session/PageProjectionBrowserSession");
const VideoStreamingBrowserSession_1 = require("./VideoStreamingBrowserSession");
const Display_1 = require("./patchright/Display");
class DenyAllPermissions {
    async requestPermission() {
        return 'denied';
    }
}
/**
 * Placeholder until Launch — then replaces self with PP or Video session.
 */
class ModeSelectingSession {
    sessionId;
    events;
    displays;
    ppOpts;
    inner = null;
    constructor(sessionId, events, displays, ppOpts) {
        this.sessionId = sessionId;
        this.events = events;
        this.displays = displays;
        this.ppOpts = ppOpts;
    }
    requireInner() {
        if (!this.inner) {
            throw Object.assign(new Error('session not launched'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'not_launched',
                phase: 'session',
            });
        }
        return this.inner;
    }
    async launch(options) {
        if (this.inner) {
            return this.inner.launch(options);
        }
        if (options.mirrorMode === 'pageProjection') {
            this.inner = new PageProjectionBrowserSession_1.PageProjectionBrowserSession(this.sessionId, this.events, this.ppOpts);
        }
        else {
            this.inner = new VideoStreamingBrowserSession_1.VideoStreamingBrowserSession(this.sessionId, this.events, this.displays);
        }
        return this.inner.launch(options);
    }
    stop() {
        return this.inner ? this.inner.stop() : Promise.resolve();
    }
    dispose() {
        return this.inner ? this.inner.dispose() : Promise.resolve();
    }
    getStatus() {
        return this.requireInner().getStatus();
    }
    restoreState(state) {
        return this.requireInner().restoreState(state);
    }
    exportState() {
        return this.requireInner().exportState();
    }
    navigate(url) {
        return this.requireInner().navigate(url);
    }
    refresh() {
        return this.requireInner().refresh();
    }
    goBack() {
        return this.requireInner().goBack();
    }
    goForward() {
        return this.requireInner().goForward();
    }
    resize(request) {
        return this.requireInner().resize(request);
    }
    probe(request) {
        return this.requireInner().probe(request);
    }
    evaluate(code) {
        return this.requireInner().evaluate(code);
    }
    pushInput(input) {
        return this.requireInner().pushInput(input);
    }
    /** gRPC PushDomInput → sealed PP {@link PageProjectionBrowserSession.pushInput}. */
    async pushDomInput(input) {
        const s = this.requireInner();
        const out = await s.pushInput?.(input);
        if (out && typeof out === 'object' && out !== null && 'status' in out) {
            return out;
        }
        throw Object.assign(new Error('PageProjection input not supported'), {
            code: 'FAILED_PRECONDITION',
        });
    }
    pushCameraFrame(frame) {
        return this.requireInner().pushCameraFrame(frame);
    }
    pushMicrophoneAudio(chunk) {
        return this.requireInner().pushMicrophoneAudio(chunk);
    }
    getDomAsset(...args) {
        return this.requireInner().getDomAsset(...args);
    }
    putDomUpload(...args) {
        return this.requireInner().putDomUpload(...args);
    }
    requestResync(request) {
        return this.requireInner().requestResync?.(request) ?? Promise.resolve();
    }
    haltClocks() {
        return this.requireInner().haltClocks?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' });
    }
    resumeClocks() {
        return this.requireInner().resumeClocks?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' });
    }
    emitFrame(contextId) {
        return (this.requireInner().emitFrame?.(contextId) ??
            Promise.resolve({ ok: false, reason: 'unsupported' }));
    }
    getStateSnapshot(contextId, opts) {
        const s = this.requireInner();
        if (!s.getStateSnapshot) {
            return Promise.resolve({ ok: false, reason: 'unsupported', contextId });
        }
        return s.getStateSnapshot(contextId, opts);
    }
}
function createSealedBrowserSessionFactory(options) {
    const displays = options?.displays ?? new Display_1.DisplayAllocator();
    const ppOpts = { headless: options?.headless ?? true };
    void DenyAllPermissions;
    const legacy = {
        create(sessionId, events) {
            return new ModeSelectingSession(sessionId, events, displays, ppOpts);
        },
    };
    return {
        ...legacy,
        createPageProjection(sessionId, sink, _permissions) {
            const events = {
                onVideoFrame() { },
                onAudioFrame() { },
                onConsole: (l, t) => sink.onConsole(l, t),
                onLocationChanged: (u) => sink.onLocationChanged(u),
                onMainFrameNavigationBlocked: (u) => sink.onMainFrameNavigationBlocked(u),
                onEditableFocusChanged: (e) => sink.onEditableFocusChanged(e),
                onCrash: (f) => sink.onCrash(f),
                onCameraPermissionRequested: async () => 'deny',
                onMicrophonePermissionRequested: async () => 'deny',
                onPageProjectionFrame: (d) => sink.onFrame({
                    contextId: d.contextId ?? 1,
                    sequence: d.sequence,
                    generation: d.generation,
                    body: d.body,
                    timestampMs: d.timestampMs,
                    partIndex: d.partIndex,
                    partCount: d.partCount,
                    flags: d.flags,
                    version: d.version,
                }),
                onPageProjectionTelemetry: (m) => sink.onProjectionTelemetry(m),
            };
            return new PageProjectionBrowserSession_1.PageProjectionBrowserSession(sessionId, events, ppOpts);
        },
        createVideoStreaming(sessionId, sink, _permissions) {
            const events = {
                onVideoFrame: (j) => sink.onVideoFrame(j),
                onAudioFrame: (a) => sink.onAudioFrame(a),
                onConsole: (l, t) => sink.onConsole(l, t),
                onLocationChanged: (u) => sink.onLocationChanged(u),
                onMainFrameNavigationBlocked: (u) => sink.onMainFrameNavigationBlocked(u),
                onEditableFocusChanged: (e) => sink.onEditableFocusChanged(e),
                onCrash: (f) => sink.onCrash(f),
                onCameraPermissionRequested: async () => 'deny',
                onMicrophonePermissionRequested: async () => 'deny',
                onAllocationLifecycle: (s) => {
                    if (s.kind === 'display_allocated') {
                        sink.onDisplayAllocated({
                            width: s.displayWidth ?? 0,
                            height: s.displayHeight ?? 0,
                        });
                    }
                    else if (s.kind === 'display_released') {
                        sink.onDisplayReleased();
                    }
                    else if (s.kind === 'allocation_faulted') {
                        sink.onAllocationFaulted({
                            errorCode: s.errorCode,
                            phase: s.phase,
                            reason: s.reason,
                        });
                    }
                },
            };
            return new VideoStreamingBrowserSession_1.VideoStreamingBrowserSession(sessionId, events, displays);
        },
    };
}
//# sourceMappingURL=createSealedBrowserSessionFactory.js.map