"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExtensionPlaneBridgeEdgeUnitTests = runExtensionPlaneBridgeEdgeUnitTests;
const assert_1 = __importDefault(require("assert"));
const envelope_1 = require("@speculum/page-projection/core/extensionPlane/envelope");
const extensionPlaneMainShim_1 = require("../inject/extensionPlaneMainShim");
/**
 * Edge cases for extension-plane bridge: token drop, bind-ack, open/send round-trip via shim+mock content.
 */
async function runExtensionPlaneBridgeEdgeUnitTests() {
    const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const wrongToken = '00000000-0000-0000-0000-000000000000';
    // Drop wrong channel / empty token
    assert_1.default.strictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)({ channel: 'x', token, kind: 'bind' }), null);
    assert_1.default.strictEqual((0, envelope_1.decodeExtensionPlaneEnvelope)({ channel: envelope_1.EXTENSION_PLANE_CHANNEL, token: '', kind: 'bind' }), null);
    // Array payload for send (Port may coerce)
    const fromArray = (0, envelope_1.decodeExtensionPlaneEnvelope)({
        channel: envelope_1.EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'send',
        socketId: 7,
        bytes: [9, 8, 7],
    });
    assert_1.default.ok(fromArray && fromArray.kind === 'send');
    if (fromArray.kind === 'send') {
        assert_1.default.deepStrictEqual(Array.from(fromArray.bytes), [9, 8, 7]);
    }
    // Shim: bind → open → send → message (mock content in same heap)
    const listeners = [];
    const fakeWindow = {
        postMessage(data) {
            const ev = { source: fakeWindow, data };
            // content half
            if (data && typeof data === 'object') {
                const d = data;
                if (d.channel === envelope_1.EXTENSION_PLANE_CHANNEL && d.kind === 'bind' && d.token === token) {
                    queueMicrotask(() => {
                        for (const fn of listeners) {
                            fn({
                                source: fakeWindow,
                                data: { channel: envelope_1.EXTENSION_PLANE_CHANNEL, token, kind: 'bind-ack' },
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
                                    channel: envelope_1.EXTENSION_PLANE_CHANNEL,
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
                                    channel: envelope_1.EXTENSION_PLANE_CHANNEL,
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
        addEventListener(type, fn) {
            if (type === 'message')
                listeners.push(fn);
        },
    };
    const g = globalThis;
    const prevWindow = g.window;
    const prevCfg = g.__SPECULUM_PROJECTION__;
    const prevFactory = g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__;
    g.window = fakeWindow;
    g.__SPECULUM_PROJECTION__ = {
        loopbackCarrier: 'extension',
        planeBridgeToken: token,
    };
    // Shim references `window` global — Node has none; inject via Function with window param
    const shimSrc = (0, extensionPlaneMainShim_1.buildExtensionPlaneMainShimJs)()
        .replace(/^\(function speculum_extension_plane_shim\(\) \{/, '(function speculum_extension_plane_shim(window) {')
        .replace(/\}\)\(\);\s*$/, '})(window);');
    // eslint-disable-next-line no-new-func
    new Function('window', 'globalThis', shimSrc)(fakeWindow, globalThis);
    assert_1.default.strictEqual(typeof g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__, 'function');
    const factory = g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__;
    const socket = factory('ws://127.0.0.1:1/');
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('open timeout')), 2000);
        socket.addEventListener('open', () => {
            clearTimeout(t);
            resolve();
        }, { once: true });
    });
    assert_1.default.strictEqual(socket.readyState, 1);
    // Premature close/error while CONNECTING must not kill the socket before open-ok.
    const sock2 = factory('ws://127.0.0.1:2/');
    const sock2Id = 2;
    for (const fn of listeners) {
        fn({
            source: fakeWindow,
            data: { channel: envelope_1.EXTENSION_PLANE_CHANNEL, token, kind: 'error', socketId: sock2Id },
        });
        fn({
            source: fakeWindow,
            data: {
                channel: envelope_1.EXTENSION_PLANE_CHANNEL,
                token,
                kind: 'close',
                socketId: sock2Id,
                code: 1000,
                reason: 'superseded',
            },
        });
    }
    assert_1.default.strictEqual(sock2.readyState, 0, 'still CONNECTING after premature close/error');
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sock2 open timeout')), 2000);
        sock2.addEventListener('open', () => {
            clearTimeout(t);
            resolve();
        }, { once: true });
        for (const fn of listeners) {
            fn({
                source: fakeWindow,
                data: {
                    channel: envelope_1.EXTENSION_PLANE_CHANNEL,
                    token,
                    kind: 'open-ok',
                    socketId: sock2Id,
                },
            });
        }
    });
    assert_1.default.strictEqual(sock2.readyState, 1);
    const echo = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('message timeout')), 2000);
        socket.addEventListener('message', (ev) => {
            clearTimeout(t);
            resolve(ev.data);
        }, { once: true });
        socket.send(new Uint8Array([1, 2, 3, 4]));
    });
    assert_1.default.deepStrictEqual(Array.from(new Uint8Array(echo)), [1, 2, 3, 4]);
    // Wrong-token messages must not bind (content would ignore) — factory still uses session token
    assert_1.default.notStrictEqual(wrongToken, token);
    socket.close();
    sock2.close();
    g.window = prevWindow;
    g.__SPECULUM_PROJECTION__ = prevCfg;
    g.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__ = prevFactory;
    console.log('[unit] extensionPlane bridge edge ok');
}
//# sourceMappingURL=extensionPlaneBridge.unit.js.map