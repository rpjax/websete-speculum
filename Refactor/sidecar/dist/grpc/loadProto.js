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
exports.loadBrowserSessionPackage = loadBrowserSessionPackage;
exports.getBrowserSessionService = getBrowserSessionService;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
function resolveProtoPath() {
    const candidates = [
        path.resolve(__dirname, '../../../proto/browser_session.proto'), // dist/grpc
        path.resolve(__dirname, '../../proto/browser_session.proto'), // grpc (ts-node)
        path.resolve(process.cwd(), '../proto/browser_session.proto'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate))
            return candidate;
    }
    throw new Error(`browser_session.proto not found. Tried:\n${candidates.join('\n')}`);
}
function loadBrowserSessionPackage() {
    const definition = protoLoader.loadSync(resolveProtoPath(), {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    return grpc.loadPackageDefinition(definition);
}
function getBrowserSessionService() {
    const pkg = loadBrowserSessionPackage();
    const ctor = pkg.speculum.sidecar.v1.BrowserSessionService;
    return ctor.service;
}
//# sourceMappingURL=loadProto.js.map