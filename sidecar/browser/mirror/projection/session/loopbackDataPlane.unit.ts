import assert from 'assert';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  encodeLoopbackHelloAck,
  decodeLoopbackEnvelope,
} from '@speculum/page-projection/core';
import {
  LOOPBACK_SOCKET_CLOSED,
  LOOPBACK_SOCKET_CONNECTING,
  LOOPBACK_SOCKET_OPEN,
  type LoopbackSocket,
  type LoopbackSocketEventMap,
  type LoopbackSocketListener,
} from '@speculum/page-projection/core/loopback/socket';
import { LoopbackDataPlane } from '@speculum/page-projection/virtual/transport/loopbackDataPlane';

const SESSION = 'unit-virtual-loopback';
const GENERATION = 1;

/** In-process mock socket for establish handshake tests. */
class MockEstablishSocket implements LoopbackSocket {
  private openListeners: LoopbackSocketListener<'open'>[] = [];
  private messageListeners: LoopbackSocketListener<'message'>[] = [];
  private closeListeners: LoopbackSocketListener<'close'>[] = [];
  private errorListeners: LoopbackSocketListener<'error'>[] = [];

  private _readyState = LOOPBACK_SOCKET_CONNECTING;
  binaryType: 'arraybuffer' = 'arraybuffer';

  constructor(
    private readonly url: string,
    private readonly onSend: (bytes: Uint8Array) => void,
  ) {}

  private ensureOpen(): void {
    if (this._readyState !== LOOPBACK_SOCKET_CONNECTING) return;
    this._readyState = LOOPBACK_SOCKET_OPEN;
    for (const fn of this.openListeners) fn({} as Event);
  }

  get readyState(): number {
    return this._readyState;
  }

  get bufferedAmount(): number {
    return 0;
  }

  deliverMessage(bytes: Uint8Array): void {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const fn of this.messageListeners) {
      fn({ data: ab } as MessageEvent<ArrayBuffer>);
    }
  }

  close(): void {
    if (this._readyState === LOOPBACK_SOCKET_CLOSED) return;
    this._readyState = LOOPBACK_SOCKET_CLOSED;
    for (const fn of this.closeListeners) fn({} as CloseEvent);
  }

  /** Simulate extension open-ok arriving before whenOpen arms its listener. */
  forceOpenMissedEvent(): void {
    this._readyState = LOOPBACK_SOCKET_OPEN;
    // Deliberately do not notify listeners — event already fired with none armed.
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this._readyState !== LOOPBACK_SOCKET_OPEN) {
      throw new Error('mock socket not open');
    }
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.onSend(bytes);
  }

  addEventListener<K extends keyof LoopbackSocketEventMap>(
    type: K,
    listener: LoopbackSocketListener<K>,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const once = typeof options === 'object' && options !== null && options.once === true;
    const list =
      type === 'open'
        ? this.openListeners
        : type === 'message'
          ? this.messageListeners
          : type === 'close'
            ? this.closeListeners
            : type === 'error'
              ? this.errorListeners
              : null;
    if (!list) return;
    if (once) {
      const wrapped = ((ev: LoopbackSocketEventMap[K]) => {
        listener(ev);
        this.removeEventListener(type, wrapped as LoopbackSocketListener<K>);
      }) as LoopbackSocketListener<K>;
      (list as LoopbackSocketListener<K>[]).push(wrapped);
    } else {
      (list as LoopbackSocketListener<K>[]).push(listener);
    }
    if (type === 'open') this.ensureOpen();
  }

  removeEventListener<K extends keyof LoopbackSocketEventMap>(
    type: K,
    listener: LoopbackSocketListener<K>,
    _options?: boolean | EventListenerOptions,
  ): void {
    const list =
      type === 'open'
        ? this.openListeners
        : type === 'message'
          ? this.messageListeners
          : type === 'close'
            ? this.closeListeners
            : type === 'error'
              ? this.errorListeners
              : null;
    if (!list) return;
    const idx = (list as LoopbackSocketListener<K>[]).indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }
}

async function withMockServer(
  run: (url: string, onSend: (socket: MockEstablishSocket, bytes: Uint8Array) => void) => Promise<void>,
): Promise<void> {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (_req, socket, head) => {
    wss.handleUpgrade(_req, socket, head, () => {
      /* mock path does not use real ws server */
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
    httpServer.on('error', reject);
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no listen port');
  const url = `ws://127.0.0.1:${addr.port}/`;

  const onSend = (socket: MockEstablishSocket, bytes: Uint8Array): void => {
    const env = decodeLoopbackEnvelope(bytes);
    if (env?.kind === 'hello') {
      socket.deliverMessage(encodeLoopbackHelloAck(SESSION, GENERATION));
    }
  };

  try {
    await run(url, onSend);
  } finally {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

export async function runLoopbackDataPlaneUnitTests(): Promise<void> {
  await withMockServer(async (url, reply) => {
    let lastSocket: MockEstablishSocket | null = null;
    const plane = new LoopbackDataPlane({
      createSocket: (socketUrl) => {
        assert.strictEqual(socketUrl, url);
        lastSocket = new MockEstablishSocket(socketUrl, (bytes) => {
          if (lastSocket) reply(lastSocket, bytes);
        });
        return lastSocket;
      },
    });
    plane.open(url);
    await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
    assert.strictEqual(plane.isEstablished, true);
    assert.strictEqual(plane.status.sessionId, SESSION);
    assert.strictEqual(plane.status.generation, GENERATION);
    plane.close();
    assert.strictEqual(plane.isEstablished, false);
  });

  // Extension plane: open-ok can land after isOpen check and before open listener.
  await withMockServer(async (url, reply) => {
    const holder: { sock: MockEstablishSocket | null } = { sock: null };
    const plane = new LoopbackDataPlane({
      createSocket: (socketUrl) => {
        holder.sock = new MockEstablishSocket(socketUrl, (bytes) => {
          if (holder.sock) reply(holder.sock, bytes);
        });
        return holder.sock;
      },
    });
    plane.open(url);
    if (!holder.sock) throw new Error('expected mock socket');
    holder.sock.forceOpenMissedEvent();
    await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
    assert.strictEqual(plane.isEstablished, true);
    plane.close();
  });

  // LB-16: socket closed mid-hello (extension plane replace) retries with a fresh socket.
  await withMockServer(async (url, reply) => {
    let helloCount = 0;
    const holder: { sock: MockEstablishSocket | null } = { sock: null };
    const plane = new LoopbackDataPlane({
      createSocket: (socketUrl) => {
        holder.sock = new MockEstablishSocket(socketUrl, (bytes) => {
          const env = decodeLoopbackEnvelope(bytes);
          if (env?.kind !== 'hello') return;
          helloCount += 1;
          if (helloCount === 1) {
            holder.sock?.close();
            return;
          }
          if (holder.sock) reply(holder.sock, bytes);
        });
        return holder.sock;
      },
    });
    plane.open(url);
    await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
    assert.strictEqual(plane.isEstablished, true);
    assert.ok(helloCount >= 2, `expected establish retry after socket closed, hellos=${helloCount}`);
    plane.close();
  });

  console.log('[unit] loopbackDataPlane mock socket ok');
}
