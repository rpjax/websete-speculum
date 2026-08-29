/**
 * Browser-side DataPlane over loopback WebSocket (E-03 + LB-08…19 establish).
 */

import {
  decodePlaneEnvelope,
  encodePlaneEnvelope,
  type DataPlane,
  type DataPlaneMessageHandler,
  type DataPlaneResult,
  type PlaneChannel,
} from '../../core/plane';
import {
  LOOPBACK_CONTROL_INVOKE_NAME,
  LOOPBACK_INVOKE_HEARTBEAT_MS,
  LOOPBACK_HELLO_ACK_TIMEOUT_MS,
  LOOPBACK_WS_OPEN_TIMEOUT_MS,
  decodeLoopbackEnvelope,
  encodeLoopbackHello,
  encodeLoopbackInvokeHeartbeat,
  encodeLoopbackInvokeResult,
  encodeLoopbackInvokeStarted,
  type LoopbackConnectionState,
  type LoopbackConnectionStatus,
  type LoopbackInvokeHandler,
  type LoopbackInvokeResult,
} from '../../core/loopback/envelope';
import {
  LOOPBACK_SOCKET_CLOSED,
  LOOPBACK_SOCKET_OPEN,
  type LoopbackSocket,
  type LoopbackSocketFactory,
} from '../../core/loopback/socket';

export type LoopbackDataPlaneOptions = {
  /** Deferred when socket.bufferedAmount exceeds this (default 256 KiB). */
  bufferedAmountWatermark?: number;
  /**
   * Socket factory — required.
   * Managed Virtual passes extension-plane factory; Node units pass mocks.
   * No page-origin WebSocket default (EP-08 / EP-15).
   */
  createSocket: LoopbackSocketFactory;
};

const DEFAULT_WATERMARK = 256 * 1024;
const RECONNECT_BACKOFF_MS = [50, 100, 200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class LoopbackDataPlane implements DataPlane {
  private socket: LoopbackSocket | null = null;
  private url: string | null = null;
  private readonly watermark: number;
  private readonly createSocket: LoopbackSocketFactory;
  private handler: DataPlaneMessageHandler | null = null;
  private invokeHandler: LoopbackInvokeHandler | null = null;

  private sessionId = '';
  private generation = 0;
  private state: LoopbackConnectionState = 'closed';
  private lastError: { code: string; message: string } | undefined;
  private intentionalClose = false;
  private reconnectBusy = false;
  private statusListeners: Array<(s: LoopbackConnectionStatus) => void> = [];
  private helloAckWaiter: {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Ack that landed before {@link waitHelloAck} armed (Port/postMessage reordering). */
  private lastHelloAck: { sessionId: string; generation: number } | null = null;

  constructor(opts: LoopbackDataPlaneOptions) {
    this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
    this.createSocket = opts.createSocket;
  }

  get destinationUrl(): string | null {
    return this.url;
  }

  /** TCP OPEN only — do not use as product gate (LB-10). */
  get isOpen(): boolean {
    return this.socket?.readyState === LOOPBACK_SOCKET_OPEN;
  }

  get isEstablished(): boolean {
    return this.state === 'established' && this.isOpen;
  }

  get status(): LoopbackConnectionStatus {
    return {
      state: this.state,
      generation: this.generation,
      sessionId: this.sessionId,
      lastError: this.lastError,
    };
  }

  onStatusChange(cb: (s: LoopbackConnectionStatus) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((x) => x !== cb);
    };
  }

  open(url: string): void {
    this.tearDownSocket(true);
    this.url = url;
    const socket = this.createSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (ev) => this.onSocketMessage(ev));
    socket.addEventListener('close', () => this.onSocketClose(socket));
    this.socket = socket;
  }

  /**
   * Application-level establish: TCP + hello + hello-ack (LB-11…13).
   */
  async establishConnection(opts: {
    sessionId: string;
    generation: number;
    timeoutMs?: number;
  }): Promise<void> {
    this.sessionId = opts.sessionId;
    this.generation = opts.generation >>> 0;
    this.intentionalClose = false;
    this.lastError = undefined;
    const perAttemptTimeout =
      opts.timeoutMs ?? LOOPBACK_WS_OPEN_TIMEOUT_MS + LOOPBACK_HELLO_ACK_TIMEOUT_MS;
    let lastErr: Error | undefined;
    const maxAttempts = RECONNECT_BACKOFF_MS.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(RECONNECT_BACKOFF_MS[attempt - 1]);
        if (this.intentionalClose) break;
      }
      try {
        await this.runWithTimeout(async () => {
          await this.runEstablishAttempt();
        }, perAttemptTimeout, 'establish_timeout');
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (this.intentionalClose) break;
        // LB-16: doc churn / extension plane replace can drop the socket mid-hello — retry
        // with a fresh socket instead of failing bootstrap on the first close.
        this.setState('closed');
        this.tearDownSocket(true);
      }
    }

    this.setState('failed');
    throw lastErr ?? new Error('establish_connection_exhausted');
  }

  /** @deprecated Prefer {@link establishConnection}. */
  whenOpen(timeoutMs = LOOPBACK_WS_OPEN_TIMEOUT_MS): Promise<void> {
    const socket = this.socket;
    if (socket === null) {
      return Promise.reject(new Error('LoopbackDataPlane.whenOpen: not opened'));
    }
    if (this.isOpen) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll !== undefined) clearInterval(poll);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error('LoopbackDataPlane.whenOpen: timeout')));
      }, timeoutMs);
      const onOpen = (): void => finish(() => resolve());
      const onError = (): void =>
        finish(() => reject(new Error('LoopbackDataPlane.whenOpen: error')));
      const onClose = (): void =>
        finish(() => reject(new Error('LoopbackDataPlane.whenOpen: closed')));
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onClose, { once: true });
      // Poll: extension open-ok can land in the gap after isOpen check / before listeners.
      poll = setInterval(() => {
        if (this.isOpen) finish(() => resolve());
      }, 10);
      if (this.isOpen) finish(() => resolve());
    });
  }

  close(): void {
    this.intentionalClose = true;
    this.setState('closed');
    this.tearDownSocket(true);
  }

  setHandler(handler: DataPlaneMessageHandler | null): void {
    this.handler = handler;
  }

  setInvokeHandler(handler: LoopbackInvokeHandler | null): void {
    this.invokeHandler = handler;
  }

  async invoke(
    _name: string,
    _args?: unknown,
    _opts?: { timeoutMs?: number },
  ): Promise<LoopbackInvokeResult> {
    return {
      ok: false,
      error: { message: 'Virtual does not invoke sidecar in v0', name: 'not_supported' },
    };
  }

  send(channel: PlaneChannel, payload: Uint8Array): DataPlaneResult {
    if (!this.isEstablished) {
      return 'deferred';
    }
    const socket = this.socket;
    if (socket === null || socket.readyState !== LOOPBACK_SOCKET_OPEN) {
      return 'deferred';
    }
    if (socket.bufferedAmount > this.watermark) {
      return 'deferred';
    }
    socket.send(encodePlaneEnvelope(channel, payload));
    return 'accepted';
  }

  private async runEstablishAttempt(): Promise<void> {
    if (!this.url) {
      throw new Error('LoopbackDataPlane.establishConnection: no url');
    }
    this.lastHelloAck = null;
    // One fresh socket per attempt — extension `handleOpen` replaces the predecessor WS.
    this.tearDownSocket(true);
    this.open(this.url);
    this.setState('connecting');
    await this.whenOpen(LOOPBACK_WS_OPEN_TIMEOUT_MS);
    const ackWait = this.waitHelloAck(LOOPBACK_HELLO_ACK_TIMEOUT_MS);
    this.sendHello();
    // One retry — extension Port reconnect can drop the first ack after hard nav.
    const retry = setTimeout(() => {
      if (this.helloAckWaiter) {
        try {
          this.sendHello();
        } catch {
          /* socket gone */
        }
      }
    }, 500);
    try {
      await ackWait;
    } finally {
      clearTimeout(retry);
    }
    this.setState('established');
  }

  private sendHello(): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== LOOPBACK_SOCKET_OPEN) {
      throw new Error('LoopbackDataPlane: socket not open for hello');
    }
    socket.send(encodeLoopbackHello(this.sessionId, this.generation));
  }

  private waitHelloAck(timeoutMs: number): Promise<void> {
    if (
      this.lastHelloAck &&
      this.lastHelloAck.sessionId === this.sessionId &&
      this.lastHelloAck.generation === this.generation
    ) {
      this.lastHelloAck = null;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.helloAckWaiter = null;
        reject(new Error('hello_ack_timeout'));
      }, timeoutMs);
      this.helloAckWaiter = {
        resolve: () => {
          clearTimeout(timer);
          this.helloAckWaiter = null;
          this.lastHelloAck = null;
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          this.helloAckWaiter = null;
          reject(err);
        },
        timer,
      };
      // Re-check: ack may have landed between the sync check and waiter arm.
      if (
        this.lastHelloAck &&
        this.lastHelloAck.sessionId === this.sessionId &&
        this.lastHelloAck.generation === this.generation
      ) {
        this.helloAckWaiter.resolve();
      }
    });
  }

  private async runWithTimeout(
    fn: () => Promise<void>,
    timeoutMs: number,
    code: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error(code)), timeoutMs);
        }),
      ]);
    } catch (err) {
      this.lastError = {
        code: err instanceof Error && err.message === 'hello_ack_timeout' ? 'hello_ack_timeout' : code,
        message: err instanceof Error ? err.message : String(err),
      };
      this.setState('failed');
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private onSocketClose(closedSocket: LoopbackSocket): void {
    if (this.socket !== closedSocket) return;
    this.socket = null;
    this.failHelloWaiter(new Error('socket closed'));
    if (this.intentionalClose) {
      this.setState('closed');
      return;
    }
    if (this.state === 'failed') return;
    void this.tryReconnect();
  }

  private async tryReconnect(): Promise<void> {
    if (this.reconnectBusy || this.intentionalClose || !this.url) return;
    this.reconnectBusy = true;
    this.setState('degraded');
    for (const backoff of RECONNECT_BACKOFF_MS) {
      await sleep(backoff);
      if (this.intentionalClose) break;
      try {
        await this.runEstablishAttempt();
        this.reconnectBusy = false;
        return;
      } catch {
        /* next attempt */
      }
    }
    this.lastError = { code: 'reconnect_exhausted', message: 'reconnect attempts exhausted' };
    this.setState('failed');
    this.reconnectBusy = false;
  }

  private failHelloWaiter(err: Error): void {
    const w = this.helloAckWaiter;
    if (w) {
      w.reject(err);
      this.helloAckWaiter = null;
    }
  }

  private tearDownSocket(closeSocket: boolean): void {
    this.failHelloWaiter(new Error('socket torn down'));
    const socket = this.socket;
    this.socket = null;
    if (socket === null || !closeSocket) return;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  private setState(next: LoopbackConnectionState): void {
    this.state = next;
    const status = this.status;
    for (const cb of this.statusListeners) {
      try {
        cb(status);
      } catch {
        /* ignore */
      }
    }
  }

  private onSocketMessage(ev: MessageEvent): void {
    const data = ev.data;
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return;
    }

    const env = decodeLoopbackEnvelope(bytes);
    if (env?.kind === 'hello-ack') {
      this.lastHelloAck = { sessionId: env.sessionId, generation: env.generation };
      if (
        this.helloAckWaiter &&
        env.sessionId === this.sessionId &&
        env.generation === this.generation
      ) {
        this.helloAckWaiter.resolve();
      }
      return;
    }
    if (env?.kind === 'hello-reject') {
      if (this.helloAckWaiter) {
        this.helloAckWaiter.reject(new Error(env.reason));
      }
      this.lastError = { code: env.reason, message: env.reason };
      this.setState('failed');
      return;
    }

    if (this.state !== 'established') {
      return;
    }

    if (env?.kind === 'invoke' && env.name !== LOOPBACK_CONTROL_INVOKE_NAME) {
      void this.dispatchInvoke(env.correlationId, env.name, env.args);
      return;
    }

    if (this.handler === null) return;
    const mapped = decodePlaneEnvelope(bytes);
    if (mapped === null) return;
    this.handler(mapped.channel, mapped.payload);
  }

  private async dispatchInvoke(
    correlationId: number,
    name: string,
    args: unknown,
  ): Promise<void> {
    const sendProgress = (encode: (id: number) => Uint8Array): void => {
      const socket = this.socket;
      if (socket === null || socket.readyState !== LOOPBACK_SOCKET_OPEN) return;
      try {
        socket.send(encode(correlationId));
      } catch {
        /* ignore */
      }
    };

    sendProgress(encodeLoopbackInvokeStarted);

    const heartbeat = setInterval(() => {
      sendProgress(encodeLoopbackInvokeHeartbeat);
    }, LOOPBACK_INVOKE_HEARTBEAT_MS);

    const handler = this.invokeHandler;
    let result: LoopbackInvokeResult = {
      ok: false,
      error: { message: 'invoke dispatch incomplete', name: 'internal' },
    };
    try {
      if (!handler) {
        result = {
          ok: false,
          error: { message: `no invoke handler for ${name}`, name: 'no_handler' },
        };
      } else {
        try {
          const value = await handler(name, args);
          if (
            value &&
            typeof value === 'object' &&
            'ok' in (value as object) &&
            (value as { ok: unknown }).ok === false
          ) {
            const reason = (value as { reason?: unknown }).reason;
            result = {
              ok: false,
              value,
              error: {
                message: typeof reason === 'string' ? reason : `${name} failed`,
                name: 'domain_ok_false',
              },
            };
          } else {
            result = { ok: true, value };
          }
        } catch (err) {
          result = {
            ok: false,
            error: {
              message: err instanceof Error ? err.message : String(err),
              name: 'handler_throw',
            },
          };
        }
      }
    } finally {
      clearInterval(heartbeat);
    }

    const socket = this.socket;
    if (socket === null || socket.readyState !== LOOPBACK_SOCKET_OPEN) return;
    try {
      socket.send(encodeLoopbackInvokeResult(correlationId, result));
    } catch {
      /* ignore */
    }
  }
}
