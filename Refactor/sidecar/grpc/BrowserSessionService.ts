import * as grpc from '@grpc/grpc-js';
import type { SessionRegistry } from '../host/SessionRegistry';
import type { DropOldestQueue } from '../host/DropOldestQueue';
import type { EventBridge, PermissionKind } from '../host/EventBridge';
import {
  editingToProto,
  fromBrowserState,
  toBrowserInput,
  toBrowserState,
  toDevice,
  toLaunchOptions,
} from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any */

function grpcError(err: unknown): grpc.ServiceError {
  const e = err as { code?: string; message?: string };
  const status =
    e.code === 'NOT_FOUND'
      ? grpc.status.NOT_FOUND
      : e.code === 'ALREADY_EXISTS'
        ? grpc.status.ALREADY_EXISTS
        : e.code === 'FAILED_PRECONDITION'
          ? grpc.status.FAILED_PRECONDITION
          : grpc.status.INTERNAL;
  return Object.assign(new Error(e.message ?? String(err)), {
    code: status,
    details: e.message ?? String(err),
  }) as grpc.ServiceError;
}

function sessionIdOf(req: any): string {
  return req.sessionId ?? req.session_id ?? '';
}

async function pumpQueue<T>(
  queue: DropOldestQueue<T>,
  call: grpc.ServerWritableStream<any, any>,
  map: (item: T) => any,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    const item = await queue.read(signal);
    if (item === null || signal.aborted || call.cancelled) break;
    const ok = call.write(map(item));
    if (!ok) {
      await new Promise<void>((resolve) => {
        const onDrain = (): void => {
          cleanup();
          resolve();
        };
        const onAbort = (): void => {
          cleanup();
          resolve();
        };
        const cleanup = (): void => {
          call.off('drain', onDrain);
          signal.removeEventListener('abort', onAbort);
        };
        call.once('drain', onDrain);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      if (signal.aborted || call.cancelled) break;
    }
  }
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
        const { session } = registry.get(sessionIdOf(call.request));
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
        const { session } = registry.get(sessionIdOf(call.request));
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
        await registry.dispose(sessionIdOf(call.request));
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
        const { session } = registry.get(sessionIdOf(call.request));
        const status = await session.getStatus();
        callback(null, {
          isOpen: status.isOpen,
          tabCount: status.tabCount,
          url: status.url,
          resizing: status.resizing,
          width: status.width,
          height: status.height,
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
        const { session } = registry.get(sessionIdOf(call.request));
        await session.restoreState(toBrowserState(call.request.state));
        callback(null, {});
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    async exportState(
      call: grpc.ServerUnaryCall<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): Promise<void> {
      try {
        const { session } = registry.get(sessionIdOf(call.request));
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
        const { session } = registry.get(sessionIdOf(call.request));
        await session.navigate(call.request.url);
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
        const { session } = registry.get(sessionIdOf(call.request));
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
        const { session } = registry.get(sessionIdOf(call.request));
        const result = await session.resize({
          width: call.request.width,
          height: call.request.height,
          device: toDevice(call.request.device ?? {}),
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
        const { session } = registry.get(sessionIdOf(call.request));
        const result = await session.probe({
          ops: call.request.ops ?? [],
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
        const { session } = registry.get(sessionIdOf(call.request));
        const result = await session.evaluate(call.request.code);
        callback(null, {
          ok: result.ok,
          value: result.value,
          errorMessage: result.errorMessage,
        });
      } catch (err) {
        callback(grpcError(err), null);
      }
    },

    watchVideo(call: grpc.ServerWritableStream<any, any>): void {
      watchStream(call, registry, (b) => b.video, (jpeg) => ({ jpeg }));
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

    pushInput(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>): void {
      pumpClientStream(call, callback, async (msg) => {
        const sid = sessionIdOf(msg);
        const { session } = registry.get(sid);
        const input = toBrowserInput(msg);
        if (input) await session.pushInput(input);
      });
    },

    pushCamera(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>): void {
      pumpClientStream(call, callback, async (msg) => {
        const { session } = registry.get(sessionIdOf(msg));
        const data = msg.data as Buffer;
        await session.pushCameraFrame(new Uint8Array(data));
      });
    },

    pushMicrophone(
      call: grpc.ServerReadableStream<any, any>,
      callback: grpc.sendUnaryData<any>,
    ): void {
      pumpClientStream(call, callback, async (msg) => {
        const { session } = registry.get(sessionIdOf(msg));
        const data = msg.data as Buffer;
        await session.pushMicrophoneAudio(new Uint8Array(data));
      });
    },

    control(call: grpc.ServerDuplexStream<any, any>): void {
      const bridges = new Map<string, EventBridge>();

      const attachBridge = (bridge: EventBridge): void => {
        if (bridges.has(bridge.sessionId)) return;
        bridges.set(bridge.sessionId, bridge);
        bridge.setPermissionSink((req) => {
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
        });
      };

      for (const bridge of registry.listBridges()) {
        attachBridge(bridge);
      }
      const unsubscribe = registry.onCreate((entry) => attachBridge(entry.bridge));

      call.on('data', (msg: any) => {
        const reply = msg.permissionReply;
        if (!reply) return;
        const bridge = bridges.get(reply.sessionId as string);
        if (!bridge) return;
        bridge.resolvePermission(reply.corrId, !!reply.allow);
      });

      const cleanup = (): void => {
        unsubscribe();
        for (const bridge of bridges.values()) {
          bridge.setPermissionSink(null);
        }
        bridges.clear();
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

function watchStream<T>(
  call: grpc.ServerWritableStream<any, any>,
  registry: SessionRegistry,
  pick: (b: EventBridge) => DropOldestQueue<T>,
  map: (item: T) => any,
): void {
  let entry;
  try {
    entry = registry.get(sessionIdOf(call.request));
  } catch (err) {
    call.destroy(grpcError(err));
    return;
  }

  const ac = new AbortController();
  call.on('cancelled', () => ac.abort());
  call.on('close', () => ac.abort());
  call.on('error', () => ac.abort());

  void pumpQueue(pick(entry.bridge), call, map, ac.signal)
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
