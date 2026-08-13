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
} from '../../plane';

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
    if (this.handler === null) return;
    const data = ev.data;
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return;
    }
    const env = decodePlaneEnvelope(bytes);
    if (env === null) return;
    this.handler(env.channel, env.payload);
  }
}
