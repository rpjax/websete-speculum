import assert from 'assert';
import {
  encodeLoopbackHelloAck,
  decodeLoopbackEnvelope,
  encodeLoopbackHello,
} from '@speculum/page-projection/core';
import {
  LOOPBACK_SOCKET_CLOSED,
  LOOPBACK_SOCKET_CONNECTING,
  LOOPBACK_SOCKET_OPEN,
  type LoopbackSocket,
} from '@speculum/page-projection/core/loopback/socket';
import { LoopbackDataPlane } from '@speculum/page-projection/virtual/transport/loopbackDataPlane';

const SESSION = 'perf-loopback';
const GENERATION = 1;
const ROUNDS = 200;
const FRAME = new Uint8Array(16 * 1024); // 16 KiB — typical small frame payload size for smoke

type MockListener = (ev: unknown) => void;

/**
 * Direct mock socket (page-ws analogue) vs hop mock (extension plane: postMessage+Port latency simulated).
 * Design unchanged — only measures hop cost of the sealed tunnel shape.
 */
class DirectMockSocket implements LoopbackSocket {
  private openL: MockListener[] = [];
  private messageL: MockListener[] = [];
  private closeL: MockListener[] = [];
  private errorL: MockListener[] = [];
  private _readyState = LOOPBACK_SOCKET_CONNECTING;
  binaryType: 'arraybuffer' = 'arraybuffer';

  constructor(private readonly onSend: (bytes: Uint8Array) => void) {}

  get readyState(): number {
    return this._readyState;
  }
  get bufferedAmount(): number {
    return 0;
  }

  private ensureOpen(): void {
    if (this._readyState !== LOOPBACK_SOCKET_CONNECTING) return;
    this._readyState = LOOPBACK_SOCKET_OPEN;
    for (const fn of this.openL) fn({});
  }

  deliver(bytes: Uint8Array): void {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const fn of this.messageL) fn({ data: ab });
  }

  close(): void {
    if (this._readyState === LOOPBACK_SOCKET_CLOSED) return;
    this._readyState = LOOPBACK_SOCKET_CLOSED;
    for (const fn of this.closeL) fn({});
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.onSend(bytes);
  }

  addEventListener(type: string, listener: MockListener): void {
    if (type === 'open') {
      this.openL.push(listener);
      this.ensureOpen();
    } else if (type === 'message') this.messageL.push(listener);
    else if (type === 'close') this.closeL.push(listener);
    else if (type === 'error') this.errorL.push(listener);
  }

  removeEventListener(): void {
    /* unused */
  }
}

/** Simulates main→content→bg→content→main microtask hops (4 queueMicrotask). */
class HopMockSocket extends DirectMockSocket {
  override send(data: ArrayBuffer | ArrayBufferView): void {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // clone like structured clone over Port
    const copy = bytes.slice();
    queueMicrotask(() => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          queueMicrotask(() => {
            (this as unknown as { onSend: (b: Uint8Array) => void }).onSend(copy);
          });
        });
      });
    });
  }

  override deliver(bytes: Uint8Array): void {
    const copy = bytes.slice();
    queueMicrotask(() => {
      queueMicrotask(() => {
        super.deliver(copy);
      });
    });
  }
}

async function establishWith(
  create: (onSend: (bytes: Uint8Array, sock: DirectMockSocket) => void) => LoopbackSocket,
): Promise<{ plane: LoopbackDataPlane; wallMs: number }> {
  let sock: DirectMockSocket | null = null;
  const plane = new LoopbackDataPlane({
    createSocket: () => {
      sock = create((bytes, s) => {
        const env = decodeLoopbackEnvelope(bytes);
        if (env?.kind === 'hello') {
          s.deliver(encodeLoopbackHelloAck(SESSION, GENERATION));
        }
      }) as DirectMockSocket;
      return sock;
    },
  });
  const t0 = performance.now();
  plane.open('ws://127.0.0.1:9/');
  await plane.establishConnection({ sessionId: SESSION, generation: GENERATION });
  const wallMs = performance.now() - t0;
  assert.ok(plane.isEstablished);
  return { plane, wallMs };
}

export async function runExtensionPlanePerfSmokeUnitTests(): Promise<void> {
  const direct = await establishWith((onSend) => {
    const s = new DirectMockSocket((b) => onSend(b, s));
    return s;
  });

  const hop = await establishWith((onSend) => {
    const s = new HopMockSocket((b) => onSend(b, s));
    return s;
  });

  // Frame fan-out: measure send→echo RTT (hello already done — use raw sockets via re-open pattern)
  // Instead: time LOOPBACK encode+decode ROUNDS on both paths through DataPlane send after establish.
  // LoopbackDataPlane.send needs established; echo path isn't full duplex for frames here.
  // Measure: encodeLoopbackHello round-trips ROUNDS on hop vs direct deliver.

  const payload = FRAME;
  let directSum = 0;
  {
    let sock: DirectMockSocket | null = null;
    sock = new DirectMockSocket((b) => {
      /* absorb */
      void b;
    });
    const t0 = performance.now();
    for (let i = 0; i < ROUNDS; i++) {
      sock.send(payload);
    }
    directSum = performance.now() - t0;
  }

  let hopSum = 0;
  {
    let pending = 0;
    await new Promise<void>((resolve) => {
      const sock = new HopMockSocket((_b) => {
        pending += 1;
        if (pending === ROUNDS) resolve();
      });
      sock.addEventListener('open', () => {});
      const t0 = performance.now();
      for (let i = 0; i < ROUNDS; i++) {
        sock.send(payload);
      }
      // wait for hops to flush
      const check = () => {
        if (pending === ROUNDS) {
          hopSum = performance.now() - t0;
          resolve();
        } else {
          queueMicrotask(check);
        }
      };
      check();
    });
  }

  const establishRatio = hop.wallMs / Math.max(direct.wallMs, 0.001);
  const sendRatio = hopSum / Math.max(directSum, 0.001);

  console.log(
    `[unit] extensionPlane perf smoke: establish direct=${direct.wallMs.toFixed(2)}ms hop=${hop.wallMs.toFixed(2)}ms ratio=${establishRatio.toFixed(2)}x; ` +
      `send ${ROUNDS}×16KiB direct=${directSum.toFixed(2)}ms hop=${hopSum.toFixed(2)}ms ratio=${sendRatio.toFixed(2)}x`,
  );

  // Informational gate: hop establish should complete (not hang). Ratio is logged for tuning — not a hard fail.
  assert.ok(hop.wallMs < 2_000, 'hop establish must finish promptly');
  assert.ok(sendRatio < 50, `hop send path unexpectedly pathological (${sendRatio.toFixed(1)}x)`);

  direct.plane.close();
  hop.plane.close();
  void encodeLoopbackHello;
}
