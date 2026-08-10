import * as grpc from '@grpc/grpc-js';
import type { SessionRegistry } from '../host/SessionRegistry';
import type { DropOldestQueue } from '../host/DropOldestQueue';
import type { EventBridge, PermissionKind } from '../host/EventBridge';
import { collectTelemetry } from '../telemetry/collectTelemetry';
import { applyHostResources, getHostResourcesStatus } from '../host/hostResources';
import {
  editingToProto,
  fromBrowserState,
  toBrowserInput,
  toBrowserState,
  toDevice,
  toLaunchOptions,
} from './mappers';
import {
  mapGrpcError,
  requireBinaryData,
  requireEvaluateCode,
  requireProbeOps,
  requireSessionId,
  requireState,
  requireUrl,
} from './validate';
import { pumpQueue } from './pumpQueue';

/* eslint-disable @typescript-eslint/no-explicit-any */

function grpcError(err: unknown): grpc.ServiceError {
  return mapGrpcError(err);
}

export function createBrowserSessionHandlers(registry: SessionRegistry): grpc.UntypedServiceImplementation {
  return {
    create(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): void {
      try {
        const entry = registry.create(call.request.sessionId);
        callback(null, { sessionId: entry.session.sessionId });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async launch(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const sessionId = requireSessionId(call.request);
        const { session } = registry.get(sessionId);
        const ready = await session.launch(toLaunchOptions(call.request));
        callback(null, ready);
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async stop(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        await session.stop();
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async dispose(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        await registry.dispose(requireSessionId(call.request));
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async getStatus(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
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
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async restoreState(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        requireState(call.request.state);
        const stats = await session.restoreState(toBrowserState(call.request.state));
        callback(null, {
          cookieNormalize: {
            total: stats.total,
            skipped: stats.skipped,
            normalized: stats.normalized,
            applied: stats.applied,
            failedIndividual: stats.failedIndividual,
          },
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async exportState(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        const state = await session.exportState();
        callback(null, fromBrowserState(state));
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async navigate(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        await session.navigate(requireUrl(call.request.url));
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async refresh(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        await session.refresh();
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async resize(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        const result = await session.resize({
          width: call.request.width,
          height: call.request.height,
          device: call.request.device ? toDevice(call.request.device) : undefined,
          screencastMaxEncodeScale:
            call.request.screencastMaxEncodeScale
            ?? call.request.screencast_max_encode_scale,
        });
        callback(null, result);
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async probe(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        const ops = requireProbeOps(call.request.ops);
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
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async evaluate(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        const result = await session.evaluate(requireEvaluateCode(call.request.code));
        callback(null, {
          ok: result.ok,
          value: result.value,
          errorMessage: result.errorMessage,
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async collectTelemetry(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        callback(null, await collectTelemetry(call.request, registry));
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    applyHostResources(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): void {
      try {
        const req = call.request ?? {};
        const result = applyHostResources({
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
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    getHostResources(
      _call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): void {
      try {
        const status = getHostResourcesStatus();
        callback(null, {
          shmSizeBytes: status.shmSizeBytes,
          nofile: status.nofile,
          nproc: status.nproc,
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    watchVideo(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.video, (jpeg) => ({ jpeg }));
    },

    watchPageProjectionDiff(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(
        call,
        registry,
        (b) => b.dom,
        (d) => ({
          sequence: d.sequence,
          generation: d.generation,
          plane: d.plane,
          operation: d.operation,
          timestampMs: d.timestampMs,
          body: d.body,
        }),
        (bridge) => ({
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
        }),
      );
    },

    watchAudio(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.audio, (chunk) => ({ chunk }));
    },

    watchConsole(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.consoleQ, (e) => e);
    },

    watchLocation(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.location, (url) => ({ url }));
    },

    watchNavigationBlocked(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.navigationBlocked, (url) => ({ url }));
    },

    watchEditableFocus(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.editableFocus, (editing) =>
        editingToProto(editing),
      );
    },

    watchCrash(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.crash, (f) => ({
        errorCode: f.errorCode,
        message: f.message,
        phase: f.phase,
      }));
    },

    watchVideoStreamingInputPath(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.videoStreamingInputPath, (e) => ({
        phase: e.phase,
        kind: e.kind,
        unixMs: e.unixMs,
      }));
    },

    watchPageProjectionInputPath(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.pageProjectionInputPath, (e) => ({
        phase: e.phase,
        kind: e.kind,
        unixMs: e.unixMs,
        reason: e.reason,
        generation: e.generation,
      }));
    },

    watchPageProjectionLifecycle(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.pageProjectionLifecycle, (e) => ({
        kind: e.kind,
        fromGeneration: e.fromGeneration,
        toGeneration: e.toGeneration,
        reason: e.reason,
        url: e.url,
        diffKind: e.diffKind,
        unixMs: e.unixMs,
        droppedCount: e.droppedCount,
        capacity: e.capacity,
        sequence: e.sequence,
        lowestDroppedSequence: e.lowestDroppedSequence,
        highestDroppedSequence: e.highestDroppedSequence,
      }));
    },

    watchAllocationLifecycle(call: grpc.ServerWritableStream<any, any>): void {
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

    pushInput(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>): void {
      pumpClientStream(call, callback, async (msg) => {
        const sid = requireSessionId(msg);
        const { session, bridge } = registry.get(sid);
        const input = toBrowserInput(msg);
        await session.pushInput(input);
        // Skip admit-path fanout for move samples (high frequency).
        if (input.type !== 'mousemove' && !(input.type === 'touch' && input.phase === 'move')) {
          bridge.onVideoStreamingInputPathAdmitted(input.type);
        }
      });
    },

    pushDomInput(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>): void {
      pumpClientStream(call, callback, async (msg) => {
        const sid = requireSessionId(msg);
        const { session, bridge } = registry.get(sid);
        if (!session.pushDomInput) {
          throw Object.assign(new Error('PageProjection input not supported'), {
            code: 'FAILED_PRECONDITION',
          });
        }
        const kind = String(msg.type ?? '');
        const generation = Number(msg.generation ?? 0) || undefined;
        const outcome = await session.pushDomInput({
          type: kind,
          anchor: msg.anchor != null ? String(msg.anchor) : null,
          generation,
          timestampClient:
            msg.timestampClient != null || msg.timestamp_client != null
              ? Number(msg.timestampClient ?? msg.timestamp_client)
              : null,
          payloadJson: msg.payloadJson ?? msg.payload_json ?? '{}',
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

    async getDomAsset(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
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
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async getPageProjectionResync(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        if (!session.getPageProjectionResync) {
          callback(grpcError(Object.assign(new Error('PageProjection resync unsupported'), {
            code: 'FAILED_PRECONDITION',
          })), null);
          return;
        }
        const snap = await session.getPageProjectionResync({
          generation: Number(call.request.generation ?? 0) || undefined,
          sequence: Number(call.request.sequence ?? 0) || undefined,
        });
        if (!snap) {
          callback(grpcError(Object.assign(new Error('resync snapshot unavailable'), {
            code: 'NOT_FOUND',
          })), null);
          return;
        }
        callback(null, {
          generation: snap.generation,
          coversThroughSequence: snap.coversThroughSequence,
          rootJson: snap.rootJson,
          sheetsJson: snap.sheetsJson,
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async putDomUpload(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(requireSessionId(call.request));
        const uploadId = String(call.request.uploadId ?? call.request.upload_id ?? '');
        if (!uploadId || !session.putDomUpload) {
          callback(null, {});
          return;
        }
        const body = call.request.body;
        const buf = Buffer.isBuffer(body)
          ? body
          : Buffer.from(body?.data ?? body ?? []);
        await session.putDomUpload(
          uploadId,
          buf,
          String(call.request.contentType ?? call.request.content_type ?? 'application/octet-stream'),
          String(call.request.name ?? 'file'),
        );
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    pushCamera(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>): void {
      pumpClientStream(call, callback, async (msg) => {
        const { session } = registry.get(requireSessionId(msg));
        const data = requireBinaryData(msg.data, 'camera frame');
        await session.pushCameraFrame(data);
      });
    },

    pushMicrophone(
      call: grpc.ServerReadableStream<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): void {
      pumpClientStream(call, callback, async (msg) => {
        const { session } = registry.get(requireSessionId(msg));
        const data = requireBinaryData(msg.data, 'microphone audio');
        await session.pushMicrophoneAudio(data);
      });
    },

    control(call: grpc.ServerDuplexStream<any, any>): void {
      // Each API session opens its own Control duplex and identifies via metadata.
      // Never attach all bridges — that cross-wires permissions across sessions.
      const sessionId = readSessionIdMetadata(call.metadata);
      if (!sessionId) {
        call.destroy(
          grpcError(
            Object.assign(new Error('Control requires x-session-id metadata'), {
              code: 'INVALID_ARGUMENT',
            }),
          ),
        );
        return;
      }

      let bridge: EventBridge;
      try {
        bridge = registry.get(sessionId).bridge;
      } catch (err) {
        call.destroy(grpcError(err));
        return;
      }

      const sink = (req: {
        corrId: number;
        kind: 'camera' | 'microphone';
        sessionId: string;
      }): void => {
        const kindEnum =
          req.kind === 'camera'
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
        if (entry.bridge.sessionId !== sessionId) return;
        bridge.clearPermissionSink(sink, activeEpoch);
        bridge = entry.bridge;
        activeEpoch = bridge.setPermissionSink(sink);
      });

      call.on('data', (msg: any) => {
        const reply = msg.permissionReply;
        if (!reply) return;
        if (reply.sessionId && reply.sessionId !== sessionId) return;
        bridge.resolvePermission(reply.corrId, !!reply.allow);
      });

      const cleanup = (): void => {
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

function readSessionIdMetadata(metadata: grpc.Metadata): string | null {
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
function watchStream<T>(
  call: grpc.ServerWritableStream<any, any>,
  registry: SessionRegistry,
  pick: (b: EventBridge) => DropOldestQueue<T>,
  map: (item: T) => any,
  hooksFor?: (b: EventBridge) => import('./pumpQueue').PumpQueueDropHooks<T> | undefined,
): void {
  let entry;
  try {
    entry = registry.get(requireSessionId(call.request));
  } catch (err) {
    call.destroy(grpcError(err));
    return;
  }

  const ac = new AbortController();
  call.on('cancelled', () => ac.abort());
  call.on('close', () => ac.abort());
  call.on('error', () => ac.abort());

  void pumpQueue(pick(entry.bridge), call, map, ac.signal, hooksFor?.(entry.bridge))
    .then(() => {
      if (!call.cancelled) call.end();
    })
    .catch((err) => {
      if (!call.cancelled) call.destroy(grpcError(err));
    });
}

function pumpClientStream(
  call: grpc.ServerReadableStream<any, any>,
  callback: grpc.sendUnaryData<any>,
  onMsg: (msg: any) => Promise<void>,
): void {
  let failed: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  call.on('data', (msg: any) => {
    chain = chain.then(async () => {
      if (failed) return;
      try {
        await onMsg(msg);
      } catch (err) {
        failed = err;
        call.destroy(grpcError(err));
      }
    });
  });

  call.on('end', () => {
    void chain.then(() => {
      if (!failed) callback(null, {});
    });
  });

  call.on('error', (err) => {
    failed = err;
  });
}
