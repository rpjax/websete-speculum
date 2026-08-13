/**
 * Lab / shared DOM projection client — decode → establish/live apply → surface.
 */

import {
  decodeFramePart,
  FramePartAssembler,
  type AssembledFrame,
  type DocumentStateOp,
  type EstablishBeginOp,
  type EstablishEndOp,
} from './decode';
import { DomFrameApplier, applyDocumentState, type ApplyFrameNotes } from './applyDom';
import { PageProjectionRegistry } from './registry';
import { createSurfaceHost, type SurfaceBuildHandle, type SurfaceHost } from './surface';
import { captureParityFingerprint } from './parityFingerprint';
import { desyncPhase } from '../models/telemetry';

export type LabProjectionClientOptions = {
  surfaceHost: HTMLElement;
  width?: number;
  height?: number;
  onTelemetry?: (msg: Record<string, unknown>) => void;
  onArmed?: () => void;
  onDesync?: (reason: string) => void;
};

export class LabProjectionClient {
  private readonly surface: SurfaceHost;
  private readonly assembler = new FramePartAssembler();
  private readonly onTelemetry?: (msg: Record<string, unknown>) => void;
  private readonly onArmed?: () => void;
  private readonly onDesyncCb?: (reason: string) => void;

  private lastSequence = -1;
  private generation = 0;
  private armed = false;
  private build: SurfaceBuildHandle | null = null;
  private buildRegistry: PageProjectionRegistry | null = null;
  private liveRegistry: PageProjectionRegistry | null = null;
  private liveApplier: DomFrameApplier | null = null;
  private pendingBegin: EstablishBeginOp | null = null;
  private pendingDocumentState: DocumentStateOp | null = null;

  constructor(opts: LabProjectionClientOptions) {
    this.surface = createSurfaceHost(opts.surfaceHost, {
      width: opts.width ?? 1280,
      height: opts.height ?? 720,
    });
    this.onTelemetry = opts.onTelemetry;
    this.onArmed = opts.onArmed;
    this.onDesyncCb = opts.onDesync;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  ingest(bytes: Uint8Array): void {
    const decoded = decodeFramePart(bytes);
    if (!decoded.ok) {
      this.desync(decoded.reason, { message: decoded.message });
      return;
    }
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part') {
      this.desync('missing_part');
      return;
    }
    if (assembled === null) return;
    this.applyAssembled(assembled);
  }

  private applyAssembled(frame: AssembledFrame): void {
    if (frame.establish) {
      this.applyEstablish(frame);
      return;
    }
    if (!this.armed || !this.liveApplier || !this.liveRegistry) {
      this.desync('not_armed');
      return;
    }
    if (frame.generation !== this.generation) {
      this.desync('generation_mismatch', { message: `got ${frame.generation} have ${this.generation}` });
      return;
    }
    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    this.liveApplier.enqueue(frame);
  }

  private applyEstablish(frame: AssembledFrame): void {
    if (!this.build) {
      this.build = this.surface.beginBuild();
      this.buildRegistry = new PageProjectionRegistry();
      this.pendingBegin = null;
      this.pendingDocumentState = null;
    }
    for (const op of frame.ops) {
      if (op.op === 'establishBegin') {
        this.generation = op.generation;
        this.pendingBegin = op;
      } else if (op.op === 'establishChunk') {
        this.build?.writeChunk(op.html);
      } else if (op.op === 'documentState') {
        this.pendingDocumentState = op;
        if (this.build?.document.documentElement) {
          applyDocumentState(this.build.document, op);
        }
      } else if (op.op === 'establishEnd') {
        this.finishEstablish(op);
      }
    }
  }

  private finishEstablish(op: EstablishEndOp): void {
    const build = this.build;
    const registry = this.buildRegistry;
    if (!build || !registry) return;
    build.markEstablishEnd();
    build.markCssomReady();

    if (this.pendingDocumentState && build.document.documentElement) {
      applyDocumentState(build.document, this.pendingDocumentState);
    }

    const verified = registry.buildFromDocument(build.document);
    if (verified.nodeCount !== op.nodeCount || verified.checksum !== op.checksum) {
      this.reportApply({
        ok: false,
        establish: true,
        sequence: 0,
        reason: 'checksum_mismatch',
        nodeCount: verified.nodeCount,
        checksum: op.checksum,
        registrySize: registry.size,
      });
      this.emitFingerprint(build.document, registry, 0, true);
      this.desync('establish_checksum', {
        message: `got nodeCount=${verified.nodeCount} checksum=${verified.checksum} want ${op.nodeCount}/${op.checksum}`,
      });
      build.cancel();
      this.build = null;
      this.buildRegistry = null;
      return;
    }

    void build.swap().then((doc) => {
      this.liveRegistry = registry;
      this.liveApplier = new DomFrameApplier(doc, registry, {
        onDesync: (info) => {
          this.reportApply({
            ok: false,
            establish: false,
            sequence: this.lastSequence,
            reason: info.reason,
            registrySize: registry.size,
          });
          this.desync(info.reason, { op: info.op, id: info.id });
        },
        onApplied: (f, notes) => {
          this.reportApply({
            ok: true,
            establish: false,
            sequence: f.sequence,
            registrySize: registry.size,
            appendOntoNonEmptyCount: notes.appendOntoNonEmptyCount,
          });
          this.emitFingerprint(doc, registry, f.sequence, false);
          this.emitApplyNotes(f.sequence, notes);
        },
        onOverrun: (durationMs, lastSequence) => {
          this.onTelemetry?.({
            v: 1,
            kind: 'applyOverrun',
            t: performance.now(),
            generation: this.generation,
            sequence: lastSequence,
            durationMs,
            budgetMs: 4,
          });
        },
      });
      if (this.pendingBegin) {
        doc.defaultView?.scrollTo(this.pendingBegin.scrollX, this.pendingBegin.scrollY);
      }
      this.lastSequence = 0;
      this.armed = true;
      this.build = null;
      this.buildRegistry = null;
      this.reportApply({
        ok: true,
        establish: true,
        sequence: 0,
        nodeCount: verified.nodeCount,
        checksum: verified.checksum,
        registrySize: registry.size,
      });
      this.emitFingerprint(doc, registry, 0, true);
      this.onArmed?.();
    });
  }

  private emitApplyNotes(sequence: number, notes: ApplyFrameNotes): void {
    if (notes.appendOntoNonEmptyCount === 0 && notes.childLists.length === 0) return;
    this.onTelemetry?.({
      v: 1,
      kind: 'applyDecision',
      t: performance.now(),
      generation: this.generation,
      sequence,
      appendOntoNonEmptyCount: notes.appendOntoNonEmptyCount,
      childLists: notes.childLists,
      patches: notes.patches,
      scrolls: notes.scrolls,
    });
  }

  private emitFingerprint(
    doc: Document,
    registry: PageProjectionRegistry,
    sequence: number,
    establish: boolean,
  ): void {
    const fp = captureParityFingerprint(doc, registry);
    this.onTelemetry?.({
      v: 1,
      kind: 'parityFingerprint',
      t: performance.now(),
      generation: this.generation,
      sequence,
      establish,
      ...fp,
    });
  }

  private reportApply(info: {
    ok: boolean;
    establish: boolean;
    sequence: number;
    reason?: string;
    nodeCount?: number;
    checksum?: number;
    registrySize?: number;
    appendOntoNonEmptyCount?: number;
  }): void {
    this.onTelemetry?.({
      v: 1,
      kind: 'applyResult',
      t: performance.now(),
      generation: this.generation,
      sequence: info.sequence,
      ok: info.ok,
      establish: info.establish,
      reason: info.reason,
      nodeCount: info.nodeCount,
      checksum: info.checksum,
      registrySize: info.registrySize,
      appendOntoNonEmptyCount: info.appendOntoNonEmptyCount,
    });
  }

  private desync(
    reason: string,
    extra?: { expectedSequence?: number; gotSequence?: number; op?: string; id?: number; message?: string },
  ): void {
    this.onTelemetry?.({
      v: 1,
      kind: 'desynced',
      t: performance.now(),
      generation: this.generation,
      sequence: extra?.gotSequence ?? this.lastSequence,
      errorCode: reason,
      phase: desyncPhase(reason),
      expectedSequence: extra?.expectedSequence,
      op: extra?.op,
      id: extra?.id,
      message: extra?.message,
    });
    this.armed = false;
    this.assembler.reset();
    this.liveApplier?.reset();
    this.onDesyncCb?.(reason);
  }
}
