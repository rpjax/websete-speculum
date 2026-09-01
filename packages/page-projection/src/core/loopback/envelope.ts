/**
 * Virtual ↔ sidecar loopback mux envelope (§10.1c / D-UI-28).
 * Wire: JSON UTF-8 bytes on the WebSocket (LB-06 shape).
 */

import { PlaneChannel } from '../plane/channels';

export const VIRTUAL_LOOPBACK_CHANNEL = 'speculum.virtual.loopback' as const;

/** Fire-and-forget Control payloads (e.g. requestResync) still ride invoke name until moved. */
export const LOOPBACK_CONTROL_INVOKE_NAME = '__control' as const;

/** LB-04 — invoke idle timeout default. */
export const LOOPBACK_INVOKE_IDLE_MS = 2000;

/** Same rule as ContextBus HEARTBEAT_INTERVAL_MS — resets sidecar idle while Virtual works. */
export const LOOPBACK_INVOKE_HEARTBEAT_MS = 500;

/** LB-14 — establishment timeouts (ms). */
export const LOOPBACK_WS_OPEN_TIMEOUT_MS = 15_000;
export const LOOPBACK_HELLO_ACK_TIMEOUT_MS = 5_000;
export const LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS = 20_000;

/** LB-15 — private WebSocket close when generation superseded. */
export const LOOPBACK_GENERATION_SUPERSEDED_CODE = 4000;
export const LOOPBACK_GENERATION_SUPERSEDED_REASON = 'speculum:generation_superseded';

export type HelloRejectReason =
  | 'generation_mismatch'
  | 'session_mismatch'
  | 'already_established'
  | 'protocol_unsupported'
  | 'server_shutting_down';

export type LoopbackConnectionState =
  | 'closed'
  | 'connecting'
  | 'established'
  | 'failed'
  | 'degraded';

export type LoopbackConnectionStatus = {
  state: LoopbackConnectionState;
  generation: number;
  sessionId: string;
  lastError?: { code: string; message: string };
};

export type LoopbackKind =
  | 'hello'
  | 'hello-ack'
  | 'hello-reject'
  | 'frame'
  | 'telemetry'
  | 'invoke'
  | 'invoke-started'
  | 'invoke-heartbeat'
  | 'invoke-result';

export type LoopbackEnvelope =
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'hello';
      sessionId: string;
      generation: number;
      role: 'virtual-root';
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'hello-ack';
      sessionId: string;
      generation: number;
      ok: true;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'hello-reject';
      sessionId: string;
      generation: number;
      ok: false;
      reason: HelloRejectReason;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'frame';
      bytes: number[];
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'telemetry';
      message: unknown;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke';
      correlationId: number;
      name: string;
      args: unknown;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke-started';
      correlationId: number;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke-heartbeat';
      correlationId: number;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke-result';
      correlationId: number;
      ok: boolean;
      value?: unknown;
      error?: { message: string; name?: string };
    };

export type LoopbackInvokeResult = {
  ok: boolean;
  value?: unknown;
  error?: { message: string; name?: string };
};

export type LoopbackInvokeHandler = (
  name: string,
  args: unknown,
) => Promise<unknown> | unknown;

export function encodeLoopbackEnvelope(env: LoopbackEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(env));
}

export function decodeLoopbackEnvelope(message: Uint8Array): LoopbackEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(message));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Partial<LoopbackEnvelope> & { kind?: string };
  if (env.channel !== VIRTUAL_LOOPBACK_CHANNEL || typeof env.kind !== 'string') return null;

  switch (env.kind) {
    case 'hello': {
      const h = env as {
        sessionId?: unknown;
        generation?: unknown;
        role?: unknown;
      };
      if (typeof h.sessionId !== 'string' || typeof h.generation !== 'number') return null;
      if (h.role !== 'virtual-root') return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'hello',
        sessionId: h.sessionId,
        generation: h.generation >>> 0,
        role: 'virtual-root',
      };
    }
    case 'hello-ack': {
      const ack = env as { sessionId?: unknown; generation?: unknown; ok?: unknown };
      if (typeof ack.sessionId !== 'string' || typeof ack.generation !== 'number') return null;
      if (ack.ok !== true) return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'hello-ack',
        sessionId: ack.sessionId,
        generation: ack.generation >>> 0,
        ok: true,
      };
    }
    case 'hello-reject': {
      const rej = env as {
        sessionId?: unknown;
        generation?: unknown;
        ok?: unknown;
        reason?: unknown;
      };
      if (typeof rej.sessionId !== 'string' || typeof rej.generation !== 'number') return null;
      if (rej.ok !== false) return null;
      const reason = rej.reason;
      if (
        reason !== 'generation_mismatch' &&
        reason !== 'session_mismatch' &&
        reason !== 'already_established' &&
        reason !== 'protocol_unsupported' &&
        reason !== 'server_shutting_down'
      ) {
        return null;
      }
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'hello-reject',
        sessionId: rej.sessionId,
        generation: rej.generation >>> 0,
        ok: false,
        reason,
      };
    }
    case 'frame': {
      const bytes = (env as { bytes?: unknown }).bytes;
      if (!Array.isArray(bytes)) return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'frame',
        bytes: bytes as number[],
      };
    }
    case 'telemetry':
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'telemetry',
        message: (env as { message?: unknown }).message,
      };
    case 'invoke': {
      const inv = env as { correlationId?: unknown; name?: unknown; args?: unknown };
      if (typeof inv.correlationId !== 'number' || typeof inv.name !== 'string') return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'invoke',
        correlationId: inv.correlationId >>> 0,
        name: inv.name,
        args: inv.args,
      };
    }
    case 'invoke-started':
    case 'invoke-heartbeat': {
      const hb = env as { correlationId?: unknown };
      if (typeof hb.correlationId !== 'number') return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: env.kind,
        correlationId: hb.correlationId >>> 0,
      };
    }
    case 'invoke-result': {
      const res = env as {
        correlationId?: unknown;
        ok?: unknown;
        value?: unknown;
        error?: { message?: string; name?: string };
      };
      if (typeof res.correlationId !== 'number' || typeof res.ok !== 'boolean') return null;
      return {
        channel: VIRTUAL_LOOPBACK_CHANNEL,
        kind: 'invoke-result',
        correlationId: res.correlationId >>> 0,
        ok: res.ok,
        value: res.value,
        error:
          res.error && typeof res.error.message === 'string'
            ? { message: res.error.message, name: res.error.name }
            : undefined,
      };
    }
    default:
      return null;
  }
}

export function encodeLoopbackHello(
  sessionId: string,
  generation: number,
  role: 'virtual-root' = 'virtual-root',
): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'hello',
    sessionId,
    generation: generation >>> 0,
    role,
  });
}

export function encodeLoopbackHelloAck(sessionId: string, generation: number): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'hello-ack',
    sessionId,
    generation: generation >>> 0,
    ok: true,
  });
}

export function encodeLoopbackHelloReject(
  sessionId: string,
  generation: number,
  reason: HelloRejectReason,
): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'hello-reject',
    sessionId,
    generation: generation >>> 0,
    ok: false,
    reason,
  });
}

export function encodeLoopbackInvoke(
  correlationId: number,
  name: string,
  args: unknown,
): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'invoke',
    correlationId: correlationId >>> 0,
    name,
    args,
  });
}

export function encodeLoopbackInvokeResult(
  correlationId: number,
  result: LoopbackInvokeResult,
): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'invoke-result',
    correlationId: correlationId >>> 0,
    ok: result.ok,
    value: result.value,
    error: result.error,
  });
}

export function encodeLoopbackInvokeStarted(correlationId: number): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'invoke-started',
    correlationId: correlationId >>> 0,
  });
}

export function encodeLoopbackInvokeHeartbeat(correlationId: number): Uint8Array {
  return encodeLoopbackEnvelope({
    channel: VIRTUAL_LOOPBACK_CHANNEL,
    kind: 'invoke-heartbeat',
    correlationId: correlationId >>> 0,
  });
}

/** Encode plane channel onto loopback mux wire (§10.1c). */
export function encodeLoopbackFromPlane(channel: PlaneChannel, payload: Uint8Array): Uint8Array {
  if (channel === PlaneChannel.Frame) {
    return encodeLoopbackEnvelope({
      channel: VIRTUAL_LOOPBACK_CHANNEL,
      kind: 'frame',
      bytes: Array.from(payload),
    });
  }
  if (channel === PlaneChannel.Telemetry) {
    return encodeLoopbackEnvelope({
      channel: VIRTUAL_LOOPBACK_CHANNEL,
      kind: 'telemetry',
      message: JSON.parse(new TextDecoder().decode(payload)),
    });
  }
  // Control = fire-and-forget via reserved invoke name (no await on sidecar).
  return encodeLoopbackInvoke(0, LOOPBACK_CONTROL_INVOKE_NAME, JSON.parse(new TextDecoder().decode(payload)));
}

/**
 * Map frame / telemetry / __control invoke onto PlaneChannel.
 * Real RPC invoke / invoke-result are not plane-mapped (return null).
 */
export function decodeLoopbackToPlane(
  message: Uint8Array,
): { channel: PlaneChannel; payload: Uint8Array } | null {
  const env = decodeLoopbackEnvelope(message);
  if (env === null) return null;
  switch (env.kind) {
    case 'frame':
      return { channel: PlaneChannel.Frame, payload: Uint8Array.from(env.bytes) };
    case 'telemetry':
      return {
        channel: PlaneChannel.Telemetry,
        payload: new TextEncoder().encode(JSON.stringify(env.message ?? null)),
      };
    case 'invoke':
      if (env.name === LOOPBACK_CONTROL_INVOKE_NAME) {
        return {
          channel: PlaneChannel.Control,
          payload: new TextEncoder().encode(JSON.stringify(env.args ?? {})),
        };
      }
      return null;
    default:
      return null;
  }
}

export function isLoopbackWireMessage(message: Uint8Array): boolean {
  if (message.length < 2 || message[0] !== 0x7b) return false; // '{'
  try {
    const parsed = JSON.parse(new TextDecoder().decode(message)) as { channel?: unknown };
    return parsed.channel === VIRTUAL_LOOPBACK_CHANNEL;
  } catch {
    return false;
  }
}
