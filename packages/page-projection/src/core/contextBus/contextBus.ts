/**
 * ContextBus — dumb inter-context transport (context-bus.md SEALED).
 */

import {
  CONTEXT_BUS_RUNTIME,
  DEFAULT_INVOKE_IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  INVOKE_DEDUPE_TTL_MS,
  TRANSPORT_PROTOCOL_TYPES,
  assertStructuredCloneSafe,
  isMalformedEnvelope,
  isValidDestination,
  serializeBusError,
  CONTEXT_BUS_CHANNEL,
  type BusDeliveryMeta,
  type BusEnvelope,
  type BusErrorPayload,
  type BusEventHandler,
  type BusInvocationHandler,
  type ContextBusCarrier,
  type EmitOptions,
  type InvocationHeartbeatEvent,
  type InvocationId,
  type InvocationResponseEvent,
  type InvocationStartedEvent,
  type InvokeOptions,
  type InvokeResult,
  type RequestInvocationEvent,
} from './types';

export type ContextBusOptions = {
  contextId: number;
  servesRuntime: boolean;
  carrier: ContextBusCarrier;
};

type PendingInvoke = {
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: InvokeResult<unknown>) => void;
};

type SeenInvocation = {
  expiresAt: number;
};

export interface IContextBus {
  readonly contextId: number;
  readonly servesRuntime: boolean;
  emit<T = unknown>(type: string, event: T, opts: EmitOptions): void;
  invoke<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
    opts: InvokeOptions,
  ): Promise<InvokeResult<TResult>>;
  onEvent<T = unknown>(type: string, handler: BusEventHandler<T>): () => void;
  onInvocation<TArgs = unknown, TResult = unknown>(
    name: string,
    handler: BusInvocationHandler<TArgs, TResult>,
  ): () => void;
  dispose(): void;
  /** Carrier entry point — not part of public domain API. */
  receive(envelope: BusEnvelope): void;
}

export class ContextBus implements IContextBus {
  readonly contextId: number;
  readonly servesRuntime: boolean;
  private readonly carrier: ContextBusCarrier;
  private disposed = false;
  private nextInvocationId = 1;
  private readonly eventHandlers = new Map<string, BusEventHandler[]>();
  private readonly invocationHandlers = new Map<string, BusInvocationHandler>();
  private readonly pending = new Map<InvocationId, PendingInvoke>();
  private readonly seenInvocations = new Map<string, SeenInvocation>();
  private readonly activeHeartbeats = new Map<InvocationId, ReturnType<typeof setInterval>>();

  constructor(opts: ContextBusOptions) {
    this.contextId = opts.contextId;
    this.servesRuntime = opts.servesRuntime;
    this.carrier = opts.carrier;
  }

  emit<T = unknown>(type: string, event: T, opts: EmitOptions): void {
    if (this.disposed) return;
    if (!opts || opts.destination === undefined) {
      throw new TypeError('emit requires opts.destination');
    }
    if (TRANSPORT_PROTOCOL_TYPES.has(type) || type.length === 0) {
      throw new TypeError(`invalid emit type: ${type}`);
    }
    assertStructuredCloneSafe(event);
    const envelope: BusEnvelope = {
      channel: CONTEXT_BUS_CHANNEL,
      source: this.contextId,
      destination: opts.destination,
      type,
      event,
    };
    this.carrier.send(envelope);
    this.deliverLocal(envelope);
  }

  invoke<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
    opts: InvokeOptions,
  ): Promise<InvokeResult<TResult>> {
    if (this.disposed) {
      return Promise.resolve({ ok: false, error: { message: 'bus_disposed', name: 'BusDisposed' } });
    }
    if (!name || name.length === 0) throw new TypeError('invoke requires non-empty name');
    if (opts?.destination === undefined || !isValidDestination(opts.destination)) {
      throw new TypeError('invoke requires valid unicast destination');
    }

    const meta: BusDeliveryMeta = {
      source: this.contextId,
      destination: opts.destination,
      type: 'request-invocation',
    };

    if (
      opts.destination === this.contextId ||
      (opts.destination === CONTEXT_BUS_RUNTIME && this.servesRuntime)
    ) {
      return this.localInvoke(name, args, meta) as Promise<InvokeResult<TResult>>;
    }

    assertStructuredCloneSafe(args);
    const invocationId = this.allocInvocationId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_INVOKE_IDLE_TIMEOUT_MS;

    return new Promise((resolve) => {
      const resetTimer = (): void => {
        const pending = this.pending.get(invocationId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => {
          this.pending.delete(invocationId);
          resolve({ ok: false, error: { message: 'timeout', name: 'InvokeTimeout' } });
        }, timeoutMs);
      };

      const timer = setTimeout(() => {
        this.pending.delete(invocationId);
        resolve({ ok: false, error: { message: 'timeout', name: 'InvokeTimeout' } });
      }, timeoutMs);

      this.pending.set(invocationId, { timeoutMs, timer, resolve: resolve as (r: InvokeResult<unknown>) => void });

      this.carrier.send({
        channel: CONTEXT_BUS_CHANNEL,
        source: this.contextId,
        destination: opts.destination,
        type: 'request-invocation',
        event: { invocationId, name, args } satisfies RequestInvocationEvent,
      });
    });
  }

  onEvent<T = unknown>(type: string, handler: BusEventHandler<T>): () => void {
    const list = this.eventHandlers.get(type) ?? [];
    list.push(handler as BusEventHandler);
    this.eventHandlers.set(type, list);
    return () => {
      const cur = this.eventHandlers.get(type);
      if (!cur) return;
      const idx = cur.indexOf(handler as BusEventHandler);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  onInvocation<TArgs = unknown, TResult = unknown>(
    name: string,
    handler: BusInvocationHandler<TArgs, TResult>,
  ): () => void {
    this.invocationHandlers.set(name, handler as BusInvocationHandler);
    return () => {
      if (this.invocationHandlers.get(name) === handler) {
        this.invocationHandlers.delete(name);
      }
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventHandlers.clear();
    this.invocationHandlers.clear();
    for (const hb of this.activeHeartbeats.values()) clearInterval(hb);
    this.activeHeartbeats.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { message: 'bus_disposed', name: 'BusDisposed' } });
    }
    this.pending.clear();
    this.seenInvocations.clear();
  }

  receive(envelope: BusEnvelope): void {
    if (this.disposed || isMalformedEnvelope(envelope)) return;
    if (!this.isAddressedHere(envelope)) return;

    if (TRANSPORT_PROTOCOL_TYPES.has(envelope.type)) {
      void this.handleTransport(envelope);
      return;
    }

    this.dispatchEvent(envelope);
  }

  private isAddressedHere(envelope: BusEnvelope): boolean {
    if (envelope.destination === '*') {
      return envelope.source !== this.contextId;
    }
    if (envelope.destination === this.contextId) return true;
    if (envelope.destination === CONTEXT_BUS_RUNTIME && this.servesRuntime) return true;
    return false;
  }

  private deliverLocal(envelope: BusEnvelope): void {
    if (!this.isAddressedHere(envelope)) return;
    if (TRANSPORT_PROTOCOL_TYPES.has(envelope.type)) return;
    this.dispatchEvent(envelope);
  }

  private dispatchEvent(envelope: BusEnvelope): void {
    const handlers = this.eventHandlers.get(envelope.type);
    if (!handlers || handlers.length === 0) return;
    const meta: BusDeliveryMeta = {
      source: envelope.source,
      destination: envelope.destination,
      type: envelope.type,
    };
    for (const handler of handlers) {
      try {
        const ret = handler(envelope.event, meta);
        if (ret && typeof (ret as Promise<void>).catch === 'function') {
          void (ret as Promise<void>).catch(() => {});
        }
      } catch {
        // swallow
      }
    }
  }

  private async localInvoke<TArgs, TResult>(
    name: string,
    args: TArgs,
    meta: BusDeliveryMeta,
  ): Promise<InvokeResult<TResult>> {
    const handler = this.invocationHandlers.get(name);
    if (!handler) {
      return { ok: false, error: { message: 'no_handler', name: 'NoInvocationHandler' } };
    }
    try {
      const value = await handler(args, meta);
      return { ok: true, value: value as TResult };
    } catch (err) {
      return { ok: false, error: serializeBusError(err) };
    }
  }

  private async handleTransport(envelope: BusEnvelope): Promise<void> {
    if (envelope.destination === '*') return;

    switch (envelope.type) {
      case 'request-invocation':
        await this.handleRequestInvocation(envelope);
        break;
      case 'invocation-started':
        this.handleInvocationStarted(envelope.event as InvocationStartedEvent);
        break;
      case 'invocation-heartbeat':
        this.handleInvocationHeartbeat(envelope.event as InvocationHeartbeatEvent);
        break;
      case 'invocation-response':
        this.handleInvocationResponse(envelope.event as InvocationResponseEvent);
        break;
    }
  }

  private seenKey(source: number, invocationId: InvocationId): string {
    return `${source}:${invocationId}`;
  }

  private markSeen(source: number, invocationId: InvocationId): boolean {
    const key = this.seenKey(source, invocationId);
    const now = Date.now();
    const existing = this.seenInvocations.get(key);
    if (existing && existing.expiresAt > now) return false;
    this.seenInvocations.set(key, { expiresAt: now + INVOKE_DEDUPE_TTL_MS });
    return true;
  }

  private async handleRequestInvocation(envelope: BusEnvelope): Promise<void> {
    const req = envelope.event as RequestInvocationEvent;
    if (!this.markSeen(envelope.source, req.invocationId)) return;

    const meta: BusDeliveryMeta = {
      source: envelope.source,
      destination: envelope.destination,
      type: 'request-invocation',
    };

    const handler = this.invocationHandlers.get(req.name);
    if (!handler) {
      this.sendTransport(envelope.source, 'invocation-response', {
        invocationId: req.invocationId,
        error: { message: 'no_handler', name: 'NoInvocationHandler' },
      });
      return;
    }

    this.sendTransport(envelope.source, 'invocation-started', { invocationId: req.invocationId });

    const heartbeat = setInterval(() => {
      this.sendTransport(envelope.source, 'invocation-heartbeat', { invocationId: req.invocationId });
    }, HEARTBEAT_INTERVAL_MS);
    this.activeHeartbeats.set(req.invocationId, heartbeat);

    try {
      const value = await handler(req.args, meta);
      clearInterval(heartbeat);
      this.activeHeartbeats.delete(req.invocationId);
      this.sendTransport(envelope.source, 'invocation-response', {
        invocationId: req.invocationId,
        result: value,
      });
    } catch (err) {
      clearInterval(heartbeat);
      this.activeHeartbeats.delete(req.invocationId);
      this.sendTransport(envelope.source, 'invocation-response', {
        invocationId: req.invocationId,
        error: serializeBusError(err),
      });
    }
  }

  private handleInvocationStarted(event: InvocationStartedEvent): void {
    this.resetPendingTimer(event.invocationId);
  }

  private handleInvocationHeartbeat(event: InvocationHeartbeatEvent): void {
    this.resetPendingTimer(event.invocationId);
  }

  private resetPendingTimer(invocationId: InvocationId): void {
    const pending = this.pending.get(invocationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pending.delete(invocationId);
      pending.resolve({ ok: false, error: { message: 'timeout', name: 'InvokeTimeout' } });
    }, pending.timeoutMs);
  }

  private handleInvocationResponse(event: InvocationResponseEvent): void {
    const pending = this.pending.get(event.invocationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(event.invocationId);

    if (event.error !== undefined) {
      pending.resolve({ ok: false, error: event.error });
      return;
    }
    pending.resolve({ ok: true, value: event.result });
  }

  private sendTransport(
    destination: number,
    type: 'invocation-started' | 'invocation-heartbeat' | 'invocation-response',
    event: InvocationStartedEvent | InvocationHeartbeatEvent | InvocationResponseEvent,
  ): void {
    this.carrier.send({
      channel: CONTEXT_BUS_CHANNEL,
      source: this.contextId,
      destination,
      type,
      event,
    });
  }

  private allocInvocationId(): InvocationId {
    const id = this.nextInvocationId;
    this.nextInvocationId = id === 0xffff_ffff ? 1 : id + 1;
    if (this.nextInvocationId === 0) this.nextInvocationId = 1;
    return id;
  }
}

export {
  CONTEXT_BUS_CHANNEL,
  CONTEXT_BUS_RUNTIME,
  CONTEXT_ID_MAX_DOCUMENT,
  DEFAULT_INVOKE_IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  INVOKE_DEDUPE_TTL_MS,
} from './types';

export type {
  BusDeliveryMeta,
  BusEnvelope,
  BusErrorPayload,
  BusEventHandler,
  BusInvocationHandler,
  EmitOptions,
  InvokeOptions,
  InvokeResult,
} from './types';
