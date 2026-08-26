/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 */

import type { WebSocket as NodeWebSocket } from 'ws';
import {
  PlaneChannel,
  encodePlaneEnvelope,
  type DataPlane,
  type DataPlaneMessageHandler,
  type DataPlaneResult,
} from '@speculum/page-projection/core/plane';
import {
  LOOPBACK_INVOKE_IDLE_MS,
  decodeLoopbackEnvelope,
  decodeLoopbackToPlane,
  encodeLoopbackInvoke,
  type LoopbackInvokeHandler,
  type LoopbackInvokeResult,
} from '@speculum/page-projection/core';

export type NodeDataPlaneOptions = {
  bufferedAmountWatermark?: number;
};

const DEFAULT_WATERMARK = 256 * 1024;

type PendingInvoke = {
  resolve: (r: LoopbackInvokeResult) => void;
  timer: ReturnType<typeof setTimeout>;
  timeoutMs: number;
};

/**
 * Adapts an already-accepted Node WebSocket (server side).
 */
export class NodeDataPlane implements DataPlane {
  private socket: NodeWebSocket | null = null;
  private readonly watermark: number;
  private handler: DataPlaneMessageHandler | null = null;
  private nextCorrelationId = 1;
  private readonly pending = new Map<number, PendingInvoke>();

  constructor(opts: NodeDataPlaneOptions = {}) {
    this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === 1; // OPEN
  }

  /** Attach a server-accepted socket (replaces any previous). */
  attach(socket: NodeWebSocket): void {
    this.detach(false);
    this.socket = socket;
    socket.binaryType = 'nodebuffer';
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      const bytes = Uint8Array.from(buf);
      const env = decodeLoopbackEnvelope(bytes);
      if (env?.kind === 'invoke-started' || env?.kind === 'invoke-heartbeat') {
        this.resetPendingTimer(env.correlationId);
        return;
      }
      if (env?.kind === 'invoke-result') {
        const pending = this.pending.get(env.correlationId);
        if (!pending) return;
        this.pending.delete(env.correlationId);
        clearTimeout(pending.timer);
        pending.resolve({
          ok: env.ok,
          value: env.value,
          error: env.error,
        });
        return;
      }
      if (this.handler === null) return;
      const mapped = decodeLoopbackToPlane(bytes);
      if (mapped === null) return;
      this.handler(mapped.channel, mapped.payload);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.failAllPending('data plane closed');
    });
  }

  open(_url: string): void {
    throw new Error('NodeDataPlane.open: use attach(socket) on the server side');
  }

  close(): void {
    this.detach(true);
  }

  setHandler(handler: DataPlaneMessageHandler | null): void {
    this.handler = handler;
  }

  setInvokeHandler(_handler: LoopbackInvokeHandler | null): void {
    // Sidecar does not accept Virtual→sidecar invoke in v0.
  }

  async invoke(
    name: string,
    args: unknown = {},
    opts?: { timeoutMs?: number },
  ): Promise<LoopbackInvokeResult> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) {
      return { ok: false, error: { message: 'data plane not open', name: 'not_open' } };
    }
    if (socket.bufferedAmount > this.watermark) {
      return { ok: false, error: { message: 'data plane deferred', name: 'deferred' } };
    }
    const correlationId = this.nextCorrelationId >>> 0;
    this.nextCorrelationId = (this.nextCorrelationId + 1) >>> 0;
    if (this.nextCorrelationId === 0) this.nextCorrelationId = 1;

    const timeoutMs = opts?.timeoutMs ?? LOOPBACK_INVOKE_IDLE_MS;
    const resultPromise = new Promise<LoopbackInvokeResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve({
          ok: false,
          error: { message: `invoke idle timeout (${timeoutMs}ms)`, name: 'timeout' },
        });
      }, timeoutMs);
      this.pending.set(correlationId, { resolve, timer, timeoutMs });
    });

    try {
      socket.send(Buffer.from(encodeLoopbackInvoke(correlationId, name, args)), { binary: true });
    } catch (err) {
      const pending = this.pending.get(correlationId);
      if (pending) {
        this.pending.delete(correlationId);
        clearTimeout(pending.timer);
      }
      return {
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          name: 'send_failed',
        },
      };
    }
    return resultPromise;
  }

  send(channel: PlaneChannel, payload: Uint8Array): DataPlaneResult {
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) {
      return 'deferred';
    }
    if (socket.bufferedAmount > this.watermark) {
      return 'deferred';
    }
    socket.send(Buffer.from(encodePlaneEnvelope(channel, payload)), { binary: true });
    return 'accepted';
  }

  private resetPendingTimer(correlationId: number): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pending.delete(correlationId);
      pending.resolve({
        ok: false,
        error: {
          message: `invoke idle timeout (${pending.timeoutMs}ms)`,
          name: 'timeout',
        },
      });
    }, pending.timeoutMs);
  }

  private failAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { message, name: 'closed' } });
      this.pending.delete(id);
    }
  }

  private detach(closeSocket: boolean): void {
    this.failAllPending('data plane detached');
    const socket = this.socket;
    this.socket = null;
    if (socket === null || !closeSocket) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
}

export { PlaneChannel };
