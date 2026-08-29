/**
 * Nested Projected apply — one instance per child contextId, targeting the blank host document.
 * Parent installs this after NODE_NEW of a nested host (same-origin blank iframe).
 * Resync recovery matches root client (Stage 4 / frame-protocol.md §5.8).
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '../core/decode';
import { DomFrameApplier } from './applyDom';
import { createNestedResyncSurface, type NestedResyncSurface } from './nestedResyncSurface';
import { PageProjectionRegistry } from './registry';
import { DOCUMENT_ID } from '../core/frame';
import { digestReplicatedTable } from '../core/tableDigest';
import { desyncPhase, TELEMETRY_WIRE_VERSION, type TelemetryPhase } from '../core/telemetry';
import { stampAttrAuth, stampCssTextAuth } from './sessionBindingAuth';

export type NestedProjectedApplyOptions = {
  hostIframe: HTMLIFrameElement;
  document: Document;
  contextId: number;
  onArmed?: () => void;
  onNestedHost?: (iframe: HTMLIFrameElement, childScopeId: number) => void;
  onNestedHostDrop?: (childScopeId: number) => void;
  onTelemetry?: (msg: Record<string, unknown>) => void;
  onRequestResync?: (info: {
    contextId: number;
    generation: number;
    sequence: number;
    reason: string;
  }) => void;
  getToken?: () => string | undefined;
  getAssetBaseUrl?: () => string | undefined;
};

type ApplyTarget = {
  applier: DomFrameApplier;
  registry: PageProjectionRegistry;
};

type ResyncBuild = ApplyTarget & { attempt: number };

const MAX_RESYNC_ATTEMPTS = 3;
const RESYNC_BACKOFF_MS = 300;
const RESYNC_RESPONSE_TIMEOUT_MS = 5_000;

export class NestedProjectedApply {
  readonly contextId: number;
  readonly hostIframe: HTMLIFrameElement;
  private readonly surface: NestedResyncSurface;
  private persistent = new PersistentStringTable();
  private assembler = new FramePartAssembler();
  private live: ApplyTarget;
  private resync: ResyncBuild | null = null;
  private resyncAttempts = 0;
  private resyncExhausted = false;
  private resyncBackoffTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 1;
  private lastSequence = 0;
  private armed = false;
  private everArmed = false;
  private lastDesyncReason: string | null = null;
  private lastDesyncMessage: string | null = null;
  private surfaceEpoch = 0;
  private readonly onArmedCb?: () => void;
  private readonly onNestedHostCb?: NestedProjectedApplyOptions['onNestedHost'];
  private readonly onNestedHostDropCb?: NestedProjectedApplyOptions['onNestedHostDrop'];
  private readonly onTelemetry?: NestedProjectedApplyOptions['onTelemetry'];
  private readonly onRequestResyncCb?: NestedProjectedApplyOptions['onRequestResync'];
  private readonly getToken?: () => string | undefined;
  private readonly getAssetBaseUrl?: () => string | undefined;

  constructor(opts: NestedProjectedApplyOptions) {
    this.contextId = opts.contextId;
    this.hostIframe = opts.hostIframe;
    this.onArmedCb = opts.onArmed;
    this.onNestedHostCb = opts.onNestedHost;
    this.onNestedHostDropCb = opts.onNestedHostDrop;
    this.onTelemetry = opts.onTelemetry;
    this.onRequestResyncCb = opts.onRequestResync;
    this.getToken = opts.getToken;
    this.getAssetBaseUrl = opts.getAssetBaseUrl;
    this.surface = createNestedResyncSurface(opts.hostIframe);
    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, opts.document);
    this.live = { applier: this.createApplier(opts.document, registry, true), registry };
  }

  get isArmed(): boolean {
    return this.armed;
  }

  get desynced(): boolean {
    return this.lastDesyncReason !== null;
  }

  get applyError(): string | null {
    if (this.lastDesyncReason === null) return null;
    return this.lastDesyncMessage
      ? `${this.lastDesyncReason} | ${this.lastDesyncMessage}`
      : this.lastDesyncReason;
  }

  get resyncInFlight(): boolean {
    return this.resync !== null;
  }

  getGeneration(): number {
    return this.generation;
  }

  get registry(): PageProjectionRegistry {
    return this.live.registry;
  }

  markPropDirty(id: number): void {
    this.live.applier.markPropDirty(id);
  }

  get document(): Document {
    return this.surface.document;
  }

  ingest(bytes: Uint8Array): void {
    const decoded = decodeFramePart(bytes, this.persistent);
    if (!decoded.ok) {
      this.desync(decoded.reason, { message: decoded.message });
      return;
    }
    if (decoded.part.contextId !== this.contextId) return;
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part' || assembled === 'malformed') {
      this.desync(assembled);
      return;
    }
    if (assembled === null) return;
    this.applyAssembled(assembled);
    this.live.applier.flush();
    this.resync?.applier.flush();
  }

  flush(): void {
    this.live.applier.flush();
    this.resync?.applier.flush();
  }

  snapshotTable(): {
    sequence: number;
    generation: number;
    table: ReturnType<typeof digestReplicatedTable>;
  } {
    return {
      sequence: this.lastSequence,
      generation: this.generation,
      table: digestReplicatedTable(this.live.applier.replicatedTable),
    };
  }

  dispose(): void {
    this.abandonResyncAttempt();
    void this.surface.reset();
    this.live.applier.dispose();
  }

  private createApplier(doc: Document, registry: PageProjectionRegistry, initiallyLive: boolean): DomFrameApplier {
    const state = { swapped: initiallyLive };
    const token = () => this.getToken?.() || '';
    const base = () => this.getAssetBaseUrl?.() || '';
    return new DomFrameApplier(doc, registry, {
      stampUrl: (name, value) => stampAttrAuth(name, value, token(), base()),
      stampCssText: (text) => stampCssTextAuth(text, token(), base()),
      onWarn: (message) => {
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId: this.contextId,
          kind: 'clientWarn',
          t: performance.now(),
          message,
        });
      },
      onDesync: (info) => {
        if (state.swapped) {
          this.reportApplyResult({
            ok: false,
            sequence: this.lastSequence,
            opCount: 0,
            applyMs: 0,
            reason: info.reason,
          });
          this.desync(info.reason, {
            op: info.op,
            id: info.id,
            expected: info.expected,
            actual: info.actual,
            message: info.message,
            phase: info.phase,
          });
        } else {
          this.failResyncAttempt(info.reason);
        }
      },
      onNestedHost: (iframe, childScopeId) => this.onNestedHostCb?.(iframe, childScopeId),
      onNestedHostDrop: (childScopeId) => this.onNestedHostDropCb?.(childScopeId),
      onApplied: (frame, applyMs) => {
        if (state.swapped) {
          this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
          if (!this.armed) {
            this.armed = true;
            this.everArmed = true;
            this.onArmedCb?.();
          }
        } else {
          state.swapped = true;
          this.commitResyncSwap(frame, applyMs);
        }
      },
      onOverrun: (durationMs, lastSequence) => {
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId: this.contextId,
          kind: 'applyOverrun',
          t: performance.now(),
          generation: this.generation,
          sequence: lastSequence,
          durationMs,
          budgetMs: 4,
        });
      },
    });
  }

  private applyAssembled(frame: AssembledFrame): void {
    if (frame.generation !== this.generation) {
      // runtime-redesign.md §7 — inner navigation keeps the `contextId` and replaces the install.
      // Destroy this instance's applier and rebuild on a clean host document instead of resetting
      // its state piecemeal; the resync frame carrying the new generation then behaves as a cold
      // start for this context.
      this.lastSequence = frame.sequence - 1;
      void this.recreateForGenerationAsync(frame);
      return;
    }

    if (frame.resync) {
      this.lastSequence = frame.sequence - 1;
      if (this.everArmed) {
        void this.beginResyncTargetAsync(frame);
        return;
      }
    }

    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    const target = this.resync ?? this.live;
    target.applier.enqueue(frame);
  }

  private async recreateForGenerationAsync(frame: AssembledFrame): Promise<void> {
    this.abandonResyncAttempt();
    this.resyncAttempts = 0;
    this.resyncExhausted = false;
    this.generation = frame.generation;
    this.armed = false;
    this.everArmed = false;
    this.live.applier.dispose();
    const epoch = ++this.surfaceEpoch;
    await this.surface.reset();
    if (epoch !== this.surfaceEpoch) return;
    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, this.surface.document);
    this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    this.live.applier.enqueue(frame);
    this.live.applier.flush();
  }

  private async beginResyncTargetAsync(frame: AssembledFrame): Promise<void> {
    if (this.resyncTimeoutTimer !== null) {
      clearTimeout(this.resyncTimeoutTimer);
      this.resyncTimeoutTimer = null;
    }
    if (this.resync !== null) {
      this.surface.discardBuild();
      this.resync = null;
    }
    const epoch = ++this.surfaceEpoch;
    const doc = await this.surface.beginResyncBuild();
    if (epoch !== this.surfaceEpoch) return;
    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, doc);
    const applier = this.createApplier(doc, registry, false);
    this.resync = { applier, registry, attempt: this.resyncAttempts };
    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    applier.enqueue(frame);
    applier.flush();
  }

  private commitResyncSwap(frame: AssembledFrame, applyMs: number): void {
    const built = this.resync;
    if (built === null) return;
    this.surface.commitSwap();
    this.live = { applier: built.applier, registry: built.registry };
    this.resync = null;
    this.resyncAttempts = 0;
    this.resyncExhausted = false;
    this.onTelemetry?.({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'resyncCompleted',
      t: performance.now(),
      generation: this.generation,
      sequence: frame.sequence,
      attempt: built.attempt,
    });
    this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
    if (!this.armed) {
      this.armed = true;
      this.everArmed = true;
      this.onArmedCb?.();
    }
  }

  private failResyncAttempt(reason: string): void {
    const attempt = this.resync?.attempt ?? this.resyncAttempts;
    if (this.resync !== null) {
      this.surface.discardBuild();
      this.resync = null;
    }
    this.onTelemetry?.({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'resyncFailed',
      t: performance.now(),
      generation: this.generation,
      sequence: this.lastSequence,
      attempt,
      reason,
      exhausted: false,
    });
    this.scheduleResyncAttempt(reason);
  }

  private abandonResyncAttempt(): void {
    if (this.resyncBackoffTimer !== null) {
      clearTimeout(this.resyncBackoffTimer);
      this.resyncBackoffTimer = null;
    }
    if (this.resyncTimeoutTimer !== null) {
      clearTimeout(this.resyncTimeoutTimer);
      this.resyncTimeoutTimer = null;
    }
    if (this.resync !== null) {
      this.surface.discardBuild();
      this.resync = null;
    }
  }

  private scheduleResyncAttempt(reason: string): void {
    if (this.resyncExhausted) return;
    if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null) return;
    const attempt = this.resyncAttempts + 1;
    if (attempt > MAX_RESYNC_ATTEMPTS) {
      this.resyncExhausted = true;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
        kind: 'resyncFailed',
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        attempt: this.resyncAttempts,
        reason,
        exhausted: true,
      });
      return;
    }
    const delay = attempt === 1 ? 0 : RESYNC_BACKOFF_MS * (attempt - 1);
    this.resyncBackoffTimer = setTimeout(() => {
      this.resyncBackoffTimer = null;
      this.resyncAttempts = attempt;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
        kind: 'resyncRequested',
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        reason,
        attempt,
      });
      this.onRequestResyncCb?.({
        contextId: this.contextId,
        generation: this.generation,
        sequence: this.lastSequence,
        reason,
      });
      this.resyncTimeoutTimer = setTimeout(() => {
        this.resyncTimeoutTimer = null;
        this.failResyncAttempt('resync_timeout');
      }, RESYNC_RESPONSE_TIMEOUT_MS);
    }, delay);
  }

  private reportApplyResult(info: {
    ok: boolean;
    sequence: number;
    opCount: number;
    applyMs: number;
    reason?: string;
  }): void {
    this.onTelemetry?.({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'applyResult',
      t: performance.now(),
      generation: this.generation,
      sequence: info.sequence,
      ok: info.ok,
      opCount: info.opCount,
      applyMs: info.applyMs,
      tableSize: this.live.applier.replicatedTable.size,
      reason: info.reason,
    });
  }

  private desync(
    reason: string,
    extra?: {
      expectedSequence?: number;
      gotSequence?: number;
      op?: string;
      id?: number;
      message?: string;
      expected?: bigint;
      actual?: bigint;
      phase?: TelemetryPhase;
    },
  ): void {
    if (this.lastDesyncReason === null) {
      this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
      this.lastDesyncMessage = extra?.message ?? null;
    }
    this.armed = false;
    this.assembler.reset();
    this.live.applier.reset();
    this.onTelemetry?.({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'desynced',
      t: performance.now(),
      generation: this.generation,
      sequence: extra?.gotSequence ?? this.lastSequence,
      errorCode: reason,
      phase: extra?.phase ?? desyncPhase(reason),
      expectedSequence: extra?.expectedSequence,
      op: extra?.op,
      id: extra?.id,
      message: extra?.message,
      expected: extra?.expected?.toString(),
      actual: extra?.actual?.toString(),
    });
    this.scheduleResyncAttempt(reason);
  }
}
