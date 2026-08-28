/**
 * Virtual domain bus — ContextBus + iframe fabric (replaces ProjectionBus).
 */

import type { ProjectionTelemetryMessage } from '../../core/telemetry';
import type { SnapshotOptions, SnapshotResult } from '../snapshot';
import { ContextBus, type IContextBus } from './contextBus';
import {
  CONTEXT_BUS_CHANNEL,
  CONTEXT_BUS_RUNTIME,
  type BusEnvelope,
  type ContextBusCarrier,
  type InvokeResult,
} from './types';

export type ResyncRequestEvent = {
  contextId: number;
  reason?: string;
  generation?: number;
  sequence?: number;
};

export type ControlInputEvent = {
  contextId: number;
  intentType: string;
  nodeId: number | null;
  payload?: unknown;
};

export type SnapshotRpcOpts = SnapshotOptions & {
  includeTree?: boolean;
};

export type SnapshotRpcPayload = SnapshotResult & {
  contextId: number;
  tree?: unknown;
};

export type SnapshotRpcResult =
  | { ok: true; value: SnapshotRpcPayload }
  | { ok: false; reason: string };

export type SnapshotHandler = (opts?: SnapshotRpcOpts) => SnapshotResult;
export type ResumeHandler = () => void;

/** Live nested-host fabric — sourced from ChildScopeIndex (no DOM scan). */
export type ChildFabric = {
  windowOf: (contextId: number) => Window | null;
  forEachLive: (fn: (w: Window, contextId: number) => void) => void;
};

export type VirtualDomainBusOptions = {
  window: Window;
  parent?: Window | null;
  role: 'root' | 'nested';
  contextId?: number;
  servesRuntime?: boolean;
  mint?: () => number;
  emitFrame?: (bytes: Uint8Array) => void;
  /**
   * Root RUNTIME: true if `contextId` is currently a live deliverable destination.
   * Unicast invoke to an unknown id fails closed immediately (no idle wait).
   * Prefer live child-scope index over mint-ever; bootstrap replaces the launch stub.
   */
  isDeliverableDestination?: (contextId: number) => boolean;
};

const GET_SCOPE_TIMEOUT_MS = 200;
const MINT_TIMEOUT_MS = 500;
const SNAPSHOT_TIMEOUT_MS = 8_000;
const RESUME_TIMEOUT_MS = 2_000;

function isBusEnvelope(data: unknown): data is BusEnvelope {
  if (typeof data !== 'object' || data === null) return false;
  return (data as { channel?: unknown }).channel === CONTEXT_BUS_CHANNEL;
}

function isTransportType(type: string): boolean {
  return (
    type === 'request-invocation' ||
    type === 'invocation-started' ||
    type === 'invocation-heartbeat' ||
    type === 'invocation-response'
  );
}

export class VirtualDomainBus implements IContextBus {
  readonly bus: ContextBus;
  private readonly win: Window;
  private readonly parent: Window | null;
  private readonly mintFn: (() => number) | null;
  private readonly emitFrameFn: ((bytes: Uint8Array) => void) | null;
  private isDeliverableDestination: ((contextId: number) => boolean) | null;
  private mine: number;
  private lookupScopeId: ((source: MessageEventSource) => number | undefined) | null = null;
  private childFabric: ChildFabric | null = null;
  private snapshotHandler: SnapshotHandler | null = null;
  private resumeHandler: ResumeHandler | null = null;
  private applyScrollHandler:
    | ((
        positions: import('../../core/input/unifiedIntentTypes').ScrollPositionEntry[],
      ) => { ok: boolean; missingNodeIds: number[] })
    | null = null;
  private readonly onMessage: (event: MessageEvent) => void;
  private disposed = false;

  constructor(opts: VirtualDomainBusOptions) {
    this.win = opts.window;
    this.parent = opts.parent ?? null;
    this.mintFn = opts.mint ?? null;
    this.emitFrameFn = opts.emitFrame ?? null;
    this.isDeliverableDestination = opts.isDeliverableDestination ?? null;
    this.mine = opts.contextId ?? 1;

    const carrier: ContextBusCarrier = {
      send: (envelope) => this.routeOutbound(envelope),
    };

    this.bus = new ContextBus({
      contextId: this.mine,
      servesRuntime: opts.servesRuntime ?? opts.role === 'root',
      carrier,
    });

    this.wireDomainHandlers();

    this.onMessage = (event: MessageEvent): void => {
      if (!isBusEnvelope(event.data)) return;
      const envelope = event.data;

      // getScopeId needs MessageEvent.source — answer before the stub handler throws scope_pending.
      if (
        envelope.type === 'request-invocation' &&
        this.bus.servesRuntime &&
        envelope.destination === CONTEXT_BUS_RUNTIME &&
        event.source
      ) {
        const req = envelope.event as { name: string; invocationId: number };
        if (req.name === 'getScopeId') {
          const scope = this.lookupScopeId?.(event.source);
          if (scope !== undefined) {
            this.respondInvocationToSource(event.source, envelope.source, req, scope);
            return;
          }
        }
      }

      if (this.isAddressedHere(envelope)) {
        this.bus.receive(envelope);
      } else {
        this.routeOutbound(envelope);
      }
      void this.handleDomainSideEffects(envelope, event);
    };
    this.win.addEventListener('message', this.onMessage);
  }

  get contextId(): number {
    return this.mine;
  }

  get servesRuntime(): boolean {
    return this.bus.servesRuntime;
  }

  emit<T>(type: string, event: T, opts: import('./types').EmitOptions): void {
    this.bus.emit(type, event, opts);
  }

  invoke<TArgs, TResult>(
    name: string,
    args: TArgs,
    opts: import('./types').InvokeOptions,
  ): Promise<InvokeResult<TResult>> {
    return this.bus.invoke(name, args, opts);
  }

  onEvent<T>(type: string, handler: import('./types').BusEventHandler<T>): () => void {
    return this.bus.onEvent(type, handler);
  }

  onInvocation<TArgs, TResult>(
    name: string,
    handler: import('./types').BusInvocationHandler<TArgs, TResult>,
  ): () => void {
    return this.bus.onInvocation(name, handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener('message', this.onMessage);
    this.bus.dispose();
  }

  receive(envelope: BusEnvelope): void {
    this.bus.receive(envelope);
  }

  setMine(contextId: number): void {
    this.mine = contextId;
    (this.bus as { contextId: number }).contextId = contextId;
  }

  setSnapshotHandler(handler: SnapshotHandler | null): void {
    this.snapshotHandler = handler;
  }

  setResumeHandler(handler: ResumeHandler | null): void {
    this.resumeHandler = handler;
  }

  setScopeLookup(fn: (source: MessageEventSource) => number | undefined): void {
    this.lookupScopeId = fn;
  }

  /** Wire live child-scope fabric (O(1) route; replaces DOM querySelectorAll scan). */
  setChildFabric(fabric: ChildFabric | null): void {
    this.childFabric = fabric;
  }

  /** Replace deliverable check (bootstrap: live index, not mint-ever). */
  setDeliverableCheck(fn: ((contextId: number) => boolean) | null): void {
    this.isDeliverableDestination = fn;
  }

  onFrame(cb: (bytes: Uint8Array) => void): () => void {
    return this.bus.onEvent('frame', (ev: { bytes: ArrayBuffer }) => {
      cb(new Uint8Array(ev.bytes));
    });
  }

  onResyncRequest(cb: (req: ResyncRequestEvent) => void): () => void {
    return this.bus.onEvent('resyncRequest', cb);
  }

  onControlInput(cb: (req: ControlInputEvent) => void): () => void {
    return this.bus.onEvent('controlInput', cb);
  }

  onTelemetry(cb: (message: ProjectionTelemetryMessage) => void): () => void {
    return this.bus.onEvent('telemetry', (message: ProjectionTelemetryMessage) => cb(message));
  }

  publishControlInput(req: ControlInputEvent): void {
    // Unicast — broadcast '*' excludes source (CB-02); root Mode B must apply locally.
    const dest = req.contextId > 0 ? req.contextId : this.mine;
    this.bus.emit('controlInput', req, { destination: dest });
  }

  emitFrame(bytes: Uint8Array): void {
    if (this.emitFrameFn) {
      this.emitFrameFn(bytes);
      return;
    }
    void this.bus.invoke('emitFrame', { bytes: bytes.slice().buffer }, { destination: CONTEXT_BUS_RUNTIME });
  }

  emitTelemetry(message: ProjectionTelemetryMessage): void {
    if (this.emitFrameFn) {
      this.bus.emit('telemetry', message, { destination: '*' });
      return;
    }
    if (this.parent) {
      void this.bus.invoke('emitTelemetry', { message }, { destination: CONTEXT_BUS_RUNTIME });
    }
  }

  async getScopeId(): Promise<number> {
    if (!this.parent) return this.mine;
    for (;;) {
      const result = await this.bus.invoke<Record<string, never>, number>(
        'getScopeId',
        {},
        { destination: CONTEXT_BUS_RUNTIME, timeoutMs: GET_SCOPE_TIMEOUT_MS },
      );
      if (result.ok && typeof result.value === 'number' && result.value >= 2) {
        return result.value;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  async requestMint(): Promise<number | undefined> {
    if (this.mintFn) return this.mintFn();
    const result = await this.bus.invoke<Record<string, never>, number>(
      'mint',
      {},
      { destination: CONTEXT_BUS_RUNTIME, timeoutMs: MINT_TIMEOUT_MS },
    );
    return result.ok ? result.value : undefined;
  }

  async requestSnapshot(contextId: number, opts?: SnapshotRpcOpts): Promise<SnapshotRpcResult> {
    const result = await this.bus.invoke<{ contextId: number; opts?: SnapshotRpcOpts }, SnapshotRpcPayload>(
      'snapshot',
      { contextId, opts },
      { destination: contextId, timeoutMs: SNAPSHOT_TIMEOUT_MS },
    );
    if (result.ok) return { ok: true, value: result.value };
    return { ok: false, reason: result.error?.message ?? 'snapshot_failed' };
  }

  async requestResumeContext(contextId: number): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.bus.invoke<{ contextId: number }, { ok: boolean; reason?: string }>(
      'resumeContext',
      { contextId },
      { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS },
    );
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'resume_failed' };
  }

  async requestApplyScroll(
    contextId: number,
    positions: import('../../core/input/unifiedIntentTypes').ScrollPositionEntry[],
  ): Promise<{ ok: boolean; missingNodeIds?: number[]; reason?: string }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { contextId: number; positions: import('../../core/input/unifiedIntentTypes').ScrollPositionEntry[] },
      { ok: boolean; missingNodeIds: number[] }
    >(
      'applyScrollPositions',
      { contextId, positions },
      { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS },
    );
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'apply_scroll_failed' };
  }

  /** Lab resolve — DomNodeTable.keyOf for scrollSet element targets. */
  async requestKeyOfSelector(
    contextId: number,
    selector: string,
  ): Promise<{ ok: boolean; nodeId?: number; reason?: string }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<{ selector: string }, { ok: boolean; nodeId?: number; reason?: string }>(
      'keyOfSelector',
      { selector },
      { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS },
    );
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'key_of_failed' };
  }

  /**
   * Lab resolve — element hit in root Virtual viewport CSS (Mode A) + local viewport scroll.
   * Nested contexts walk frameElement offsets to top.
   */
  async requestResolveElementHit(
    contextId: number,
    selector: string,
  ): Promise<{
    ok: boolean;
    x?: number;
    y?: number;
    scrollX?: number;
    scrollY?: number;
    nodeId?: number | null;
    reason?: string;
  }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { selector: string },
      {
        ok: boolean;
        x?: number;
        y?: number;
        scrollX?: number;
        scrollY?: number;
        nodeId?: number | null;
        reason?: string;
      }
    >('resolveElementHit', { selector }, { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS });
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'resolve_hit_failed' };
  }

  /**
   * `sparse-cdp` alternate pipeline only (decision-log.md 2026-08-27) — id-addressed click
   * resolve, not selector-based (that's `requestResolveElementHit`, lab/CLI only). Targets
   * exactly one context (the one the Projected hit-test already named), not a census fan-out
   * over every known context — the `PP-INPUT-VIRTUAL-MINT-GHOST` ghost-context hang
   * (open.md) needs an *unrelated* dead context on the same fan-out to trigger; a single
   * targeted resolve is naturally far less exposed to it, though not a fix for `os-abs`.
   */
  async requestResolveNodeHit(
    contextId: number,
    nodeId: number,
    x?: number,
    y?: number,
  ): Promise<{ ok: boolean; x?: number; y?: number; reason?: string }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { nodeId: number; x?: number; y?: number },
      { ok: boolean; x?: number; y?: number; reason?: string }
    >('resolveNodeHit', { nodeId, x, y }, { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS });
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'resolve_hit_failed' };
  }

  setApplyScrollHandler(
    handler: (
      positions: import('../../core/input/unifiedIntentTypes').ScrollPositionEntry[],
    ) => { ok: boolean; missingNodeIds: number[] },
  ): void {
    this.applyScrollHandler = handler;
  }

  publishFrame(bytes: Uint8Array): void {
    this.bus.emit('frame', { bytes: bytes.slice().buffer }, { destination: '*' });
  }

  publishResyncRequest(req: ResyncRequestEvent): void {
    const dest = req.contextId > 0 ? req.contextId : this.mine;
    this.bus.emit('resyncRequest', req, { destination: dest });
  }

  private isAddressedHere(envelope: BusEnvelope): boolean {
    if (envelope.destination === '*') {
      return envelope.source !== this.mine;
    }
    if (envelope.destination === this.mine) return true;
    if (envelope.destination === CONTEXT_BUS_RUNTIME && this.bus.servesRuntime) return true;
    return false;
  }

  private wireDomainHandlers(): void {
    this.bus.onInvocation('getScopeId', (_args, meta) => {
      void meta;
      throw new Error('scope_pending');
    });

    this.bus.onInvocation('mint', () => {
      if (!this.mintFn) throw new Error('no_mint');
      return this.mintFn();
    });

    this.bus.onInvocation('snapshot', async (args: { contextId: number; opts?: SnapshotRpcOpts }) => {
      if (args.contextId === this.mine && this.snapshotHandler) {
        const value = this.snapshotHandler(args.opts);
        let tree: unknown;
        if (args.opts?.includeTree) {
          const snap = (globalThis as { __speculumSnapshot?: { snapshotTree?: () => unknown } }).__speculumSnapshot;
          tree = snap?.snapshotTree?.() ?? null;
        }
        return { ...value, contextId: args.contextId, tree };
      }
      throw new Error('context_not_found');
    });

    this.bus.onInvocation('resumeContext', (args: { contextId: number }) => {
      if (args.contextId === this.mine && this.resumeHandler) {
        this.resumeHandler();
        return { ok: true };
      }
      throw new Error('context_not_found');
    });

    this.bus.onInvocation(
      'applyScrollPositions',
      (args: {
        contextId: number;
        positions: import('../../core/input/unifiedIntentTypes').ScrollPositionEntry[];
      }) => {
        if (args.contextId === this.mine && this.applyScrollHandler) {
          return this.applyScrollHandler(args.positions);
        }
        throw new Error('context_not_found');
      },
    );

    this.bus.onInvocation('emitFrame', (args: { bytes: ArrayBuffer }) => {
      const bytes = new Uint8Array(args.bytes);
      if (this.emitFrameFn) {
        this.emitFrameFn(bytes);
        return { ok: true };
      }
      throw new Error('no_emit_frame');
    });

    this.bus.onInvocation('emitTelemetry', (args: { message: ProjectionTelemetryMessage }) => {
      this.bus.emit('telemetry', args.message, { destination: '*' });
      return { ok: true };
    });
  }

  private async handleDomainSideEffects(envelope: BusEnvelope, event: MessageEvent): Promise<void> {
    if (isTransportType(envelope.type)) {
      return;
    }

    if (envelope.type === 'frame') {
      const bytes = new Uint8Array((envelope.event as { bytes: ArrayBuffer }).bytes);
      if (event.source === this.parent) {
        this.bus.emit('frame', { bytes: bytes.buffer }, { destination: '*' });
        return;
      }
      if (this.emitFrameFn) this.emitFrameFn(bytes);
      return;
    }

    if (envelope.type === 'telemetry') {
      if (event.source === this.parent) {
        this.bus.emit('telemetry', envelope.event, { destination: '*' });
      }
      return;
    }

    if (envelope.type === 'resyncRequest' && event.source !== this.parent) return;
    if (envelope.type === 'controlInput' && event.source !== this.parent) return;
  }

  private respondInvocationToSource(
    eventSource: MessageEventSource | null,
    callerContextId: number,
    req: { invocationId: number },
    result: unknown,
  ): void {
    const started: BusEnvelope = {
      channel: CONTEXT_BUS_CHANNEL,
      source: this.mine,
      destination: callerContextId,
      type: 'invocation-started',
      event: { invocationId: req.invocationId },
    };
    const response: BusEnvelope = {
      channel: CONTEXT_BUS_CHANNEL,
      source: this.mine,
      destination: callerContextId,
      type: 'invocation-response',
      event: { invocationId: req.invocationId, result },
    };
    const target = eventSource as Window | null;
    if (target && typeof target.postMessage === 'function') {
      target.postMessage(started, '*');
      target.postMessage(response, '*');
      return;
    }
    this.sendLocalResponse(callerContextId, req, result);
  }

  private sendLocalResponse(source: number, req: { invocationId: number }, result: unknown): void {
    this.bus.receive({
      channel: CONTEXT_BUS_CHANNEL,
      source: this.mine,
      destination: source,
      type: 'invocation-started',
      event: { invocationId: req.invocationId },
    });
    this.bus.receive({
      channel: CONTEXT_BUS_CHANNEL,
      source: this.mine,
      destination: source,
      type: 'invocation-response',
      event: { invocationId: req.invocationId, result },
    });
  }

  private routeOutbound(envelope: BusEnvelope): void {
    if (this.disposed) return;

    if (envelope.destination === '*') {
      this.forEachLiveChild((w) => w.postMessage(envelope, '*'));
      return;
    }

    const dest = envelope.destination;
    if (dest === this.mine || (dest === CONTEXT_BUS_RUNTIME && this.bus.servesRuntime)) {
      return;
    }

    if (typeof dest === 'number') {
      const child = this.findChildForContext(dest);
      if (child) {
        child.postMessage(envelope, '*');
        return;
      }
    }

    if (this.parent) {
      this.parent.postMessage(envelope, '*');
      return;
    }

    // Root: unknown / dead destination — fail closed (no DOM scan, no hopeful broadcast).
    if (envelope.type === 'request-invocation' && typeof dest === 'number') {
      const req = envelope.event as { invocationId: number };
      this.sendLocalErrorResponse(envelope.source, req, {
        message: 'context_not_found',
        name: 'UndeliverableDestination',
      });
    }
  }

  private sendLocalErrorResponse(
    callerContextId: number,
    req: { invocationId: number },
    error: { message: string; name?: string },
  ): void {
    this.bus.receive({
      channel: CONTEXT_BUS_CHANNEL,
      source: this.mine,
      destination: callerContextId,
      type: 'invocation-response',
      event: { invocationId: req.invocationId, error },
    });
  }

  private findChildForContext(contextId: number): Window | null {
    return this.childFabric?.windowOf(contextId) ?? null;
  }

  private forEachLiveChild(fn: (w: Window) => void): void {
    this.childFabric?.forEachLive((w) => fn(w));
  }
}

export { VirtualDomainBus as ProjectionBus };
export const PROJECTION_BUS_CHANNEL = CONTEXT_BUS_CHANNEL;
