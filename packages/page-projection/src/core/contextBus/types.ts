/** ContextBus transport types — deterministic reflection of context-bus.md (SEALED). */

import {
  CONTEXT_BUS_CHANNEL,
  CONTEXT_BUS_RUNTIME,
  CONTEXT_ID_MAX_DOCUMENT,
  CONTEXT_ID_PROVISIONAL,
} from '../contextBusConstants';

export {
  CONTEXT_BUS_RUNTIME,
  CONTEXT_ID_MAX_DOCUMENT,
  CONTEXT_ID_PROVISIONAL,
  CONTEXT_BUS_CHANNEL,
};

export type BusDestination = '*' | number;

export type BusEnvelope<TType extends string = string, TEvent = unknown> = {
  channel: typeof CONTEXT_BUS_CHANNEL;
  source: number;
  destination: BusDestination;
  type: TType;
  event: TEvent;
};

export type TransportProtocolType =
  | 'request-invocation'
  | 'invocation-started'
  | 'invocation-heartbeat'
  | 'invocation-response';

export type InvocationId = number;

export type RequestInvocationEvent = {
  invocationId: InvocationId;
  name: string;
  args: unknown;
};

export type InvocationStartedEvent = { invocationId: InvocationId };
export type InvocationHeartbeatEvent = { invocationId: InvocationId };

export type InvocationResponseEvent = {
  invocationId: InvocationId;
  result?: unknown;
  error?: BusErrorPayload;
};

export type BusErrorPayload = {
  message: string;
  name?: string;
};

export type BusDeliveryMeta = {
  source: number;
  destination: BusDestination;
  type: string;
};

export type BusEventHandler<T = unknown> = (
  event: T,
  meta: BusDeliveryMeta,
) => void | Promise<void>;

export type BusInvocationHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  meta: BusDeliveryMeta,
) => TResult | Promise<TResult>;

export type EmitOptions = {
  /** Required — LOCKED CB-01. */
  destination: BusDestination;
};

export type InvokeOptions = {
  /** Unicast only — LOCKED CB-12. Document id or CONTEXT_BUS_RUNTIME. */
  destination: number;
  timeoutMs?: number;
};

export type InvokeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BusErrorPayload };

export const DEFAULT_INVOKE_IDLE_TIMEOUT_MS = 2000;
export const HEARTBEAT_INTERVAL_MS = 500;
export const INVOKE_DEDUPE_TTL_MS = 5000;

export const TRANSPORT_PROTOCOL_TYPES: ReadonlySet<string> = new Set([
  'request-invocation',
  'invocation-started',
  'invocation-heartbeat',
  'invocation-response',
]);

export type ContextBusCarrier = {
  send(envelope: BusEnvelope): void;
};

export function isValidContextId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= CONTEXT_ID_MAX_DOCUMENT;
}

export function isValidDestination(id: number): boolean {
  return (
    id === CONTEXT_ID_PROVISIONAL || isValidContextId(id) || id === CONTEXT_BUS_RUNTIME
  );
}

export function isMalformedEnvelope(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return true;
  const env = data as Partial<BusEnvelope>;
  if (env.channel !== CONTEXT_BUS_CHANNEL) return true;
  if (!Number.isInteger(env.source) || env.source === undefined || !isValidDestination(env.source)) return true;
  if (env.destination === '*') {
    // broadcast ok
  } else if (
    !Number.isInteger(env.destination) ||
    !isValidDestination(env.destination as number)
  ) {
    return true;
  }
  if (typeof env.type !== 'string' || env.type.length === 0) return true;
  if (!('event' in env)) return true;
  return false;
}

export function isBusEnvelope(data: unknown): data is BusEnvelope {
  return !isMalformedEnvelope(data);
}

export function assertStructuredCloneSafe(value: unknown): void {
  if (typeof structuredClone === 'function') {
    structuredClone(value);
    return;
  }
  JSON.parse(JSON.stringify(value));
}

export function serializeBusError(err: unknown): BusErrorPayload {
  if (err instanceof Error) {
    return { message: err.message, name: err.name };
  }
  return { message: String(err) };
}
