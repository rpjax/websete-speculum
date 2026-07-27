import * as grpc from '@grpc/grpc-js';

/**
 * Per-session viewport bounds from Sessions.ViewportPolicy (via LaunchRequest).
 * Not a module-level product constant — launch supplies the sole truth.
 */
export interface ViewportPolicyBounds {
  minWidth: number;
  minHeight: number;
  /** Capacity / Xvfb size (= policy Maximum). */
  maxWidth: number;
  maxHeight: number;
}

export type ViewportValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; errorCode: 'invalid_viewport'; message: string };

/** Parse LaunchRequest min_* / display_* — required; no silent defaults. */
export function requireViewportPolicy(req: {
  minWidth?: number;
  min_width?: number;
  minHeight?: number;
  min_height?: number;
  displayWidth?: number;
  display_width?: number;
  displayHeight?: number;
  display_height?: number;
}): ViewportPolicyBounds {
  const minWidth = Number(req.minWidth ?? req.min_width);
  const minHeight = Number(req.minHeight ?? req.min_height);
  const maxWidth = Number(req.displayWidth ?? req.display_width);
  const maxHeight = Number(req.displayHeight ?? req.display_height);
  if (
    !Number.isFinite(minWidth)
    || !Number.isFinite(minHeight)
    || !Number.isFinite(maxWidth)
    || !Number.isFinite(maxHeight)
    || minWidth < 1
    || minHeight < 1
    || maxWidth < minWidth
    || maxHeight < minHeight
  ) {
    throw grpcInvalidArgument(
      'Launch requires Sessions.ViewportPolicy bounds '
        + '(min_width/min_height/display_width/display_height with 0 < min <= display)',
    );
  }
  return {
    minWidth: Math.round(minWidth),
    minHeight: Math.round(minHeight),
    maxWidth: Math.round(maxWidth),
    maxHeight: Math.round(maxHeight),
  };
}

export function validateLaunchViewport(
  width: number,
  height: number,
  policy: ViewportPolicyBounds,
): ViewportValidation {
  return validateViewport(width, height, policy);
}

export function validateResizeViewport(
  width: number,
  height: number,
  policy: ViewportPolicyBounds,
): ViewportValidation {
  return validateViewport(width, height, policy);
}

function validateViewport(
  width: number,
  height: number,
  policy: ViewportPolicyBounds,
): ViewportValidation {
  const w = Math.round(width);
  const h = Math.round(height);
  if (
    !Number.isFinite(w)
    || !Number.isFinite(h)
    || w < policy.minWidth
    || h < policy.minHeight
  ) {
    return {
      ok: false,
      errorCode: 'invalid_viewport',
      message:
        `viewport ${w}×${h} below minimum `
        + `${policy.minWidth}×${policy.minHeight}`,
    };
  }
  if (w > policy.maxWidth || h > policy.maxHeight) {
    return {
      ok: false,
      errorCode: 'invalid_viewport',
      message:
        `viewport ${w}×${h} above maximum `
        + `${policy.maxWidth}×${policy.maxHeight}`,
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
            : e.code === 'ABORTED'
              ? grpc.status.ABORTED
              : grpc.status.INTERNAL;
  return Object.assign(new Error(e.message ?? String(err)), {
    code: status,
    details: e.message ?? String(err),
  }) as grpc.ServiceError;
}
