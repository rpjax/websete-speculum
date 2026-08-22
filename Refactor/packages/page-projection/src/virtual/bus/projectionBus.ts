/**
 * postMessage bus — control RPC (snapshot/mint/resume) + loose events (frames, telemetry).
 * Resync enters only via sidecar PlaneChannel.Control (`requestResync` in bootstrap); root
 * then {@link publishResyncRequest} fan-outs a loose `resyncRequest` to nested producer windows.
 * Root runtime implements emitFrame / mint / telemetry fan-out. Nested hops toward parent.
 */

import type { ProjectionTelemetryMessage } from '../../core/telemetry';
import type { SnapshotOptions, SnapshotResult } from '../snapshot';

export const PROJECTION_BUS_CHANNEL = 'speculum.projection.bus';

export type ControlMethod = 'getScopeId' | 'mint' | 'snapshot' | 'resumeContext';

export type ResyncRequestEvent = {
  contextId: number;
  reason?: string;
  generation?: number;
  sequence?: number;
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

type ControlEnvelope = {
  channel: typeof PROJECTION_BUS_CHANNEL;
  kind: 'control';
  type: 'request' | 'response' | 'heartbeat';
  method: ControlMethod;
  correlationId: number;
  contextId?: number;
  opts?: SnapshotRpcOpts;
  ok?: boolean;
  value?: number | SnapshotRpcPayload;
  reason?: string;
};

type LooseEnvelope =
  | {
      channel: typeof PROJECTION_BUS_CHANNEL;
      kind: 'loose';
      type: 'frame';
      bytes: ArrayBuffer;
    }
  | {
      channel: typeof PROJECTION_BUS_CHANNEL;
      kind: 'loose';
      type: 'resyncRequest';
      contextId: number;
      reason?: string;
      generation?: number;
      sequence?: number;
    }
  | {
      channel: typeof PROJECTION_BUS_CHANNEL;
      kind: 'loose';
      type: 'telemetry';
      message: ProjectionTelemetryMessage;
    };

type Envelope = ControlEnvelope | LooseEnvelope;

function isEnvelope(data: unknown): data is Envelope {
  if (typeof data !== 'object' || data === null) return false;
  const rec = data as { channel?: unknown; kind?: unknown };
  return rec.channel === PROJECTION_BUS_CHANNEL && (rec.kind === 'control' || rec.kind === 'loose');
}

export type ProjectionBusOptions = {
  window: Window;
  /** Immediate parent. Nested only. */
  parent?: Window | null;
  role: 'root' | 'nested';
  mint?: () => number;
  emitFrame?: (bytes: Uint8Array) => void;
};

type PendingNumberRpc = {
  kind: 'number';
  resolve: (value: number | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingSnapshotRpc = {
  kind: 'snapshot';
  resolve: (value: SnapshotRpcResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingResumeRpc = {
  kind: 'resume';
  resolve: (value: { ok: boolean; reason?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingRpc = PendingNumberRpc | PendingSnapshotRpc | PendingResumeRpc;

const GET_SCOPE_TIMEOUT_MS = 200;
const MINT_TIMEOUT_MS = 500;
const SNAPSHOT_TIMEOUT_MS = 8_000;
const RESUME_TIMEOUT_MS = 2_000;

export type SnapshotHandler = (opts?: SnapshotRpcOpts) => SnapshotResult;
export type ResumeHandler = () => void;

export class ProjectionBus {
  private readonly win: Window;
  private readonly parent: Window | null;
  private readonly mintFn: (() => number) | null;
  private readonly emitFrameFn: ((bytes: Uint8Array) => void) | null;
  private corr = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly forward = new Map<number, MessageEventSource | null>();
  private lookupScopeId: ((source: MessageEventSource) => number | undefined) | null = null;
  private readonly frameListeners = new Set<(bytes: Uint8Array) => void>();
  private readonly resyncListeners = new Set<(req: ResyncRequestEvent) => void>();
  private readonly telemetryListeners = new Set<(message: ProjectionTelemetryMessage) => void>();
  private mine = 1;
  private snapshotHandler: SnapshotHandler | null = null;
  private resumeHandler: ResumeHandler | null = null;
  private readonly onMessage = (event: MessageEvent): void => {
    void this.handleMessage(event);
  };

  constructor(opts: ProjectionBusOptions) {
    this.win = opts.window;
    this.parent = opts.parent ?? null;
    this.mintFn = opts.mint ?? null;
    this.emitFrameFn = opts.emitFrame ?? null;
    this.win.addEventListener('message', this.onMessage);
  }

  setMine(contextId: number): void {
    this.mine = contextId;
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

  dispose(): void {
    this.win.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  onFrame(cb: (bytes: Uint8Array) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onResyncRequest(cb: (req: ResyncRequestEvent) => void): () => void {
    this.resyncListeners.add(cb);
    return () => this.resyncListeners.delete(cb);
  }

  onTelemetry(cb: (message: ProjectionTelemetryMessage) => void): () => void {
    this.telemetryListeners.add(cb);
    return () => this.telemetryListeners.delete(cb);
  }

  emitFrame(bytes: Uint8Array): void {
    if (this.emitFrameFn) {
      this.emitFrameFn(bytes);
      return;
    }
    this.postToParent({
      channel: PROJECTION_BUS_CHANNEL,
      kind: 'loose',
      type: 'frame',
      bytes: bytes.slice().buffer,
    });
  }

  emitTelemetry(message: ProjectionTelemetryMessage): void {
    if (this.emitFrameFn) {
      this.dispatchTelemetry(message);
      this.fanoutTelemetry(message);
      return;
    }
    this.postToParent({
      channel: PROJECTION_BUS_CHANNEL,
      kind: 'loose',
      type: 'telemetry',
      message,
    });
  }

  /** Nested: retry until parent answers with C ≥ 2. Timeout never means root. */
  async getScopeId(): Promise<number> {
    for (;;) {
      const value = await this.controlRequestNumber('getScopeId', GET_SCOPE_TIMEOUT_MS);
      if (typeof value === 'number' && value >= 2) return value;
    }
  }

  async requestMint(): Promise<number | undefined> {
    if (this.mintFn) return this.mintFn();
    return this.controlRequestNumber('mint', MINT_TIMEOUT_MS);
  }

  async requestSnapshot(contextId: number, opts?: SnapshotRpcOpts): Promise<SnapshotRpcResult> {
    if (contextId === this.mine && this.snapshotHandler) {
      const value = this.snapshotHandler(opts);
      let tree: unknown;
      if (opts?.includeTree) {
        const snap = (globalThis as { __speculumSnapshot?: { snapshotTree?: () => unknown } }).__speculumSnapshot;
        tree = snap?.snapshotTree?.() ?? null;
      }
      return { ok: true, value: { ...value, contextId, tree } };
    }
    const childHit = await this.askChildrenSnapshot(contextId, opts);
    if (childHit !== null) return childHit;
    if (this.parent) return this.controlRequestSnapshot(contextId, opts);
    return { ok: false, reason: 'context_not_found' };
  }

  async requestResumeContext(contextId: number): Promise<{ ok: boolean; reason?: string }> {
    if (contextId === this.mine && this.resumeHandler) {
      this.resumeHandler();
      return { ok: true };
    }
    const childHit = await this.askChildrenResume(contextId);
    if (childHit !== null) return childHit;
    if (this.parent) return this.controlRequestResume(contextId);
    return { ok: false, reason: 'context_not_found' };
  }

  /** Fan inbound sidecar frames onto the bus (root runtime). */
  publishFrame(bytes: Uint8Array): void {
    this.dispatchFrame(bytes);
    this.fanoutFrame(bytes);
  }

  /** After Control plane `requestResync` — local listeners + nested producer fan-out only. */
  publishResyncRequest(req: ResyncRequestEvent): void {
    this.dispatchResync(req);
    this.fanoutResync(req);
  }

  private controlRequestNumber(method: 'getScopeId' | 'mint', timeoutMs: number): Promise<number | undefined> {
    const parent = this.parent;
    if (!parent) return Promise.resolve(undefined);
    const correlationId = this.corr++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve(undefined);
      }, timeoutMs);
      this.pending.set(correlationId, { kind: 'number', resolve, timer });
      parent.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'request',
          method,
          correlationId,
        } satisfies ControlEnvelope,
        '*',
      );
    });
  }

  private controlRequestSnapshot(contextId: number, opts?: SnapshotRpcOpts): Promise<SnapshotRpcResult> {
    const parent = this.parent;
    if (!parent) return Promise.resolve({ ok: false, reason: 'no_parent' });
    const correlationId = this.corr++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve({ ok: false, reason: 'timeout' });
      }, SNAPSHOT_TIMEOUT_MS);
      this.pending.set(correlationId, { kind: 'snapshot', resolve, timer });
      parent.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'request',
          method: 'snapshot',
          correlationId,
          contextId,
          opts,
        } satisfies ControlEnvelope,
        '*',
      );
    });
  }

  private controlRequestResume(contextId: number): Promise<{ ok: boolean; reason?: string }> {
    const parent = this.parent;
    if (!parent) return Promise.resolve({ ok: false, reason: 'no_parent' });
    const correlationId = this.corr++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve({ ok: false, reason: 'timeout' });
      }, RESUME_TIMEOUT_MS);
      this.pending.set(correlationId, { kind: 'resume', resolve, timer });
      parent.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'request',
          method: 'resumeContext',
          correlationId,
          contextId,
        } satisfies ControlEnvelope,
        '*',
      );
    });
  }

  private askChildrenSnapshot(contextId: number, opts?: SnapshotRpcOpts): Promise<SnapshotRpcResult | null> {
    const children = this.collectChildWindows();
    if (children.length === 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let pending = children.length;
      let answered = false;
      const finish = (result: SnapshotRpcResult | null): void => {
        if (answered) return;
        if (result !== null) {
          answered = true;
          resolve(result);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      };
      for (let i = 0; i < children.length; i++) {
        void this.askWindowSnapshot(children[i]!, contextId, opts).then(finish);
      }
    });
  }

  private askWindowSnapshot(w: Window, contextId: number, opts?: SnapshotRpcOpts): Promise<SnapshotRpcResult | null> {
    const correlationId = this.corr++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve(null);
      }, SNAPSHOT_TIMEOUT_MS);
      this.pending.set(correlationId, {
        kind: 'snapshot',
        resolve: (result) => {
          resolve(result.ok ? result : null);
        },
        timer,
      });
      w.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'request',
          method: 'snapshot',
          correlationId,
          contextId,
          opts,
        } satisfies ControlEnvelope,
        '*',
      );
    });
  }

  private askChildrenResume(contextId: number): Promise<{ ok: boolean; reason?: string } | null> {
    const children = this.collectChildWindows();
    if (children.length === 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let pending = children.length;
      let answered = false;
      const finish = (result: { ok: boolean; reason?: string } | null): void => {
        if (answered) return;
        if (result?.ok) {
          answered = true;
          resolve(result);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      };
      for (let i = 0; i < children.length; i++) {
        void this.askWindowResume(children[i]!, contextId).then(finish);
      }
    });
  }

  private askWindowResume(w: Window, contextId: number): Promise<{ ok: boolean; reason?: string } | null> {
    const correlationId = this.corr++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve(null);
      }, RESUME_TIMEOUT_MS);
      this.pending.set(correlationId, {
        kind: 'resume',
        resolve: (result) => {
          resolve(result.ok ? result : null);
        },
        timer,
      });
      w.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'request',
          method: 'resumeContext',
          correlationId,
          contextId,
        } satisfies ControlEnvelope,
        '*',
      );
    });
  }

  private postToParent(envelope: Envelope): void {
    if (!this.parent) return;
    this.parent.postMessage(envelope, '*');
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!isEnvelope(event.data)) return;
    const env = event.data;
    if (env.kind === 'control') {
      await this.handleControl(env, event);
      return;
    }
    if (env.type === 'frame') {
      const bytes = new Uint8Array(env.bytes);
      if (event.source === this.parent) {
        this.dispatchFrame(bytes);
        this.fanoutFrame(bytes);
        return;
      }
      if (this.emitFrameFn) this.emitFrameFn(bytes);
      else this.postToParent(env);
      return;
    }
    if (env.type === 'telemetry') {
      if (event.source === this.parent) {
        this.dispatchTelemetry(env.message);
        this.fanoutTelemetry(env.message);
        return;
      }
      if (this.emitFrameFn) {
        this.dispatchTelemetry(env.message);
        return;
      }
      this.postToParent(env);
      return;
    }
    if (env.type !== 'resyncRequest') return;
    // Fan-down only (root → nested after Control-plane entry). Upward loose resync is forbidden.
    if (event.source !== this.parent) return;
    const req: ResyncRequestEvent = {
      contextId: env.contextId,
      reason: env.reason,
      generation: env.generation,
      sequence: env.sequence,
    };
    this.dispatchResync(req);
    this.fanoutResync(req);
  }

  private async handleControl(env: ControlEnvelope, event: MessageEvent): Promise<void> {
    if (env.type === 'response') {
      const hop = this.forward.get(env.correlationId);
      if (hop) {
        this.forward.delete(env.correlationId);
        (hop as Window).postMessage(env, '*');
        return;
      }
      const pending = this.pending.get(env.correlationId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(env.correlationId);
      if (pending.kind === 'number') {
        pending.resolve(env.ok === true ? (env.value as number | undefined) : undefined);
        return;
      }
      if (pending.kind === 'snapshot') {
        if (env.ok === true && env.value && typeof env.value === 'object' && 'sequence' in env.value) {
          pending.resolve({ ok: true, value: env.value as SnapshotRpcPayload });
        } else {
          pending.resolve({ ok: false, reason: env.reason ?? 'snapshot_failed' });
        }
        return;
      }
      pending.resolve({ ok: env.ok === true, reason: env.reason });
      return;
    }
    if (env.type === 'heartbeat') {
      const pending = this.pending.get(env.correlationId);
      if (!pending || pending.kind !== 'number') return;
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        this.pending.delete(env.correlationId);
        pending.resolve(undefined);
      }, GET_SCOPE_TIMEOUT_MS);
      return;
    }
    if (env.type !== 'request') return;
    const source = event.source;
    if (source == null) return;

    if (env.method === 'getScopeId') {
      const c = this.lookupScopeId?.(source);
      if (c === undefined) {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'heartbeat',
            method: 'getScopeId',
            correlationId: env.correlationId,
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      (source as Window).postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'response',
          method: 'getScopeId',
          correlationId: env.correlationId,
          ok: true,
          value: c,
        } satisfies ControlEnvelope,
        '*',
      );
      return;
    }

    if (env.method === 'mint') {
      if (this.mintFn) {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'mint',
            correlationId: env.correlationId,
            ok: true,
            value: this.mintFn(),
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      if (!this.parent) return;
      this.forward.set(env.correlationId, source);
      this.parent.postMessage(env, '*');
      return;
    }

    if (env.method === 'snapshot') {
      const contextId = env.contextId;
      if (typeof contextId !== 'number') {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'snapshot',
            correlationId: env.correlationId,
            ok: false,
            reason: 'missing_contextId',
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      if (contextId === this.mine && this.snapshotHandler) {
        const value = this.snapshotHandler(env.opts);
        let tree: unknown;
        if (env.opts?.includeTree) {
          const snap = (globalThis as { __speculumSnapshot?: { snapshotTree?: () => unknown } }).__speculumSnapshot;
          tree = snap?.snapshotTree?.() ?? null;
        }
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'snapshot',
            correlationId: env.correlationId,
            ok: true,
            value: { ...value, contextId, tree },
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      const childHit = await this.askChildrenSnapshot(contextId, env.opts);
      if (childHit !== null) {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'snapshot',
            correlationId: env.correlationId,
            ok: childHit.ok,
            value: childHit.ok ? childHit.value : undefined,
            reason: childHit.ok ? undefined : childHit.reason,
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      if (this.parent) {
        this.forward.set(env.correlationId, source);
        this.parent.postMessage(env, '*');
        return;
      }
      (source as Window).postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'response',
          method: 'snapshot',
          correlationId: env.correlationId,
          ok: false,
          reason: 'context_not_found',
        } satisfies ControlEnvelope,
        '*',
      );
      return;
    }

    if (env.method === 'resumeContext') {
      const contextId = env.contextId;
      if (typeof contextId !== 'number') {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'resumeContext',
            correlationId: env.correlationId,
            ok: false,
            reason: 'missing_contextId',
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      if (contextId === this.mine && this.resumeHandler) {
        this.resumeHandler();
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'resumeContext',
            correlationId: env.correlationId,
            ok: true,
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      const childHit = await this.askChildrenResume(contextId);
      if (childHit !== null) {
        (source as Window).postMessage(
          {
            channel: PROJECTION_BUS_CHANNEL,
            kind: 'control',
            type: 'response',
            method: 'resumeContext',
            correlationId: env.correlationId,
            ok: childHit.ok,
            reason: childHit.reason,
          } satisfies ControlEnvelope,
          '*',
        );
        return;
      }
      if (this.parent) {
        this.forward.set(env.correlationId, source);
        this.parent.postMessage(env, '*');
        return;
      }
      (source as Window).postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'control',
          type: 'response',
          method: 'resumeContext',
          correlationId: env.correlationId,
          ok: false,
          reason: 'context_not_found',
        } satisfies ControlEnvelope,
        '*',
      );
    }
  }

  private dispatchFrame(bytes: Uint8Array): void {
    for (const cb of this.frameListeners) cb(bytes);
  }

  private dispatchResync(req: ResyncRequestEvent): void {
    for (const cb of this.resyncListeners) cb(req);
  }

  private dispatchTelemetry(message: ProjectionTelemetryMessage): void {
    for (const cb of this.telemetryListeners) cb(message);
  }

  private fanoutFrame(bytes: Uint8Array): void {
    const copy = bytes.slice();
    this.forEachChildWindow((w) => {
      w.postMessage(
        { channel: PROJECTION_BUS_CHANNEL, kind: 'loose', type: 'frame', bytes: copy.buffer },
        '*',
      );
    });
  }

  private fanoutResync(req: ResyncRequestEvent): void {
    this.forEachChildWindow((w) => {
      w.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'loose',
          type: 'resyncRequest',
          contextId: req.contextId,
          reason: req.reason,
          generation: req.generation,
          sequence: req.sequence,
        },
        '*',
      );
    });
  }

  private fanoutTelemetry(message: ProjectionTelemetryMessage): void {
    this.forEachChildWindow((w) => {
      w.postMessage(
        {
          channel: PROJECTION_BUS_CHANNEL,
          kind: 'loose',
          type: 'telemetry',
          message,
        },
        '*',
      );
    });
  }

  private collectChildWindows(): Window[] {
    const out: Window[] = [];
    this.forEachChildWindow((w) => out.push(w));
    return out;
  }

  private forEachChildWindow(fn: (w: Window) => void): void {
    const doc = this.win.document;
    const hosts = doc.querySelectorAll('iframe,frame,object,embed');
    for (let i = 0; i < hosts.length; i++) {
      const el = hosts[i] as { contentWindow?: Window | null };
      const w = el.contentWindow;
      if (w) fn(w);
    }
  }
}
