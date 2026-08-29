/**
 * Virtual domain bus — ContextBus + iframe fabric (replaces ProjectionBus).
 *
 * Carrier: directed `MessagePort` per parent↔child edge (`portCarrier.ts`,
 * runtime-redesign.md §0 #1 / §8). `window.postMessage` appears exactly twice per edge — the
 * port handshake — and never carries a bus envelope. There is no `postMessage(envelope, '*')`
 * fan-out: broadcast is a bus *addressing* mode (`destination: '*'`), delivered by writing to
 * each held port, not by shouting into every window on the page.
 */

import type { ProjectionTelemetryMessage } from '../../core/telemetry';
import type { SnapshotOptions, SnapshotResult } from '../snapshot';
import { ContextBus, type IContextBus } from './contextBus';
import { ChildPortHub, ParentPortLink, isBusPortSetup } from './portCarrier';
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

const MINT_TIMEOUT_MS = 500;
const SNAPSHOT_TIMEOUT_MS = 8_000;
const RESUME_TIMEOUT_MS = 2_000;

/** RUNTIME names the *immediate* parent must answer itself — it alone owns the iframe row. */
const IDENTITY_INVOCATIONS: ReadonlySet<string> = new Set(['getScopeId', 'initContext']);

/** Parent's answer to `initContext` (runtime-redesign.md §6). */
export type InitContextResult = {
  contextId: number;
  generation: number;
};

type PendingIdentityRequest = {
  port: MessagePort;
  source: object;
  caller: number;
  invocationId: number;
  name: string;
};

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
  private readonly hub: ChildPortHub;
  private readonly link: ParentPortLink | null;
  /** Identity questions a child asked before this parent could answer them (§0 #5). */
  private pendingIdentity: PendingIdentityRequest[] = [];
  /** Install counter per child address — the source of `generation` (§6, §7). */
  private readonly childInstalls = new Map<number, number>();
  /** One install = one port = one `generation`; a retried `initContext` is idempotent. */
  private readonly grantedGeneration = new WeakMap<MessagePort, InitContextResult>();
  private disposed = false;
  /** Last nested initContext attempt — for assertive boot probes. */
  lastInitContextDetail: {
    ok: boolean;
    upwardReady: boolean;
    invokeOk?: boolean;
    invokeError?: string;
    value?: InitContextResult | null;
  } | null = null;

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

    this.hub = new ChildPortHub({
      onInbound: (envelope, port, source) => this.receiveFromChild(envelope, port, source),
      onPortReplaced: (source) => this.dropPendingIdentityFor(source),
    });

    this.link = this.parent
      ? new ParentPortLink({
          window: this.win,
          parent: this.parent,
          onInbound: (envelope) => this.receiveFromParent(envelope),
        })
      : null;

    // The *only* window-level listener left: the port handshake. Bus envelopes never arrive here.
    this.onMessage = (event: MessageEvent): void => {
      if (!isBusPortSetup(event.data)) return;
      const source = event.source as object | null;
      if (!source) return;
      this.hub.accept(source);
    };
    this.win.addEventListener('message', this.onMessage);
  }

  /**
   * Open the upward channel (nested only). Separate from the constructor so bootstrap can install
   * every listener *before* any traffic exists (§5 boot order) — the parent may answer instantly.
   */
  openUpwardChannel(): void {
    this.link?.open();
  }

  /** bfcache restore: the old port is dead on the parent side — re-handshake (§0 #8). */
  reopenUpwardChannel(): void {
    this.link?.reopen();
  }

  get upwardReady(): boolean {
    return this.link?.ready ?? true;
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
    this.pendingIdentity = [];
    this.hub.dispose();
    this.link?.dispose();
    this.bus.dispose();
  }

  /**
   * A nested host row appeared (or changed) — retry every identity question that could not be
   * answered yet. Event-driven, so a child never polls and never spin-waits (§0 #5).
   */
  noteChildScopeChanged(): void {
    if (this.pendingIdentity.length === 0) return;
    const pending = this.pendingIdentity;
    this.pendingIdentity = [];
    for (const req of pending) {
      if (!this.answerIdentity(req)) this.pendingIdentity.push(req);
    }
  }

  /**
   * Inner navigation / host drop: kill the port of a dead install so it can never forward again
   * (§8 step 4). The replacement install re-handshakes and gets a fresh port + generation.
   */
  closeChildChannel(contextId: number): void {
    this.hub.closeForContext(contextId);
    this.pendingIdentity = this.pendingIdentity.filter((req) => req.caller !== contextId);
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

  /**
   * Nested `initContext` (runtime-redesign.md §6): one RPC to the immediate parent, one deadline,
   * no retry loop. The parent queues the request until it can answer, so a timeout means the
   * parent is genuinely not there — the caller goes dormant instead of spinning forever.
   */
  async requestInitContext(timeoutMs: number): Promise<InitContextResult | null> {
    if (!this.link) {
      this.lastInitContextDetail = { ok: false, upwardReady: false, invokeError: 'no_link' };
      return null;
    }
    this.link.open();
    const result = await this.bus.invoke<Record<string, never>, InitContextResult>(
      'initContext',
      {},
      { destination: CONTEXT_BUS_RUNTIME, timeoutMs },
    );
    if (!result.ok) {
      this.lastInitContextDetail = {
        ok: false,
        upwardReady: this.link.ready,
        invokeOk: false,
        invokeError: result.error?.message ?? 'invoke_failed',
      };
      return null;
    }
    const value = result.value;
    if (
      typeof value?.contextId !== 'number' ||
      value.contextId < 2 ||
      typeof value.generation !== 'number' ||
      value.generation < 1
    ) {
      this.lastInitContextDetail = {
        ok: false,
        upwardReady: this.link.ready,
        invokeOk: true,
        invokeError: 'bad_identity_shape',
        value: value ?? null,
      };
      return null;
    }
    this.lastInitContextDetail = {
      ok: true,
      upwardReady: this.link.ready,
      invokeOk: true,
      value: { contextId: value.contextId, generation: value.generation },
    };
    return { contextId: value.contextId, generation: value.generation };
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
    localX?: number,
    localY?: number,
  ): Promise<{ ok: boolean; x?: number; y?: number; reason?: string }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { nodeId: number; localX?: number; localY?: number },
      { ok: boolean; x?: number; y?: number; reason?: string }
    >(
      'resolveNodeHit',
      { nodeId, localX, localY },
      { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS },
    );
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'resolve_hit_failed' };
  }

  /** Lab diag — element geometry + visibility in this context's viewport. */
  async requestMeasureNodeRect(
    contextId: number,
    nodeId: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    tagName?: string;
    rect?: { x: number; y: number; width: number; height: number };
    offsetWidth?: number;
    offsetHeight?: number;
    display?: string | null;
    visibility?: string | null;
    hasSrcAttr?: boolean;
    src?: string | null;
  }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { nodeId: number },
      {
        ok: boolean;
        reason?: string;
        tagName?: string;
        rect?: { x: number; y: number; width: number; height: number };
        offsetWidth?: number;
        offsetHeight?: number;
        display?: string | null;
        visibility?: string | null;
        hasSrcAttr?: boolean;
        src?: string | null;
      }
    >('measureNodeRect', { nodeId }, { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS });
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'measure_rect_failed' };
  }

  /** Lab diag — CF Turnstile iframe + shadow host rects in root Virtual (pierces closed shadow). */
  async requestMeasureTurnstileRootRects(contextId: number): Promise<{
    ok: boolean;
    reason?: string;
    levels?: Array<{
      name: string;
      ok: boolean;
      reason?: string;
      tagName?: string;
      rect?: { x: number; y: number; width: number; height: number };
      offsetWidth?: number;
      offsetHeight?: number;
      display?: string | null;
      visibility?: string | null;
      hasSrcAttr?: boolean | null;
      src?: string | null;
    }>;
  }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      Record<string, never>,
      {
        ok: boolean;
        reason?: string;
        levels?: Array<{
          name: string;
          ok: boolean;
          reason?: string;
          tagName?: string;
          rect?: { x: number; y: number; width: number; height: number };
          offsetWidth?: number;
          offsetHeight?: number;
          display?: string | null;
          visibility?: string | null;
          hasSrcAttr?: boolean | null;
          src?: string | null;
        }>;
      }
    >('measureTurnstileRootRects', {}, { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS });
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'measure_turnstile_root_failed' };
  }

  async requestMeasureNodePaint(
    contextId: number,
    nodeId: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    paint?: {
      backgroundColor: string;
      color: string;
      opacity: string;
      visibility: string;
      display: string;
      borderTopWidth: string;
      borderTopColor: string;
      borderTopStyle: string;
      width: string;
      height: string;
    };
  }> {
    if (this.isDeliverableDestination && !this.isDeliverableDestination(contextId)) {
      return { ok: false, reason: 'context_not_found' };
    }
    const result = await this.bus.invoke<
      { nodeId: number },
      {
        ok: boolean;
        reason?: string;
        paint?: {
          backgroundColor: string;
          color: string;
          opacity: string;
          visibility: string;
          display: string;
          borderTopWidth: string;
          borderTopColor: string;
          borderTopStyle: string;
          width: string;
          height: string;
        };
      }
    >('measureNodePaint', { nodeId }, { destination: contextId, timeoutMs: RESUME_TIMEOUT_MS });
    if (result.ok) return result.value;
    return { ok: false, reason: result.error?.message ?? 'measure_paint_failed' };
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
    // No `getScopeId`/`initContext` handler here on purpose: identity is answered by the port's
    // owner in `answerIdentity` before the envelope ever reaches the bus core (§6).
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

  /**
   * Traffic off a child's port. The port *is* the proof of origin — no `event.source` compare,
   * and no way for page script to forge a "from my child" envelope (§8).
   */
  private receiveFromChild(envelope: BusEnvelope, port: MessagePort, source: object): void {
    if (this.disposed) return;

    if (
      envelope.type === 'request-invocation' &&
      envelope.destination === CONTEXT_BUS_RUNTIME
    ) {
      const req = envelope.event as { name: string; invocationId: number };
      if (IDENTITY_INVOCATIONS.has(req.name)) {
        // Only the immediate parent holds the iframe row, so identity is answered here even
        // when this context is not the RUNTIME server (§6). Unanswerable → queue, never fail.
        const pending: PendingIdentityRequest = {
          port,
          source,
          caller: envelope.source,
          invocationId: req.invocationId,
          name: req.name,
        };
        if (!this.answerIdentity(pending)) this.pendingIdentity.push(pending);
        return;
      }
    }

    if (this.isAddressedHere(envelope)) {
      this.bus.receive(envelope);
    } else {
      this.routeOutbound(envelope);
    }
    this.handleDomainSideEffects(envelope, 'child');
  }

  /** Traffic off the upward port. */
  private receiveFromParent(envelope: BusEnvelope): void {
    if (this.disposed) return;
    if (this.isAddressedHere(envelope)) {
      this.bus.receive(envelope);
    } else {
      this.routeOutbound(envelope);
    }
    this.handleDomainSideEffects(envelope, 'parent');
  }

  private answerIdentity(req: PendingIdentityRequest): boolean {
    const already = this.grantedGeneration.get(req.port);
    if (already !== undefined) {
      this.respondOnPort(req, req.name === 'initContext' ? already : already.contextId);
      return true;
    }

    const contextId = this.lookupScopeId?.(req.source as MessageEventSource);
    if (contextId === undefined) return false;

    this.hub.bindContext(contextId, req.source);
    const generation = (this.childInstalls.get(contextId) ?? 0) + 1;
    this.childInstalls.set(contextId, generation);
    const granted: InitContextResult = { contextId, generation };
    this.grantedGeneration.set(req.port, granted);
    this.respondOnPort(req, req.name === 'initContext' ? granted : contextId);
    return true;
  }

  private dropPendingIdentityFor(source: object): void {
    this.pendingIdentity = this.pendingIdentity.filter((req) => req.source !== source);
  }

  private respondOnPort(req: PendingIdentityRequest, result: unknown): void {
    const base = { channel: CONTEXT_BUS_CHANNEL, source: this.mine, destination: req.caller } as const;
    try {
      req.port.postMessage({
        ...base,
        type: 'invocation-started',
        event: { invocationId: req.invocationId },
      } satisfies BusEnvelope);
      req.port.postMessage({
        ...base,
        type: 'invocation-response',
        event: { invocationId: req.invocationId, result },
      } satisfies BusEnvelope);
    } catch {
      /* port closed under us — the caller's idle timeout is the answer */
    }
  }

  private handleDomainSideEffects(envelope: BusEnvelope, origin: 'parent' | 'child'): void {
    if (isTransportType(envelope.type)) {
      return;
    }

    if (envelope.type === 'frame') {
      const bytes = new Uint8Array((envelope.event as { bytes: ArrayBuffer }).bytes);
      if (origin === 'parent') {
        this.bus.emit('frame', { bytes: bytes.buffer }, { destination: '*' });
        return;
      }
      if (this.emitFrameFn) this.emitFrameFn(bytes);
      return;
    }

    if (envelope.type === 'telemetry') {
      if (origin === 'parent') {
        this.bus.emit('telemetry', envelope.event, { destination: '*' });
      }
      return;
    }
  }

  private routeOutbound(envelope: BusEnvelope): void {
    if (this.disposed) return;

    // Broadcast is an addressing mode, not a transport mode: one write per held child port.
    if (envelope.destination === '*') {
      this.hub.forEachPort((port) => {
        try {
          port.postMessage(envelope);
        } catch {
          /* closed port — dropped by design */
        }
      });
      return;
    }

    const dest = envelope.destination;
    if (dest === this.mine || (dest === CONTEXT_BUS_RUNTIME && this.bus.servesRuntime)) {
      return;
    }

    if (typeof dest === 'number') {
      const port = this.portForContext(dest);
      if (port) {
        port.postMessage(envelope);
        return;
      }
    }

    if (this.link) {
      this.link.send(envelope);
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

  /** Port bound at identity time; the live host fabric covers a child we sent to first. */
  private portForContext(contextId: number): MessagePort | null {
    const bound = this.hub.portForContext(contextId);
    if (bound) return bound;
    const win = this.childFabric?.windowOf(contextId) ?? null;
    return this.hub.portForWindow(win);
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

}

export { VirtualDomainBus as ProjectionBus };
export const PROJECTION_BUS_CHANNEL = CONTEXT_BUS_CHANNEL;
