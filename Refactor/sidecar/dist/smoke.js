"use strict";
/**
 * Smoke: Create → Launch → WatchVideo (receive ≥1 frame) while GetStatus succeeds in parallel.
 */
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
const grpc = __importStar(require("@grpc/grpc-js"));
const MockBrowserSession_1 = require("./browser/MockBrowserSession");
const index_1 = require("./index");
const loadProto_1 = require("./grpc/loadProto");
async function unary(client, method, request, deadlineMs = 5_000) {
    return new Promise((resolve, reject) => {
        const deadline = new Date(Date.now() + deadlineMs);
        client[method](request, { deadline }, (err, res) => {
            if (err)
                reject(err);
            else
                resolve(res);
        });
    });
}
async function main() {
    process.env['SPECULUM_BROWSER'] = 'mock';
    const factory = (0, MockBrowserSession_1.createMockBrowserSessionFactory)({ emitFrames: true, frameIntervalMs: 100 });
    const { server } = (0, index_1.createSidecarServer)({
        emitFrames: true,
        frameIntervalMs: 100,
        factory,
    });
    const addr = await (0, index_1.bindAndStart)(server, '127.0.0.1:0');
    const target = addr.replace('0.0.0.0', '127.0.0.1');
    const pkg = (0, loadProto_1.loadBrowserSessionPackage)();
    const Client = pkg.speculum.sidecar.v1.BrowserSessionService;
    const client = new Client(target, grpc.credentials.createInsecure());
    try {
        const created = await unary(client, 'create', {});
        const sessionId = created.sessionId;
        console.log(`[smoke] created session ${sessionId}`);
        await unary(client, 'launch', {
            sessionId,
            width: 800,
            height: 600,
        });
        console.log('[smoke] launched');
        const framePromise = new Promise((resolve, reject) => {
            const call = client.watchVideo({ sessionId });
            const timer = setTimeout(() => {
                call.cancel();
                reject(new Error('timeout waiting for video frame'));
            }, 5_000);
            call.on('data', (frame) => {
                clearTimeout(timer);
                console.log(`[smoke] video frame bytes=${frame.jpeg?.length ?? 0}`);
                call.cancel();
                resolve();
            });
            call.on('error', (err) => {
                if (err.code === grpc.status.CANCELLED)
                    return;
                clearTimeout(timer);
                reject(err);
            });
        });
        const statusPromise = (async () => {
            for (let i = 0; i < 5; i++) {
                const status = await unary(client, 'getStatus', { sessionId });
                console.log(`[smoke] getStatus #${i + 1} open=${status.isOpen} ${status.width}x${status.height}`);
            }
        })();
        await Promise.all([framePromise, statusPromise]);
        await unary(client, 'dispose', { sessionId });
        console.log('[smoke] ok');
    }
    finally {
        client.close();
        server.forceShutdown();
    }
}
main().catch((err) => {
    console.error('[smoke] failed', err);
    process.exit(1);
});
//# sourceMappingURL=smoke.js.map