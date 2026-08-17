/**
 * Node-side DataPlane over the `ws` package (lab / future host).
 */

import type { WebSocket as NodeWebSocket } from 'ws';
import {
  PlaneChannel,
  decodePlaneEnvelope,
  encodePlaneEnvelope,
  type DataPlane,
  type DataPlaneMessageHandler,
  type DataPlaneResult,
} from '../../plane';

export type NodeDataPlaneOptions = {
  bufferedAmountWatermark?: number;
};

const DEFAULT_WATERMARK = 256 * 1024;

/**
 * Adapts an already-accepted Node WebSocket (server side).
 */
export class NodeDataPlane implements DataPlane {
  private socket: NodeWebSocket | null = null;
  private readonly watermark: number;
  private handler: DataPlaneMessageHandler | null = null;

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
      if (!isBinary || this.handler === null) return;
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      const env = decodePlaneEnvelope(Uint8Array.from(buf));
      if (env === null) return;
      this.handler(env.channel, env.payload);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
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

  private detach(closeSocket: boolean): void {
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
