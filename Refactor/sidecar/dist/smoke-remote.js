"use strict";
/**
 * Docker / local smoke helper notes are in README.
 * This script talks to an already-running sidecar (gRPC) using mock or Patchright.
 *
 * Usage:
 *   SPECULUM_SMOKE_TARGET=127.0.0.1:50051 npm run smoke:remote
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
const loadProto_1 = require("./grpc/loadProto");
async function unary(client, method, request, deadlineMs = 60_000) {
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
    const target = process.env['SPECULUM_SMOKE_TARGET'] ?? '127.0.0.1:50051';
    const pkg = (0, loadProto_1.loadBrowserSessionPackage)();
    const Client = pkg.speculum.sidecar.v1.BrowserSessionService;
    const client = new Client(target, grpc.credentials.createInsecure());
    try {
        const created = await unary(client, 'create', {});
        const sessionId = created.sessionId;
        console.log(`[smoke:remote] created ${sessionId}`);
        await unary(client, 'launch', { sessionId, width: 800, height: 600 }, 90_000);
        console.log('[smoke:remote] launched');
        await new Promise((resolve, reject) => {
            const call = client.watchVideo({ sessionId });
            const timer = setTimeout(() => {
                call.cancel();
                reject(new Error('timeout waiting for video frame'));
            }, 30_000);
            call.on('data', (frame) => {
                clearTimeout(timer);
                console.log(`[smoke:remote] frame bytes=${frame.jpeg?.length ?? 0}`);
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
        await unary(client, 'dispose', { sessionId });
        console.log('[smoke:remote] ok');
    }
    finally {
        client.close();
    }
}
main().catch((err) => {
    console.error('[smoke:remote] failed', err);
    process.exit(1);
});
//# sourceMappingURL=smoke-remote.js.map