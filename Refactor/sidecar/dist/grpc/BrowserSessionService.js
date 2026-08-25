"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrowserSessionHandlers = createBrowserSessionHandlers;
const collectTelemetry_1 = require("../telemetry/collectTelemetry");
const hostResources_1 = require("../host/hostResources");
const mappers_1 = require("./mappers");
const validate_1 = require("./validate");
const pumpQueue_1 = require("./pumpQueue");
/* eslint-disable @typescript-eslint/no-explicit-any */
function grpcError(err) {
    return (0, validate_1.mapGrpcError)(err);
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
        async launchPageProjection(call, callback) {
            try {
                const sid = (0, validate_1.requireSessionId)(call.request);
                const { session, bridge } = registry.get(sid);
                const options = (0, mappers_1.toLaunchOptions)({ ...call.request, mirrorMode: 'pageProjection' });
                bridge.configureDomCapacity(options.frameQueueCapacity);
                const ready = await session.launch(options);
                callback(null, ready);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async launchVideoStreaming(call, callback) {
            try {
                const sid = (0, validate_1.requireSessionId)(call.request);
                const { session } = registry.get(sid);
                const options = (0, mappers_1.toLaunchOptions)({ ...call.request, mirrorMode: 'videoStreaming' });
                const ready = await session.launch(options);
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
        async goBack(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                await session.goBack();
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async goForward(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                await session.goForward();
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
        watchPageProjectionFrames(call) {
            watchStream(call, registry, (b) => b.dom, (d) => ({
                sequence: d.sequence,
                generation: d.generation,
                plane: d.plane,
                operation: d.operation,
                timestampMs: d.timestampMs,
                body: d.body,
                partIndex: d.partIndex ?? 0,
                partCount: d.partCount ?? 1,
                flags: d.flags ?? 0,
                version: d.version ?? 1,
                contextId: d.contextId ?? 1,
            }), (bridge) => ({
                onAfterDequeue: () => {
                    bridge.notifyDomQueueDrained();
                },
                onRequeueOverflow: (d) => {
                    bridge.emitLifecycleQueueDropped({
                        reason: 'sidecar_requeue_overflow',
                        generation: d.generation,
                        operation: d.operation,
                        plane: d.plane,
                        droppedCount: 1,
                        capacity: bridge.dom.maxCapacity,
                        sequence: d.sequence,
                        lowestDroppedSequence: d.sequence,
                        highestDroppedSequence: d.sequence,
                    });
                },
                onInflightLost: (d) => {
                    bridge.emitLifecycleQueueDropped({
                        reason: 'sidecar_grpc_inflight',
                        generation: d.generation,
                        operation: d.operation,
                        plane: d.plane,
                        droppedCount: 1,
                        capacity: bridge.dom.maxCapacity,
                        sequence: d.sequence,
                        lowestDroppedSequence: d.sequence,
                        highestDroppedSequence: d.sequence,
                    });
                },
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
        watchVideoStreamingInputPath(call) {
            watchStream(call, registry, (b) => b.videoStreamingInputPath, (e) => ({
                phase: e.phase,
                kind: e.kind,
                unixMs: e.unixMs,
            }));
        },
        watchPageProjectionInputPath(call) {
            watchStream(call, registry, (b) => b.pageProjectionInputPath, (e) => ({
                phase: e.phase,
                kind: e.kind,
                unixMs: e.unixMs,
                reason: e.reason,
                generation: e.generation,
            }));
        },
        watchPageProjectionLifecycle(call) {
            watchStream(call, registry, (b) => b.pageProjectionLifecycle, (e) => ({
                kind: e.kind,
                fromGeneration: e.fromGeneration,
                toGeneration: e.toGeneration,
                reason: e.reason,
                url: e.url,
                frameKind: e.frameKind,
                unixMs: e.unixMs,
                droppedCount: e.droppedCount,
                capacity: e.capacity,
                sequence: e.sequence,
                lowestDroppedSequence: e.lowestDroppedSequence,
                highestDroppedSequence: e.highestDroppedSequence,
                payloadJson: e.payloadJson,
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
                    bridge.onVideoStreamingInputPathAdmitted(input.type);
                }
            });
        },
        pushDomInput(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const sid = (0, validate_1.requireSessionId)(msg);
                const { session, bridge } = registry.get(sid);
                const pushDom = session.pushDomInput;
                if (!pushDom) {
                    throw Object.assign(new Error('PageProjection input not supported'), {
                        code: 'FAILED_PRECONDITION',
                    });
                }
                const kind = String(msg.type ?? '');
                const generation = Number(msg.generation ?? 0) || undefined;
                const rawTargetId = msg.targetId ?? msg.target_id;
                const targetId = rawTargetId != null ? Number(rawTargetId) : null;
                const outcome = await pushDom({
                    type: kind,
                    anchor: msg.anchor != null ? String(msg.anchor) : null,
                    targetId: targetId != null && Number.isFinite(targetId) ? targetId : null,
                    contextId: (() => {
                        const raw = msg.contextId ?? msg.context_id;
                        const n = raw != null ? Number(raw) : 1;
                        return Number.isFinite(n) && n > 0 ? n : 1;
                    })(),
                    generation,
                    timestampClient: msg.timestampClient != null || msg.timestamp_client != null
                        ? Number(msg.timestampClient ?? msg.timestamp_client)
                        : null,
                    payloadJson: msg.payloadJson ?? msg.payload_json ?? '{}',
                    schemaVersion: msg.schemaVersion ?? msg.schema_version ?? undefined,
                    viewportW: msg.viewportW ?? msg.viewport_w ?? undefined,
                    viewportH: msg.viewportH ?? msg.viewport_h ?? undefined,
                    census: msg.census != null ? String(msg.census) : undefined,
                    x: msg.x,
                    y: msg.y,
                    key: msg.key,
                    code: msg.code,
                    scrollX: msg.scrollX ?? msg.scroll_x,
                    scrollY: msg.scrollY ?? msg.scroll_y,
                    button: msg.button,
                    nodeId: msg.nodeId ?? msg.node_id,
                });
                const typeLower = kind.trim().toLowerCase();
                const isHfMove = typeLower === 'mousemove' || typeLower === 'pointermove';
                if (outcome.status === 'dropped') {
                    bridge.onPageProjectionIntentPath({
                        phase: 'cdp_dropped',
                        kind,
                        reason: outcome.reason,
                        generation,
                    });
                    return;
                }
                // Skip admit-path fanout for move samples (high frequency) — mirror VideoStreamingInput.
                if (!isHfMove) {
                    bridge.onPageProjectionIntentPath({
                        phase: 'sidecar_admitted',
                        kind,
                        generation,
                    });
                }
            });
        },
        async getDomAsset(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const key = String(call.request.key ?? '');
                if (!key || !session.getDomAsset) {
                    callback(null, {
                        body: Buffer.alloc(0),
                        contentType: 'application/octet-stream',
                        statusCode: 404,
                        contentRange: '',
                        passThrough: false,
                    });
                    return;
                }
                const hit = await session.getDomAsset(key, {
                    kind: String(call.request.kind ?? ''),
                    rangeHeader: String(call.request.rangeHeader ?? call.request.range_header ?? '') || undefined,
                });
                if (!hit) {
                    callback(null, {
                        body: Buffer.alloc(0),
                        contentType: 'application/octet-stream',
                        statusCode: 404,
                        contentRange: '',
                        passThrough: false,
                    });
                    return;
                }
                callback(null, {
                    body: hit.body,
                    contentType: hit.contentType,
                    statusCode: hit.statusCode ?? 200,
                    contentRange: hit.contentRange ?? '',
                    passThrough: !!hit.passThrough,
                    // §5.12.2.1 — only populated for a fresh, non-pass-through "asset" fetch; the
                    // API's SharedAssetCacheL2 predicate treats absent/false as never-shareable.
                    requestHadCookie: !!hit.requestHadCookie,
                    requestHadAuthorization: !!hit.requestHadAuthorization,
                    cacheControl: hit.cacheControl ?? '',
                    vary: hit.vary ?? '',
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async requestResync(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                if (!session.requestResync) {
                    callback(grpcError(Object.assign(new Error('requestResync unsupported'), {
                        code: 'FAILED_PRECONDITION',
                    })), null);
                    return;
                }
                const contextId = Number(call.request.contextId ?? call.request.context_id ?? 1) || 1;
                await session.requestResync({
                    contextId,
                    reason: call.request.reason != null ? String(call.request.reason) : undefined,
                });
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async haltClocks(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const r = (await session.haltClocks?.()) ?? { ok: false, reason: 'unsupported' };
                callback(null, r);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async resumeClocks(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const r = (await session.resumeClocks?.()) ?? { ok: false, reason: 'unsupported' };
                callback(null, r);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async emitFrame(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const contextId = Number(call.request.contextId ?? call.request.context_id ?? 0) || undefined;
                const r = (await session.emitFrame?.(contextId)) ?? { ok: false, reason: 'unsupported' };
                callback(null, r);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async getStateSnapshot(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const contextId = Number(call.request.contextId ?? call.request.context_id ?? 1) || 1;
                if (!session.getStateSnapshot) {
                    callback(null, { ok: false, reason: 'unsupported', contextId, snapshotJson: '' });
                    return;
                }
                const tableRaw = String(call.request.table ?? 'digest');
                const snap = await session.getStateSnapshot(contextId, {
                    table: tableRaw === 'full' ? 'full' : 'digest',
                    liveChildOrder: !!call.request.liveChildOrder || !!call.request.live_child_order,
                    cssom: String(call.request.cssom ?? 'none') || 'none',
                    tree: !!call.request.tree,
                    formProps: !!call.request.formProps || !!call.request.form_props,
                    frameNewNodes: !!call.request.frameNewNodes || !!call.request.frame_new_nodes,
                });
                if (!snap.ok) {
                    callback(null, {
                        ok: false,
                        reason: snap.reason,
                        contextId: snap.contextId ?? contextId,
                        snapshotJson: '',
                    });
                    return;
                }
                callback(null, {
                    ok: true,
                    contextId: snap.contextId,
                    generation: snap.generation,
                    sequence: snap.sequence,
                    snapshotJson: JSON.stringify(snap),
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async putDomUpload(call, callback) {
            try {
                const { session } = registry.get((0, validate_1.requireSessionId)(call.request));
                const uploadId = String(call.request.uploadId ?? call.request.upload_id ?? '');
                if (!uploadId || !session.putDomUpload) {
                    callback(null, {});
                    return;
                }
                const body = call.request.body;
                const buf = Buffer.isBuffer(body)
                    ? body
                    : Buffer.from(body?.data ?? body ?? []);
                await session.putDomUpload(uploadId, buf, String(call.request.contentType ?? call.request.content_type ?? 'application/octet-stream'), String(call.request.name ?? 'file'));
                callback(null, {});
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
function watchStream(call, registry, pick, map, hooksFor) {
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
    void (0, pumpQueue_1.pumpQueue)(pick(entry.bridge), call, map, ac.signal, hooksFor?.(entry.bridge))
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