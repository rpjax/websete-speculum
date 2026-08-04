"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBridge = void 0;
const DropOldestQueue_1 = require("./DropOldestQueue");
/** Per-session event fan-out with bounded queues (media DropOldest). */
class EventBridge {
    sessionId;
    video = new DropOldestQueue_1.DropOldestQueue(2);
    audio = new DropOldestQueue_1.DropOldestQueue(2);
    dom = new DropOldestQueue_1.DropOldestQueue(4);
    consoleQ = new DropOldestQueue_1.DropOldestQueue(64);
    location = new DropOldestQueue_1.DropOldestQueue(1);
    navigationBlocked = new DropOldestQueue_1.DropOldestQueue(8);
    editableFocus = new DropOldestQueue_1.DropOldestQueue(1);
    crash = new DropOldestQueue_1.DropOldestQueue(4);
    /** Opt-in path hops for Telemetry.Sessions.Input.SidecarAdmitted (DropOldest). */
    inputPath = new DropOldestQueue_1.DropOldestQueue(32);
    /** Opt-in allocation lifecycle for Telemetry.Sessions.Sidecar.* (DropOldest). */
    allocationLifecycle = new DropOldestQueue_1.DropOldestQueue(16);
    faulted = false;
    nextCorrId = 1;
    sinkEpoch = 0;
    permissionWaiters = new Map();
    permissionSink = null;
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    /** Called by Control stream to receive permission requests. Returns sink epoch. */
    setPermissionSink(sink) {
        this.permissionSink = sink;
        return ++this.sinkEpoch;
    }
    /**
     * Control stream detached. Denies waiters from `ownedEpoch` only, and clears the
     * sink only when it is still `ownedSink` so a reopened Control is not wiped.
     */
    clearPermissionSink(ownedSink, ownedEpoch) {
        for (const [id, w] of this.permissionWaiters) {
            if (w.epoch !== ownedEpoch)
                continue;
            w.resolve('deny');
            this.permissionWaiters.delete(id);
        }
        if (this.permissionSink === ownedSink) {
            this.permissionSink = null;
        }
    }
    onVideoFrame(jpeg) {
        this.video.tryWrite(jpeg);
    }
    onDomDiff(diff) {
        this.dom.tryWrite(diff);
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
        this.faulted = true;
        this.crash.tryWrite(fault);
    }
    /** Fire-and-forget admit hop — never blocks PushInput. */
    onInputPathAdmitted(kind) {
        this.inputPath.tryWrite({
            phase: 'admit',
            kind,
            unixMs: Date.now(),
        });
    }
    onAllocationLifecycle(signal) {
        this.allocationLifecycle.tryWrite({
            ...signal,
            unixMs: Date.now(),
        });
    }
    get isFaulted() {
        return this.faulted;
    }
    resolvePermission(corrId, allow) {
        const waiter = this.permissionWaiters.get(corrId);
        if (!waiter)
            return;
        this.permissionWaiters.delete(corrId);
        waiter.resolve(allow ? 'allow' : 'deny');
    }
    /**
     * Ends all Watch* queues. Contract: call only from SessionRegistry.dispose /
     * CloseConnection (API Dispose of the sidecar session object). Chromium stop(),
     * crash, or navigate must never close the bridge — gRPC streams outlive the browser.
     */
    close() {
        this.video.close();
        this.audio.close();
        this.consoleQ.close();
        this.location.close();
        this.navigationBlocked.close();
        this.editableFocus.close();
        this.crash.close();
        this.inputPath.close();
        this.allocationLifecycle.close();
        for (const [, w] of this.permissionWaiters) {
            w.resolve('deny');
        }
        this.permissionWaiters.clear();
        this.permissionSink = null;
    }
    requestPermission(kind) {
        const corrId = this.nextCorrId++;
        const epoch = this.sinkEpoch;
        return new Promise((resolve) => {
            this.permissionWaiters.set(corrId, { kind, resolve, epoch });
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