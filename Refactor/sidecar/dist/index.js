"use strict";
/**
 * Composition root — Patchright BrowserSession by default; mock when SPECULUM_BROWSER=mock.
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
exports.resolveBrowserFactory = resolveBrowserFactory;
exports.createSidecarServer = createSidecarServer;
exports.bindAndStart = bindAndStart;
exports.startHealthServer = startHealthServer;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const grpc = __importStar(require("@grpc/grpc-js"));
const MockBrowserSession_1 = require("./browser/MockBrowserSession");
const createPatchrightFactory_1 = require("./browser/patchright/createPatchrightFactory");
const SessionRegistry_1 = require("./host/SessionRegistry");
const loadProto_1 = require("./grpc/loadProto");
const BrowserSessionService_1 = require("./grpc/BrowserSessionService");
function requireEnv(name) {
    const value = process.env[name];
    if (!value?.trim()) {
        throw new Error(`${name} environment variable is required`);
    }
    return value.trim();
}
function resolveBrowserMode() {
    const mode = requireEnv('SPECULUM_BROWSER');
    if (mode !== 'mock' && mode !== 'patchright') {
        throw new Error('SPECULUM_BROWSER must be "mock" or "patchright"');
    }
    return mode;
}
function resolveBrowserFactory(options) {
    if (resolveBrowserMode() === 'mock') {
        return (0, MockBrowserSession_1.createMockBrowserSessionFactory)({
            emitFrames: options.emitFrames,
            frameIntervalMs: options.frameIntervalMs,
        });
    }
    requireEnv('CHROME_EXECUTABLE');
    return (0, createPatchrightFactory_1.createPatchrightFactory)();
}
function createSidecarServer(options) {
    const registry = new SessionRegistry_1.SessionRegistry(options.factory);
    const server = new grpc.Server();
    server.addService((0, loadProto_1.getBrowserSessionService)(), (0, BrowserSessionService_1.createBrowserSessionHandlers)(registry));
    return { server, registry };
}
function bindAndStart(server, bindAddress) {
    return new Promise((resolve, reject) => {
        server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err, port) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(`0.0.0.0:${port}`);
        });
    });
}
function chromePresent() {
    if (resolveBrowserMode() === 'mock')
        return true;
    try {
        return fs.existsSync(requireEnv('CHROME_EXECUTABLE'));
    }
    catch {
        return false;
    }
}
function startHealthServer(port) {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }
        if (req.url === '/ready') {
            const ready = chromePresent();
            const chromeExecutable = process.env['CHROME_EXECUTABLE'] ?? '';
            res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                status: ready ? 'ready' : 'not_ready',
                chrome: chromeExecutable,
                chromePresent: ready,
                browser: process.env['SPECULUM_BROWSER'] ?? '',
            }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    server.listen(port, '0.0.0.0', () => {
        console.log(`[sidecar-refactor] health HTTP on 0.0.0.0:${port}`);
    });
    return server;
}
function tryShutdownGrpc(server, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            server.forceShutdown();
            resolve();
        }, timeoutMs);
        server.tryShutdown((err) => {
            clearTimeout(timer);
            if (err)
                server.forceShutdown();
            resolve();
        });
    });
}
async function main() {
    const mode = resolveBrowserMode();
    const grpcPort = requireEnv('SPECULUM_GRPC_PORT');
    const healthPort = Number(requireEnv('SPECULUM_HEALTH_PORT'));
    const factory = resolveBrowserFactory({ emitFrames: true, frameIntervalMs: 500 });
    const { server, registry } = createSidecarServer({
        emitFrames: true,
        frameIntervalMs: 500,
        factory,
    });
    const health = startHealthServer(healthPort);
    const addr = await bindAndStart(server, `0.0.0.0:${grpcPort}`);
    console.log(`[sidecar-refactor] BrowserSessionService (${mode}) listening on ${addr}`);
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log(`[sidecar-refactor] ${signal} — graceful shutdown`);
        await new Promise((resolve) => health.close(() => resolve()));
        await registry.disposeAll();
        await tryShutdownGrpc(server, 10_000);
        process.exit(0);
    };
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
}
if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map