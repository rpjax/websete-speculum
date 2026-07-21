import * as grpc from '@grpc/grpc-js';

/** Viewport bounds — keep in sync with GrpcRequestValidation / viewport-bounds.ts */
export const VIEWPORT_LIMITS = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
} as const;

export type ViewportValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; errorCode: 'invalid_viewport'; message: string };

export function validateLaunchViewport(width: number, height: number): ViewportValidation {
  return validateViewport(width, height);
}

export function validateResizeViewport(width: number, height: number): ViewportValidation {
  return validateViewport(width, height);
}

function validateViewport(width: number, height: number): ViewportValidation {
  const w = Math.round(width);
  const h = Math.round(height);
  if (
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w < VIEWPORT_LIMITS.minWidth ||
    h < VIEWPORT_LIMITS.minHeight
  ) {
    return {
      ok: false,
      errorCode: 'invalid_viewport',
      message:
        `viewport ${w}×${h} below minimum ` +
        `${VIEWPORT_LIMITS.minWidth}×${VIEWPORT_LIMITS.minHeight}`,
    };
  }
  if (w > VIEWPORT_LIMITS.maxWidth || h > VIEWPORT_LIMITS.maxHeight) {
    return {
      ok: false,
      errorCode: 'invalid_viewport',
      message:
        `viewport ${w}×${h} above maximum ` +
        `${VIEWPORT_LIMITS.maxWidth}×${VIEWPORT_LIMITS.maxHeight}`,
    };
  }
  return { ok: true, width: w, height: h };
}

export function requireSessionId(req: { sessionId?: string; session_id?: string }): string {
  const id = (req.sessionId ?? req.session_id ?? '').trim();
  if (!id) {
    throw grpcInvalidArgument('session_id is required');
  }
  return id;
}

export function requireUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) {
    throw grpcInvalidArgument('url is required');
  }
  return url.trim();
}

export function requireProbeOps(ops: unknown): string[] {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw grpcInvalidArgument('probe ops must be a non-empty array');
  }
  return ops.map(String);
}

export function requireEvaluateCode(code: unknown): string {
  if (typeof code !== 'string' || !code.trim()) {
    throw grpcInvalidArgument('evaluate code is required');
  }
  return code;
}

export function requireState(state: unknown): void {
  if (state === null || state === undefined) {
    throw grpcInvalidArgument('state is required');
  }
}

export function requireBinaryData(data: unknown, field: string): Uint8Array {
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

export function grpcInvalidArgument(message: string): Error {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
}

export function grpcFailedPrecondition(
  errorCode: string,
  phase: string,
  message: string,
): Error {
  return Object.assign(new Error(message), {
    code: 'FAILED_PRECONDITION',
    errorCode,
    phase,
  });
}

export function mapGrpcError(err: unknown): grpc.ServiceError {
  const e = err as { code?: string; message?: string };
  const status =
    e.code === 'NOT_FOUND'
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
  }) as grpc.ServiceError;
}
