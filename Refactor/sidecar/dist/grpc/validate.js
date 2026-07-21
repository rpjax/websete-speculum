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
exports.VIEWPORT_LIMITS = void 0;
exports.validateLaunchViewport = validateLaunchViewport;
exports.validateResizeViewport = validateResizeViewport;
exports.requireSessionId = requireSessionId;
exports.requireUrl = requireUrl;
exports.requireProbeOps = requireProbeOps;
exports.requireEvaluateCode = requireEvaluateCode;
exports.requireState = requireState;
exports.requireBinaryData = requireBinaryData;
exports.grpcInvalidArgument = grpcInvalidArgument;
exports.grpcFailedPrecondition = grpcFailedPrecondition;
exports.mapGrpcError = mapGrpcError;
const grpc = __importStar(require("@grpc/grpc-js"));
/** Viewport bounds — keep in sync with GrpcRequestValidation / viewport-bounds.ts */
exports.VIEWPORT_LIMITS = {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 4096,
    maxHeight: 2160,
};
function validateLaunchViewport(width, height) {
    return validateViewport(width, height);
}
function validateResizeViewport(width, height) {
    return validateViewport(width, height);
}
function validateViewport(width, height) {
    const w = Math.round(width);
    const h = Math.round(height);
    if (!Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < exports.VIEWPORT_LIMITS.minWidth ||
        h < exports.VIEWPORT_LIMITS.minHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} below minimum ` +
                `${exports.VIEWPORT_LIMITS.minWidth}×${exports.VIEWPORT_LIMITS.minHeight}`,
        };
    }
    if (w > exports.VIEWPORT_LIMITS.maxWidth || h > exports.VIEWPORT_LIMITS.maxHeight) {
        return {
            ok: false,
            errorCode: 'invalid_viewport',
            message: `viewport ${w}×${h} above maximum ` +
                `${exports.VIEWPORT_LIMITS.maxWidth}×${exports.VIEWPORT_LIMITS.maxHeight}`,
        };
    }
    return { ok: true, width: w, height: h };
}
function requireSessionId(req) {
    const id = (req.sessionId ?? req.session_id ?? '').trim();
    if (!id) {
        throw grpcInvalidArgument('session_id is required');
    }
    return id;
}
function requireUrl(url) {
    if (typeof url !== 'string' || !url.trim()) {
        throw grpcInvalidArgument('url is required');
    }
    return url.trim();
}
function requireProbeOps(ops) {
    if (!Array.isArray(ops) || ops.length === 0) {
        throw grpcInvalidArgument('probe ops must be a non-empty array');
    }
    return ops.map(String);
}
function requireEvaluateCode(code) {
    if (typeof code !== 'string' || !code.trim()) {
        throw grpcInvalidArgument('evaluate code is required');
    }
    return code;
}
function requireState(state) {
    if (state === null || state === undefined) {
        throw grpcInvalidArgument('state is required');
    }
}
function requireBinaryData(data, field) {
    if (data === null || data === undefined) {
        throw grpcInvalidArgument(`${field} is required`);
    }
    if (Buffer.isBuffer(data)) {
        return new Uint8Array(data);
    }
    if (data instanceof Uint8Array) {
        return data;
    }
    throw grpcInvalidArgument(`${field} must be bytes`);
}
function grpcInvalidArgument(message) {
    return Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
}
function grpcFailedPrecondition(errorCode, phase, message) {
    return Object.assign(new Error(message), {
        code: 'FAILED_PRECONDITION',
        errorCode,
        phase,
    });
}
function mapGrpcError(err) {
    const e = err;
    const status = e.code === 'NOT_FOUND'
        ? grpc.status.NOT_FOUND
        : e.code === 'ALREADY_EXISTS'
            ? grpc.status.ALREADY_EXISTS
            : e.code === 'INVALID_ARGUMENT'
                ? grpc.status.INVALID_ARGUMENT
                : e.code === 'FAILED_PRECONDITION'
                    ? grpc.status.FAILED_PRECONDITION
                    : grpc.status.INTERNAL;
    return Object.assign(new Error(e.message ?? String(err)), {
        code: status,
        details: e.message ?? String(err),
    });
}
//# sourceMappingURL=validate.js.map