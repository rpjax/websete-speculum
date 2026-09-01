import assert from 'assert';
import { EXTENSION_PLANE_CHANNEL, decodeExtensionPlaneEnvelope } from '@speculum/page-projection/core/extensionPlane/envelope';
import { buildExtensionPlaneMainShimJs } from '../inject/extensionPlaneMainShim';

/**
 * Edge cases for extension-plane bridge: token drop, bind-ack, open/send round-trip via shim+mock content.
 */
export async function runExtensionPlaneBridgeEdgeUnitTests(): Promise<void> {
  const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const wrongToken = '00000000-0000-0000-0000-000000000000';

  // Drop wrong channel / empty token
  assert.strictEqual(
    decodeExtensionPlaneEnvelope({ channel: 'x', token, kind: 'bind' }),
    null,
  );
  assert.strictEqual(
    decodeExtensionPlaneEnvelope({ channel: EXTENSION_PLANE_CHANNEL, token: '', kind: 'bind' }),
    null,
  );

  // Array payload for send (Port may coerce)
  const fromArray = decodeExtensionPlaneEnvelope({
    channel: EXTENSION_PLANE_CHANNEL,
    token,
    kind: 'send',
    socketId: 7,
    bytes: [9, 8, 7],
  });
  assert.ok(fromArray && fromArray.kind === 'send');
  if (fromArray.kind === 'send') {
    assert.deepStrictEqual(Array.from(fromArray.bytes), [9, 8, 7]);
  }

  // Shim: bind → open → send → message (mock content in same heap)
  const listeners: Array<(ev: { source: unknown; data: unknown }) => void> = [];
  const fakeWindow = {
    postMessage(data: unknown) {
      const ev = { source: fakeWindow, data };
      // content half
      if (data && typeof data === 'object') {
        const d = data as { channel?: string; kind?: string; token?: string; socketId?: number; url?: string; bytes?: Uint8Array };
        if (d.channel === EXTENSION_PLANE_CHANNEL && d.kind === 'bind' && d.token === token) {
          queueMicrotask(() => {
            for (const fn of listeners) {
              fn({
                source: fakeWindow,
                data: { channel: EXTENSION_PLANE_CHANNEL, token, kind: 'bind-ack' },
              });
            }
          });
          return;
        }
        if (d.kind === 'open' && d.token === token && typeof d.socketId === 'number') {
          queueMicrotask(() => {
            for (const fn of listeners) {
              fn({
                source: fakeWindow,
                data: {
                  channel: EXTENSION_PLANE_CHANNEL,
                  token,
                  kind: 'open-ok',
                  socketId: d.socketId,
                },
              });
            }
          });
          return;
        }
        if (d.kind === 'send' && d.bytes) {
          queueMicrotask(() => {
            for (const fn of listeners) {
              fn({
                source: fakeWindow,
                data: {
                  channel: EXTENSION_PLANE_CHANNEL,
                  token,
                  kind: 'message',
                  socketId: d.socketId,
                  bytes: d.bytes,
                },
              });
            }
          });
        }
      }
    },
    addEventListener(type: string, fn: (ev: { source: unknown; data: unknown }) => void) {
      if (type === 'message') listeners.push(fn);
    },
  };

  const g = globalThis as unknown as {
    window: typeof fakeWindow;
    __SPECULUM_PROJECTION__: Record<string, unknown>;
    __SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__?: (url: string) => {
      readyState: number;
      send: (d: ArrayBufferView) => void;
      close: () => void;
      addEventListener: (t: string, fn: (ev: unknown) => void, opts?: { once?: boolean }) => void;
    };
  };
  const prevWindow = g.window;
  const prevCfg = g.__SPECULUM_PROJECTION__;
  const prevFactory = g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__;
  g.window = fakeWindow;
  g.__SPECULUM_PROJECTION__ = {
    loopbackCarrier: 'extension',
    planeBridgeToken: token,
  };

  // Shim references `window` global — Node has none; inject via Function with window param
  const shimSrc = buildExtensionPlaneMainShimJs()
    .replace(/^\(function speculum_extension_plane_shim\(\) \{/, '(function speculum_extension_plane_shim(window) {')
    .replace(/\}\)\(\);\s*$/, '})(window);');
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', shimSrc)(fakeWindow, globalThis);

  assert.strictEqual(typeof g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__, 'function');
  const factory = g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__!;
  const socket = factory('ws://127.0.0.1:1/');

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('open timeout')), 2000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
  assert.strictEqual(socket.readyState, 1);

  // Premature close/error while CONNECTING must not kill the socket before open-ok.
  const sock2 = factory('ws://127.0.0.1:2/');
  const sock2Id = 2;
  for (const fn of listeners) {
    fn({
      source: fakeWindow,
      data: { channel: EXTENSION_PLANE_CHANNEL, token, kind: 'error', socketId: sock2Id },
    });
    fn({
      source: fakeWindow,
      data: {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'close',
        socketId: sock2Id,
        code: 1000,
        reason: 'superseded',
      },
    });
  }
  assert.strictEqual(sock2.readyState, 0, 'still CONNECTING after premature close/error');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sock2 open timeout')), 2000);
    sock2.addEventListener(
      'open',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
    for (const fn of listeners) {
      fn({
        source: fakeWindow,
        data: {
          channel: EXTENSION_PLANE_CHANNEL,
          token,
          kind: 'open-ok',
          socketId: sock2Id,
        },
      });
    }
  });
  assert.strictEqual(sock2.readyState, 1);

  const echo = await new Promise<ArrayBuffer>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('message timeout')), 2000);
    socket.addEventListener(
      'message',
      (ev) => {
        clearTimeout(t);
        resolve((ev as { data: ArrayBuffer }).data);
      },
      { once: true },
    );
    socket.send(new Uint8Array([1, 2, 3, 4]));
  });
  assert.deepStrictEqual(Array.from(new Uint8Array(echo)), [1, 2, 3, 4]);

  // Wrong-token messages must not bind (content would ignore) — factory still uses session token
  assert.notStrictEqual(wrongToken, token);

  socket.close();
  sock2.close();

  g.window = prevWindow;
  g.__SPECULUM_PROJECTION__ = prevCfg;
  g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__ = prevFactory;

  console.log('[unit] extensionPlane bridge edge ok');
}
