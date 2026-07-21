"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBridge = void 0;
const DropOldestQueue_1 = require("./DropOldestQueue");
/** Per-session event fan-out with bounded queues (media DropOldest). */
class EventBridge {
    sessionId;
    video = new DropOldestQueue_1.DropOldestQueue(2);
    audio = new DropOldestQueue_1.DropOldestQueue(2);
    consoleQ = new DropOldestQueue_1.DropOldestQueue(64);
    location = new DropOldestQueue_1.DropOldestQueue(1);
    navigationBlocked = new DropOldestQueue_1.DropOldestQueue(8);
    editableFocus = new DropOldestQueue_1.DropOldestQueue(1);
    crash = new DropOldestQueue_1.DropOldestQueue(4);
    nextCorrId = 1;
    permissionWaiters = new Map();
    permissionSink = null;
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    /** Called by Control stream to receive permission requests. */
    setPermissionSink(sink) {
        this.permissionSink = sink;
    }
    onVideoFrame(jpeg) {
        this.video.tryWrite(jpeg);
    }
    onAudioFrame(chunk) {
        this.audio.tryWrite(chunk);
    }
    onConsole(level, text) {
        this.consoleQ.tryWrite({ level, text });
    }
    onLocationChanged(url) {
        this.location.tryWrite(url);
    }
    onMainFrameNavigationBlocked(url) {
        this.navigationBlocked.tryWrite(url);
    }
    onEditableFocusChanged(editing) {
        this.editableFocus.tryWrite(editing);
    }
    onCameraPermissionRequested() {
        return this.requestPermission('camera');
    }
    onMicrophonePermissionRequested() {
        return this.requestPermission('microphone');
    }
    onCrash(fault) {
        this.crash.tryWrite(fault);
    }
    resolvePermission(corrId, allow) {
        const waiter = this.permissionWaiters.get(corrId);
        if (!waiter)
            return;
        this.permissionWaiters.delete(corrId);
        waiter.resolve(allow ? 'allow' : 'deny');
    }
    close() {
        this.video.close();
        this.audio.close();
        this.consoleQ.close();
        this.location.close();
        this.navigationBlocked.close();
        this.editableFocus.close();
        this.crash.close();
        for (const [, w] of this.permissionWaiters) {
            w.resolve('deny');
        }
        this.permissionWaiters.clear();
        this.permissionSink = null;
    }
    requestPermission(kind) {
        const corrId = this.nextCorrId++;
        return new Promise((resolve) => {
            this.permissionWaiters.set(corrId, { kind, resolve });
            const sink = this.permissionSink;
            if (!sink) {
                this.permissionWaiters.delete(corrId);
                resolve('deny');
                return;
            }
            sink({ corrId, kind, sessionId: this.sessionId });
        });
    }
}
exports.EventBridge = EventBridge;
//# sourceMappingURL=EventBridge.js.map