"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBridge = void 0;
const DropOldestQueue_1 = require("./DropOldestQueue");
/** Per-session event fan-out with bounded queues (media DropOldest). */
class EventBridge {
    sessionId;
    video = new DropOldestQueue_1.DropOldestQueue(2);
    audio = new DropOldestQueue_1.DropOldestQueue(2);
    /** PageProjection Dom+Cssom envelopes — sized for SPA churn (T5 DropAll on overflow). */
    dom = new DropOldestQueue_1.DropOldestQueue(1024);
    consoleQ = new DropOldestQueue_1.DropOldestQueue(64);
    location = new DropOldestQueue_1.DropOldestQueue(1);
    navigationBlocked = new DropOldestQueue_1.DropOldestQueue(8);
    editableFocus = new DropOldestQueue_1.DropOldestQueue(1);
    crash = new DropOldestQueue_1.DropOldestQueue(4);
    /** Opt-in path hops for Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted (DropOldest). */
    videoStreamingInputPath = new DropOldestQueue_1.DropOldestQueue(32);
    /** Opt-in path hops for Telemetry.Sessions.PageProjection.Input.* (DropOldest). */
    pageProjectionInputPath = new DropOldestQueue_1.DropOldestQueue(32);
    /** Opt-in PageProjection lifecycle (GenerationBumped | QueueDropped) — DropOldest. */
    pageProjectionLifecycle = new DropOldestQueue_1.DropOldestQueue(32);
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
    onPageProjectionDiff(diff) {
        if (this.dom.isClosed) {
            this.emitLifecycleQueueDropped({
                reason: 'sidecar_bridge_closed',
                generation: diff.generation,
                operation: diff.operation,
                plane: diff.plane,
                droppedCount: 1,
                capacity: this.dom.maxCapacity,
                sequence: diff.sequence,
                lowestDroppedSequence: diff.sequence,
                highestDroppedSequence: diff.sequence,
            });
            return;
        }
        // T5/D13: overflow → client sequence gap → desync (never silently truncated chronology).
        const { dropped, lowestSequence, highestSequence } = this.dom.tryWriteDropAllOnOverflow(diff);
        if (dropped > 0) {
            this.emitLifecycleQueueDropped({
                reason: 'sidecar_bridge',
                generation: diff.generation,
                operation: diff.operation,
                plane: diff.plane,
                droppedCount: dropped,
                capacity: this.dom.maxCapacity,
                sequence: diff.sequence,
                lowestDroppedSequence: lowestSequence ?? undefined,
                highestDroppedSequence: highestSequence ?? undefined,
            });
        }
    }
    /** Emit queue_dropped lifecycle; if lifecycle queue itself DropOldests, emit sidecar_lifecycle_overflow. */
    emitLifecycleQueueDropped(ev) {
        const payload = {
            kind: 'queue_dropped',
            fromGeneration: 0,
            toGeneration: ev.generation,
            reason: ev.reason,
            diffKind: ev.operation,
            url: ev.plane,
            unixMs: Date.now(),
            droppedCount: ev.droppedCount,
            capacity: ev.capacity,
            sequence: ev.sequence,
            lowestDroppedSequence: ev.lowestDroppedSequence,
            highestDroppedSequence: ev.highestDroppedSequence,
        };
        const { droppedOldest } = this.pageProjectionLifecycle.tryWriteReportingDrop(payload);
        if (droppedOldest) {
            // Best-effort: try to surface that a prior QD was evicted from the lifecycle queue.
            this.pageProjectionLifecycle.tryWrite({
                kind: 'queue_dropped',
                fromGeneration: 0,
                toGeneration: ev.generation,
                reason: 'sidecar_lifecycle_overflow',
                diffKind: ev.operation,
                url: ev.plane,
                unixMs: Date.now(),
                droppedCount: 1,
                capacity: this.pageProjectionLifecycle.maxCapacity,
                sequence: ev.sequence,
                lowestDroppedSequence: ev.sequence,
                highestDroppedSequence: ev.sequence,
            });
        }
    }
    onPageProjectionGenerationBumped(event) {
        this.pageProjectionLifecycle.tryWrite({
            kind: 'generation_bumped',
            fromGeneration: event.fromGeneration,
            toGeneration: event.toGeneration,
            reason: event.reason,
            url: event.url,
            diffKind: event.diffKind,
            unixMs: Date.now(),
        });
    }
    onPageProjectionSoftNavObserved(event) {
        this.pageProjectionLifecycle.tryWrite({
            kind: 'soft_nav_observed',
            fromGeneration: event.generation,
            toGeneration: event.generation,
            reason: event.documentEpoch ?? '',
            url: event.url,
            diffKind: event.liveArmed ? 'armed' : 'disarmed',
            unixMs: Date.now(),
        });
    }
    onPageProjectionScrollEchoHit(event) {
        const coords = event.kind === 'viewport'
            ? `${event.scrollX ?? 0},${event.scrollY ?? 0}`
            : `${event.scrollTop ?? 0},${event.scrollLeft ?? 0}`;
        this.pageProjectionLifecycle.tryWrite({
            kind: 'scroll_echo_hit',
            fromGeneration: event.generation ?? 0,
            toGeneration: event.generation ?? 0,
            reason: event.kind,
            url: event.anchor,
            diffKind: coords,
            unixMs: Date.now(),
        });
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
    onVideoStreamingInputPathAdmitted(kind) {
        this.videoStreamingInputPath.tryWrite({
            phase: 'admit',
            kind,
            unixMs: Date.now(),
        });
    }
    /** Fire-and-forget Dom Projection path hop — never blocks PushDomInput. */
    onPageProjectionIntentPath(event) {
        this.pageProjectionInputPath.tryWrite({
            phase: event.phase,
            kind: event.kind,
            unixMs: Date.now(),
            reason: event.reason,
            generation: event.generation,
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
        this.dom.close();
        this.consoleQ.close();
        this.location.close();
        this.navigationBlocked.close();
        this.editableFocus.close();
        this.crash.close();
        this.videoStreamingInputPath.close();
        this.pageProjectionInputPath.close();
        this.pageProjectionLifecycle.close();
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