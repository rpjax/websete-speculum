/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 * LB-08…19: handshake, canonical socket, symmetric establish.
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
  LOOPBACK_GENERATION_SUPERSEDED_CODE,
  LOOPBACK_GENERATION_SUPERSEDED_REASON,
  LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS,
  decodeLoopbackEnvelope,
  decodeLoopbackToPlane,
  encodeLoopbackHelloAck,
  encodeLoopbackHelloReject,
  encodeLoopbackInvoke,
  type HelloRejectReason,
  type LoopbackConnectionState,
  type LoopbackConnectionStatus,
  type LoopbackInvokeHandler,
  type LoopbackInvokeResult,
} from '@speculum/page-projection/core';
import { cspDiagLog } from './csp/cspDiag';

export type NodeDataPlaneOptions = {
  bufferedAmountWatermark?: number;
};

const DEFAULT_WATERMARK = 256 * 1024;

/** One finished (or timed-out) sidecar→Virtual invoke — for SPECULUM_DIAG_LOOPBACK=1. */
export type InvokeDiagTrace = {
  name: string;
  correlationId: number;
  wallMs: number;
  timeoutMs: number;
  started: boolean;
  heartbeats: number;
  ok: boolean;
  errorMessage?: string;
  errorName?: string;
};

const DIAG = process.env.SPECULUM_DIAG_LOOPBACK === '1';
const diagTraces: InvokeDiagTrace[] = [];

export function drainInvokeDiagTraces(): InvokeDiagTrace[] {
  return diagTraces.splice(0, diagTraces.length);
}

type PendingInvoke = {
  resolve: (r: LoopbackInvokeResult) => void;
  timer: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  name: string;
  t0: number;
  started: boolean;
  heartbeats: number;
};

type EstablishedWaiter = {
  generation: number;
  afterGeneration?: number | null;
  /** When true, resolve on any successful hello (observe, don't predict). */
  anyGeneration?: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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

  private sessionId = '';
  private expectedGeneration = 1;
  private state: LoopbackConnectionState = 'closed';
  private lastError: { code: string; message: string } | undefined;
  private shuttingDown = false;
  private readonly establishedWaiters: EstablishedWaiter[] = [];

  constructor(opts: NodeDataPlaneOptions = {}) {
    this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
  }

  /** TCP OPEN only — do not use as product gate (LB-10). */
  get isOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  get isEstablished(): boolean {
    return this.state === 'established' && this.isOpen;
  }

  get status(): LoopbackConnectionStatus {
    return {
      state: this.state,
      generation: this.expectedGeneration,
      sessionId: this.sessionId,
      lastError: this.lastError,
    };
  }

  setExpectedSession(opts: { sessionId: string; generation?: number }): void {
    this.sessionId = opts.sessionId;
    if (opts.generation !== undefined) {
      this.expectedGeneration = opts.generation >>> 0;
    }
  }

  /**
   * Wait until a Virtual hello is ack'd.
   * - `generation`: match that install exactly
   * - `afterGeneration`: accept the next install with generation > afterGeneration
   *   (sidecar observes initContext — does not predict)
   * - omit both: accept any established hello
   */
  waitEstablished(
    opts: { generation?: number; afterGeneration?: number; timeoutMs?: number } = {},
  ): Promise<void> {
    const wantExact = opts.generation !== undefined ? opts.generation >>> 0 : null;
    const after =
      opts.afterGeneration !== undefined ? opts.afterGeneration >>> 0 : null;
    const matches = (): boolean => {
      if (!this.isEstablished) return false;
      if (wantExact !== null) return this.expectedGeneration === wantExact;
      if (after !== null) return this.expectedGeneration > after;
      return true;
    };
    if (matches()) return Promise.resolve();
    const timeoutMs = opts.timeoutMs ?? LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeEstablishedWaiter(entry);
        reject(
          Object.assign(new Error('data plane not established'), {
            errorCode: 'establish_timeout',
            phase: 'establish',
            connectionState: this.state,
            installGeneration: this.expectedGeneration,
            lastHelloReject: this.lastError?.code ?? null,
          }),
        );
      }, timeoutMs);
      const entry: EstablishedWaiter = {
        generation: wantExact ?? 0,
        afterGeneration: after,
        anyGeneration: wantExact === null && after === null,
        resolve,
        reject,
        timer,
      };
      this.establishedWaiters.push(entry);
    });
  }

  attach(socket: NodeWebSocket): void {
    this.detach(true, LOOPBACK_GENERATION_SUPERSEDED_CODE);
    this.state = 'connecting';
    this.socket = socket;
    cspDiagLog('data plane attach', { readyState: socket.readyState, generation: this.expectedGeneration });
    socket.binaryType = 'nodebuffer';
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const bytes = Uint8Array.from(buf);
      const env = decodeLoopbackEnvelope(bytes);
      if (env?.kind === 'hello') {
        this.handleHello(socket, env);
        return;
      }
      if (this.state !== 'established') {
        return;
      }
      if (env?.kind === 'invoke-started' || env?.kind === 'invoke-heartbeat') {
        const pending = this.pending.get(env.correlationId);
        if (pending) {
          if (env.kind === 'invoke-started') pending.started = true;
          if (env.kind === 'invoke-heartbeat') pending.heartbeats += 1;
        }
        this.resetPendingTimer(env.correlationId);
        return;
      }
      if (env?.kind === 'invoke-result') {
        const pending = this.pending.get(env.correlationId);
        if (!pending) return;
        this.pending.delete(env.correlationId);
        clearTimeout(pending.timer);
        const result: LoopbackInvokeResult = {
          ok: env.ok,
          value: env.value,
          error: env.error,
        };
        this.recordDiag(pending, env.correlationId, result);
        pending.resolve(result);
        return;
      }
      if (this.handler === null) return;
      const mapped = decodeLoopbackToPlane(bytes);
      if (mapped === null) return;
      this.handler(mapped.channel, mapped.payload);
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.state = 'closed';
        cspDiagLog('data plane socket close');
        this.failAllPending('data plane closed');
        // LB-18: waitEstablished waits for hello-ack or timeout — intermediate closes
        // during doc churn (202→200, content Port reconnect) must not abort the waiter.
        if (this.shuttingDown) {
          this.failEstablishedWaiters(new Error('data plane closed'));
        }
      }
    });
  }

  open(_url: string): void {
    throw new Error('NodeDataPlane.open: use attach(socket) on the server side');
  }

  close(): void {
    this.shuttingDown = true;
    this.detach(true);
    this.state = 'closed';
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
    if (!this.isEstablished) {
      return {
        ok: false,
        error: { message: 'data plane not established', name: 'not_established' },
      };
    }
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
        const pending = this.pending.get(correlationId);
        this.pending.delete(correlationId);
        const result: LoopbackInvokeResult = {
          ok: false,
          error: { message: `invoke idle timeout (${timeoutMs}ms)`, name: 'timeout' },
        };
        if (pending) this.recordDiag(pending, correlationId, result);
        resolve(result);
      }, timeoutMs);
      this.pending.set(correlationId, {
        resolve,
        timer,
        timeoutMs,
        name,
        t0: performance.now(),
        started: false,
        heartbeats: 0,
      });
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
    if (!this.isEstablished) {
      return 'deferred';
    }
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

  private handleHello(
    socket: NodeWebSocket,
    env: { sessionId: string; generation: number; role: 'virtual-root' },
  ): void {
    const reject = (reason: HelloRejectReason): void => {
      try {
        socket.send(
          Buffer.from(encodeLoopbackHelloReject(env.sessionId, env.generation, reason)),
          { binary: true },
        );
      } catch {
        /* ignore */
      }
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (this.socket === socket) {
        this.socket = null;
        this.state = 'failed';
        this.lastError = { code: reason, message: reason };
      }
    };

    if (this.shuttingDown) {
      reject('server_shutting_down');
      return;
    }
    if (!this.sessionId || env.sessionId !== this.sessionId) {
      cspDiagLog('data plane hello reject', {
        reason: 'session_mismatch',
        got: env.sessionId,
        expected: this.sessionId,
      });
      reject('session_mismatch');
      return;
    }
    if (env.generation < 1 || !Number.isInteger(env.generation)) {
      cspDiagLog('data plane hello reject', {
        reason: 'generation_mismatch',
        got: env.generation,
      });
      reject('generation_mismatch');
      return;
    }
    if (env.role !== 'virtual-root') {
      reject('protocol_unsupported');
      return;
    }

    const incomingGen = env.generation >>> 0;
    const canonical = this.socket;
    const wasEstablished = this.state === 'established' && canonical !== null;

    if (wasEstablished && canonical === socket) {
      try {
        socket.send(
          Buffer.from(encodeLoopbackHelloAck(this.sessionId, this.expectedGeneration)),
          { binary: true },
        );
      } catch {
        reject('protocol_unsupported');
      }
      return;
    }

    if (wasEstablished && canonical !== null && canonical !== socket) {
      if (incomingGen <= this.expectedGeneration) {
        reject('already_established');
        return;
      }
      // LB-15.2: newer install supersedes predecessor still on the old socket.
      this.detach(true, LOOPBACK_GENERATION_SUPERSEDED_CODE);
    } else if (this.socket !== null && this.socket !== socket) {
      this.detach(true, LOOPBACK_GENERATION_SUPERSEDED_CODE);
    }

    // Adopt the generation the Virtual stated via initContext — do not predict it
    // (runtime-redesign.md §6 / waitEstablished observes, does not prescribe).
    this.expectedGeneration = incomingGen;

    try {
      socket.send(
        Buffer.from(encodeLoopbackHelloAck(this.sessionId, this.expectedGeneration)),
        { binary: true },
      );
    } catch {
      reject('protocol_unsupported');
      return;
    }

    this.socket = socket;
    this.state = 'established';
    cspDiagLog('data plane established', {
      sessionId: this.sessionId,
      generation: this.expectedGeneration,
    });
    this.resolveEstablishedWaiters(this.expectedGeneration);
  }

  private resolveEstablishedWaiters(generation: number): void {
    const keep: EstablishedWaiter[] = [];
    for (const w of this.establishedWaiters) {
      const hit =
        w.anyGeneration === true ||
        w.generation === generation ||
        (typeof w.afterGeneration === 'number' && generation > w.afterGeneration);
      if (hit) {
        clearTimeout(w.timer);
        w.resolve();
      } else {
        keep.push(w);
      }
    }
    this.establishedWaiters.length = 0;
    this.establishedWaiters.push(...keep);
  }

  private failEstablishedWaiters(err: Error): void {
    for (const w of this.establishedWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private removeEstablishedWaiter(entry: EstablishedWaiter): void {
    const idx = this.establishedWaiters.indexOf(entry);
    if (idx >= 0) this.establishedWaiters.splice(idx, 1);
  }

  private recordDiag(
    pending: PendingInvoke,
    correlationId: number,
    result: LoopbackInvokeResult,
  ): void {
    if (!DIAG) return;
    diagTraces.push({
      name: pending.name,
      correlationId,
      wallMs: performance.now() - pending.t0,
      timeoutMs: pending.timeoutMs,
      started: pending.started,
      heartbeats: pending.heartbeats,
      ok: result.ok,
      errorMessage: result.error?.message,
      errorName: result.error?.name,
    });
  }

  private resetPendingTimer(correlationId: number): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pending.delete(correlationId);
      const result: LoopbackInvokeResult = {
        ok: false,
        error: {
          message: `invoke idle timeout (${pending.timeoutMs}ms)`,
          name: 'timeout',
        },
      };
      this.recordDiag(pending, correlationId, result);
      pending.resolve(result);
    }, pending.timeoutMs);
  }

  private failAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      const result: LoopbackInvokeResult = { ok: false, error: { message, name: 'closed' } };
      this.recordDiag(pending, id, result);
      pending.resolve(result);
      this.pending.delete(id);
    }
  }

  private detach(closeSocket: boolean, closeCode?: number): void {
    this.failAllPending('data plane detached');
    const socket = this.socket;
    this.socket = null;
    if (closeSocket) {
      this.state = 'closed';
    }
    if (socket === null || !closeSocket) return;
    try {
      if (closeCode === LOOPBACK_GENERATION_SUPERSEDED_CODE) {
        socket.close(LOOPBACK_GENERATION_SUPERSEDED_CODE, LOOPBACK_GENERATION_SUPERSEDED_REASON);
      } else {
        socket.close();
      }
    } catch {
      /* ignore */
    }
  }
}

export { PlaneChannel };
