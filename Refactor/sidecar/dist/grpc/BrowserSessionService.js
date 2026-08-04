"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrowserSessionHandlers = createBrowserSessionHandlers;
const collectTelemetry_1 = require("../telemetry/collectTelemetry");
const hostResources_1 = require("../host/hostResources");
const mappers_1 = require("./mappers");
const validate_1 = require("./validate");
/* eslint-disable @typescript-eslint/no-explicit-any */
function grpcError(err) {
    return (0, validate_1.mapGrpcError)(err);
}
async function pumpQueue(queue, call, map, signal) {
    // When write returns false, skip further writes until 'drain' — drop items, do not
    // await drain or keep stuffing the gRPC buffer (unbounded memory).
    let congested = false;
    const onDrain = () => {
        congested = false;
    };
    call.on('drain', onDrain);
    try {
        for (;;) {
            const item = await queue.read(signal);
            if (item === null)
                break;
            // Abort may race after dequeue — put the item back for the next Watch* reopen.
            if (signal.aborted || call.cancelled) {
                queue.tryWrite(item);
                break;
            }
            if (congested) {
                continue;
            }
            congested = !call.write(map(item));
        }
    }
    finally {
        call.off('drain', onDrain);
    }
}
function createBrowserSessionHandlers(registry) {
    return {
        create(call, callback) {
            try {
                const entry = registry.create(call.request.sessionId);
                callback(null, { sessionId: entry.session.sessionId });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async launch(call, callback) {
            try {
                const sessionId = (0, validate_1.requireSessionId)(call.request);
                const { session } = registry.get(sessionId);
                const ready = await session.launch((0, mappers_1.toLaunchOptions)(call.request));
                callback(null, ready);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async stop(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                await session.stop();
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async dispose(call, callback) {
            try {
                await registry.dispose((0, validate_1.requireSessionId)(call.request));
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async getStatus(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const status = await session.getStatus();
                callback(null, {
                    isOpen: status.isOpen,
                    tabCount: status.tabCount,
                    url: status.url,
                    resizing: status.resizing,
                    width: status.width,
                    height: status.height,
                    displayWidth: status.displayWidth,
                    displayHeight: status.displayHeight,
                    chromeWidth: status.chromeWidth,
                    chromeHeight: status.chromeHeight,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async restoreState(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                (0, validate_1.requireState)(call.request.state);
                const stats = await session.restoreState((0, mappers_1.toBrowserState)(call.request.state));
                callback(null, {
                    cookieNormalize: {
                        total: stats.total,
                        skipped: stats.skipped,
                        normalized: stats.normalized,
                        applied: stats.applied,
                        failedIndividual: stats.failedIndividual,
                    },
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async exportState(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const state = await session.exportState();
                callback(null, (0, mappers_1.fromBrowserState)(state));
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async navigate(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                await session.navigate((0, validate_1.requireUrl)(call.request.url));
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async refresh(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                await session.refresh();
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async resize(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const result = await session.resize({
                    width: call.request.width,
                    height: call.request.height,
                    device: call.request.device ? (0, mappers_1.toDevice)(call.request.device) : undefined,
                    screencastMaxEncodeScale: call.request.screencastMaxEncodeScale
                        ?? call.request.screencast_max_encode_scale,
                });
                callback(null, result);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async probe(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const ops = (0, validate_1.requireProbeOps)(call.request.ops);
                const result = await session.probe({
                    ops,
                    evaluateExpression: call.request.evaluateExpression,
                    domSelector: call.request.domSelector,
                });
                callback(null, {
                    ok: result.ok,
                    dataJson: result.data !== undefined ? JSON.stringify(result.data) : undefined,
                    errorCode: result.errorCode,
                    message: result.message,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async evaluate(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const result = await session.evaluate((0, validate_1.requireEvaluateCode)(call.request.code));
                callback(null, {
                    ok: result.ok,
                    value: result.value,
                    errorMessage: result.errorMessage,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async collectTelemetry(call, callback) {
            try {
                callback(null, await (0, collectTelemetry_1.collectTelemetry)(call.request, registry));
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        applyHostResources(call, callback) {
            try {
                const req = call.request ?? {};
                const result = (0, hostResources_1.applyHostResources)({
                    shmSizeBytes: Number(req.shmSizeBytes ?? req.shm_size_bytes ?? 0),
                    raiseUlimits: Boolean(req.raiseUlimits ?? req.raise_ulimits),
                    nofile: Number(req.nofile ?? 0),
                    nproc: Number(req.nproc ?? 0),
                });
                callback(null, {
                    shmBeforeBytes: result.shmBeforeBytes,
                    shmAppliedBytes: result.shmAppliedBytes,
                    ulimitsRaised: result.ulimitsRaised,
                    nofileApplied: result.nofileApplied,
                    nprocApplied: result.nprocApplied,
                    warnings: result.warnings,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        getHostResources(_call, callback) {
            try {
                const status = (0, hostResources_1.getHostResourcesStatus)();
                callback(null, {
                    shmSizeBytes: status.shmSizeBytes,
                    nofile: status.nofile,
                    nproc: status.nproc,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        watchVideo(call) {
            watchStream(call, registry, (b) => b.video, (jpeg) => ({ jpeg }));
        },
        watchDom(call) {
            watchStream(call, registry, (b) => b.dom, (d) => ({
                sequence: d.sequence,
                generation: d.generation,
                kind: d.kind,
                timestampMs: d.timestampMs,
                body: d.body,
            }));
        },
        watchAudio(call) {
            watchStream(call, registry, (b) => b.audio, (chunk) => ({ chunk }));
        },
        watchConsole(call) {
            watchStream(call, registry, (b) => b.consoleQ, (e) => e);
        },
        watchLocation(call) {
            watchStream(call, registry, (b) => b.location, (url) => ({ url }));
        },
        watchNavigationBlocked(call) {
            watchStream(call, registry, (b) => b.navigationBlocked, (url) => ({ url }));
        },
        watchEditableFocus(call) {
            watchStream(call, registry, (b) => b.editableFocus, (editing) => (0, mappers_1.editingToProto)(editing));
        },
        watchCrash(call) {
            watchStream(call, registry, (b) => b.crash, (f) => ({
                errorCode: f.errorCode,
                message: f.message,
                phase: f.phase,
            }));
        },
        watchInputPath(call) {
            watchStream(call, registry, (b) => b.inputPath, (e) => ({
                phase: e.phase,
                kind: e.kind,
                unixMs: e.unixMs,
            }));
        },
        watchAllocationLifecycle(call) {
            watchStream(call, registry, (b) => b.allocationLifecycle, (e) => ({
                kind: e.kind,
                displayWidth: e.displayWidth,
                displayHeight: e.displayHeight,
                logicalWidth: e.logicalWidth,
                logicalHeight: e.logicalHeight,
                inputBackend: e.inputBackend,
                errorCode: e.errorCode,
                phase: e.phase,
                reason: e.reason,
                unixMs: e.unixMs,
            }));
        },
        pushInput(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const sid = (0, validate_1.requireSessionId)(msg);
                const { session, bridge } = registry.get(sid);
                const input = (0, mappers_1.toBrowserInput)(msg);
                await session.pushInput(input);
                // Skip admit-path fanout for move samples (high frequency).
                if (input.type !== 'mousemove' && !(input.type === 'touch' && input.phase === 'move')) {
                    bridge.onInputPathAdmitted(input.type);
                }
            });
        },
        pushDomInput(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const sid = (0, validate_1.requireSessionId)(msg);
                const { session } = registry.get(sid);
                if (!session.pushDomInput) {
                    throw Object.assign(new Error('DomProjection input not supported'), {
                        code: 'FAILED_PRECONDITION',
                    });
                }
                await session.pushDomInput({
                    type: String(msg.type ?? ''),
                    targetId: Number(msg.targetId ?? msg.target_id ?? 0),
                    payloadJson: msg.payloadJson ?? msg.payload_json ?? '{}',
                });
            });
        },
        async getDomAsset(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const hash = String(call.request.hash ?? '');
                if (!hash || !session.getDomAsset) {
                    callback(null, { body: Buffer.alloc(0), contentType: 'application/octet-stream' });
                    return;
                }
                const hit = await session.getDomAsset(hash);
                if (!hit) {
                    callback(null, { body: Buffer.alloc(0), contentType: 'application/octet-stream' });
                    return;
                }
                callback(null, { body: hit.body, contentType: hit.contentType });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        pushCamera(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const { session } = registry.get((0, validate_1.requireSessionId)(msg));
                const data = (0, validate_1.requireBinaryData)(msg.data, 'camera frame');
                await session.pushCameraFrame(data);
            });
        },
        pushMicrophone(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const { session } = registry.get((0, validate_1.requireSessionId)(msg));
                const data = (0, validate_1.requireBinaryData)(msg.data, 'microphone audio');
                await session.pushMicrophoneAudio(data);
            });
        },
        control(call) {
            // Each API session opens its own Control duplex and identifies via metadata.
            // Never attach all bridges — that cross-wires permissions across sessions.
            const sessionId = readSessionIdMetadata(call.metadata);
            if (!sessionId) {
                call.destroy(grpcError(Object.assign(new Error('Control requires x-session-id metadata'), {
                    code: 'INVALID_ARGUMENT',
                })));
                return;
            }
            let bridge;
            try {
                bridge = registry.get(sessionId).bridge;
            }
            catch (err) {
                call.destroy(grpcError(err));
                return;
            }
            const sink = (req) => {
                const kindEnum = req.kind === 'camera'
                    ? 'PERMISSION_KIND_CAMERA'
                    : 'PERMISSION_KIND_MICROPHONE';
                call.write({
                    permissionRequest: {
                        corrId: req.corrId,
                        kind: kindEnum,
                        sessionId: req.sessionId,
                    },
                });
            };
            const sinkEpoch = bridge.setPermissionSink(sink);
            // If this session id is re-created while Control is up, re-bind the new bridge.
            let activeEpoch = sinkEpoch;
            const unsubscribe = registry.onCreate((entry) => {
                if (entry.bridge.sessionId !== sessionId)
                    return;
                bridge.clearPermissionSink(sink, activeEpoch);
                bridge = entry.bridge;
                activeEpoch = bridge.setPermissionSink(sink);
            });
            call.on('data', (msg) => {
                const reply = msg.permissionReply;
                if (!reply)
                    return;
                if (reply.sessionId && reply.sessionId !== sessionId)
                    return;
                bridge.resolvePermission(reply.corrId, !!reply.allow);
            });
            const cleanup = () => {
                unsubscribe();
                bridge.clearPermissionSink(sink, activeEpoch);
            };
            call.on('end', () => {
                cleanup();
                call.end();
            });
            call.on('error', () => cleanup());
            call.on('cancelled', () => cleanup());
        },
    };
}
function readSessionIdMetadata(metadata) {
    const values = metadata.get('x-session-id');
    if (!values || values.length === 0) {
        return null;
    }
    const raw = values[0];
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Pumps a per-session EventBridge queue onto a gRPC server-streaming call.
 * The queue stays open for the life of the registry entry (CloseConnection/Dispose).
 * Chromium stop/crash must not close the queue — only bridge.close() on dispose.
 */
function watchStream(call, registry, pick, map) {
    let entry;
    try {
        entry = registry.get((0, validate_1.requireSessionId)(call.request));
    }
    catch (err) {
        call.destroy(grpcError(err));
        return;
    }
    const ac = new AbortController();
    call.on('cancelled', () => ac.abort());
    call.on('close', () => ac.abort());
    call.on('error', () => ac.abort());
    void pumpQueue(pick(entry.bridge), call, map, ac.signal)
        .then(() => {
        if (!call.cancelled)
            call.end();
    })
        .catch((err) => {
        if (!call.cancelled)
            call.destroy(grpcError(err));
    });
}
function pumpClientStream(call, callback, onMsg) {
    let failed = null;
    let chain = Promise.resolve();
    call.on('data', (msg) => {
        chain = chain.then(async () => {
            if (failed)
                return;
            try {
                await onMsg(msg);
            }
            catch (err) {
                failed = err;
                call.destroy(grpcError(err));
            }
        });
    });
    call.on('end', () => {
        void chain.then(() => {
            if (!failed)
                callback(null, {});
        });
    });
    call.on('error', (err) => {
        failed = err;
    });
}
//# sourceMappingURL=BrowserSessionService.js.map