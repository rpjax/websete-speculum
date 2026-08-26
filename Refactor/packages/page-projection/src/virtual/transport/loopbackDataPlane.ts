/**
 * Browser-side DataPlane over loopback WebSocket (E-03).
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
  decodeLoopbackEnvelope,
  encodeLoopbackInvokeHeartbeat,
  encodeLoopbackInvokeResult,
  encodeLoopbackInvokeStarted,
  type LoopbackInvokeHandler,
  type LoopbackInvokeResult,
} from '../../core/loopback/envelope';

export type LoopbackDataPlaneOptions = {
  /** Deferred when socket.bufferedAmount exceeds this (default 256 KiB). */
  bufferedAmountWatermark?: number;
};

const DEFAULT_WATERMARK = 256 * 1024;

export class LoopbackDataPlane implements DataPlane {
  private socket: WebSocket | null = null;
  private url: string | null = null;
  private readonly watermark: number;
  private handler: DataPlaneMessageHandler | null = null;
  private invokeHandler: LoopbackInvokeHandler | null = null;

  constructor(opts: LoopbackDataPlaneOptions = {}) {
    this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
  }

  get destinationUrl(): string | null {
    return this.url;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  open(url: string): void {
    this.close();
    this.url = url;
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (ev) => this.onSocketMessage(ev));
    this.socket = socket;
  }

  /** Resolves when the underlying WebSocket is OPEN. */
  whenOpen(timeoutMs = 15_000): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    const socket = this.socket;
    if (socket === null) {
      return Promise.reject(new Error('LoopbackDataPlane.whenOpen: not opened'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('LoopbackDataPlane.whenOpen: timeout'));
      }, timeoutMs);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('LoopbackDataPlane.whenOpen: error'));
        },
        { once: true },
      );
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
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
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return 'deferred';
    }
    if (socket.bufferedAmount > this.watermark) {
      return 'deferred';
    }
    socket.send(encodePlaneEnvelope(channel, payload));
    return 'accepted';
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
      if (socket === null || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(encode(correlationId));
      } catch {
        // ignore
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
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(encodeLoopbackInvokeResult(correlationId, result));
    } catch {
      // ignore
    }
  }
}
