"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrowserSessionHandlers = createBrowserSessionHandlers;
const grpc = __importStar(require("@grpc/grpc-js"));
const mappers_1 = require("./mappers");
/* eslint-disable @typescript-eslint/no-explicit-any */
function grpcError(err) {
    const e = err;
    const status = e.code === 'NOT_FOUND'
        ? grpc.status.NOT_FOUND
        : e.code === 'ALREADY_EXISTS'
            ? grpc.status.ALREADY_EXISTS
            : e.code === 'FAILED_PRECONDITION'
                ? grpc.status.FAILED_PRECONDITION
                : grpc.status.INTERNAL;
    return Object.assign(new Error(e.message ?? String(err)), {
        code: status,
        details: e.message ?? String(err),
    });
}
function sessionIdOf(req) {
    return req.sessionId ?? req.session_id ?? '';
}
async function pumpQueue(queue, call, map, signal) {
    for (;;) {
        const item = await queue.read(signal);
        if (item === null || signal.aborted || call.cancelled)
            break;
        const ok = call.write(map(item));
        if (!ok) {
            await new Promise((resolve) => {
                const onDrain = () => {
                    cleanup();
                    resolve();
                };
                const onAbort = () => {
                    cleanup();
                    resolve();
                };
                const cleanup = () => {
                    call.off('drain', onDrain);
                    signal.removeEventListener('abort', onAbort);
                };
                call.once('drain', onDrain);
                signal.addEventListener('abort', onAbort, { once: true });
            });
            if (signal.aborted || call.cancelled)
                break;
        }
    }
}
function createBrowserSessionHandlers(registry) {
    return {
        create(call, callback) {
            try {
                const entry = registry.create(call.request.sessionId);
                callback(null, { sessionId: entry.session.sessionId });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async launch(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const ready = await session.launch((0, mappers_1.toLaunchOptions)(call.request));
                callback(null, ready);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async stop(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                await session.stop();
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async dispose(call, callback) {
            try {
                await registry.dispose(sessionIdOf(call.request));
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async getStatus(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const status = await session.getStatus();
                callback(null, {
                    isOpen: status.isOpen,
                    tabCount: status.tabCount,
                    url: status.url,
                    resizing: status.resizing,
                    width: status.width,
                    height: status.height,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async restoreState(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                await session.restoreState((0, mappers_1.toBrowserState)(call.request.state));
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async exportState(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const state = await session.exportState();
                callback(null, (0, mappers_1.fromBrowserState)(state));
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async navigate(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                await session.navigate(call.request.url);
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async refresh(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                await session.refresh();
                callback(null, {});
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async resize(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const result = await session.resize({
                    width: call.request.width,
                    height: call.request.height,
                    device: (0, mappers_1.toDevice)(call.request.device ?? {}),
                });
                callback(null, result);
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async probe(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const result = await session.probe({
                    ops: call.request.ops ?? [],
                    evaluateExpression: call.request.evaluateExpression,
                    domSelector: call.request.domSelector,
                });
                callback(null, {
                    ok: result.ok,
                    dataJson: result.data !== undefined ? JSON.stringify(result.data) : undefined,
                    errorCode: result.errorCode,
                    message: result.message,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        async evaluate(call, callback) {
            try {
                const { session } = registry.get(sessionIdOf(call.request));
                const result = await session.evaluate(call.request.code);
                callback(null, {
                    ok: result.ok,
                    value: result.value,
                    errorMessage: result.errorMessage,
                });
            }
            catch (err) {
                callback(grpcError(err), null);
            }
        },
        watchVideo(call) {
            watchStream(call, registry, (b) => b.video, (jpeg) => ({ jpeg }));
        },
        watchAudio(call) {
            watchStream(call, registry, (b) => b.audio, (chunk) => ({ chunk }));
        },
        watchConsole(call) {
            watchStream(call, registry, (b) => b.consoleQ, (e) => e);
        },
        watchLocation(call) {
            watchStream(call, registry, (b) => b.location, (url) => ({ url }));
        },
        watchNavigationBlocked(call) {
            watchStream(call, registry, (b) => b.navigationBlocked, (url) => ({ url }));
        },
        watchEditableFocus(call) {
            watchStream(call, registry, (b) => b.editableFocus, (editing) => (0, mappers_1.editingToProto)(editing));
        },
        watchCrash(call) {
            watchStream(call, registry, (b) => b.crash, (f) => ({
                errorCode: f.errorCode,
                message: f.message,
                phase: f.phase,
            }));
        },
        pushInput(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const sid = sessionIdOf(msg);
                const { session } = registry.get(sid);
                const input = (0, mappers_1.toBrowserInput)(msg);
                if (input)
                    await session.pushInput(input);
            });
        },
        pushCamera(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const { session } = registry.get(sessionIdOf(msg));
                const data = msg.data;
                await session.pushCameraFrame(new Uint8Array(data));
            });
        },
        pushMicrophone(call, callback) {
            pumpClientStream(call, callback, async (msg) => {
                const { session } = registry.get(sessionIdOf(msg));
                const data = msg.data;
                await session.pushMicrophoneAudio(new Uint8Array(data));
            });
        },
        control(call) {
            const bridges = new Map();
            const attachBridge = (bridge) => {
                if (bridges.has(bridge.sessionId))
                    return;
                bridges.set(bridge.sessionId, bridge);
                bridge.setPermissionSink((req) => {
                    const kindEnum = req.kind === 'camera'
                        ? 'PERMISSION_KIND_CAMERA'
                        : 'PERMISSION_KIND_MICROPHONE';
                    call.write({
                        permissionRequest: {
                            corrId: req.corrId,
                            kind: kindEnum,
                            sessionId: req.sessionId,
                        },
                    });
                });
            };
            for (const bridge of registry.listBridges()) {
                attachBridge(bridge);
            }
            const unsubscribe = registry.onCreate((entry) => attachBridge(entry.bridge));
            call.on('data', (msg) => {
                const reply = msg.permissionReply;
                if (!reply)
                    return;
                const bridge = bridges.get(reply.sessionId);
                if (!bridge)
                    return;
                bridge.resolvePermission(reply.corrId, !!reply.allow);
            });
            const cleanup = () => {
                unsubscribe();
                for (const bridge of bridges.values()) {
                    bridge.setPermissionSink(null);
                }
                bridges.clear();
            };
            call.on('end', () => {
                cleanup();
                call.end();
            });
            call.on('error', () => cleanup());
            call.on('cancelled', () => cleanup());
        },
    };
}
function watchStream(call, registry, pick, map) {
    let entry;
    try {
        entry = registry.get(sessionIdOf(call.request));
    }
    catch (err) {
        call.destroy(grpcError(err));
        return;
    }
    const ac = new AbortController();
    call.on('cancelled', () => ac.abort());
    call.on('close', () => ac.abort());
    call.on('error', () => ac.abort());
    void pumpQueue(pick(entry.bridge), call, map, ac.signal)
        .then(() => {
        if (!call.cancelled)
            call.end();
    })
        .catch((err) => {
        if (!call.cancelled)
            call.destroy(grpcError(err));
    });
}
function pumpClientStream(call, callback, onMsg) {
    let failed = null;
    let chain = Promise.resolve();
    call.on('data', (msg) => {
        chain = chain.then(async () => {
            if (failed)
                return;
            try {
                await onMsg(msg);
            }
            catch (err) {
                failed = err;
                call.destroy(grpcError(err));
            }
        });
    });
    call.on('end', () => {
        void chain.then(() => {
            if (!failed)
                callback(null, {});
        });
    });
    call.on('error', (err) => {
        failed = err;
    });
}
//# sourceMappingURL=BrowserSessionService.js.map