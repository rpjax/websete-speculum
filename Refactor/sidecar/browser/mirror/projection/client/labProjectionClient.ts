/**
 * Lab DOM projection client — decode → apply straight into a live document → surface.
 * No establish / armed-vs-building split (frame-protocol.md §4.7): the first frame this
 * client ever applies is an ordinary frame carrying the whole initial document as
 * `NODE_NEW`/`INSERT` ops, applied the same way as every later frame (P8).
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '../models/decode';
import { DomFrameApplier } from './applyDom';
import { PageProjectionRegistry } from './registry';
import { createSurfaceHost } from './surface';
import { captureParityFingerprint } from './parityFingerprint';
import { desyncPhase, type TelemetryPhase } from '../models/telemetry';
import { DOCUMENT_ID } from '../models/frame';
import { OpCode } from '../models/opcodes';

export type LabProjectionClientOptions = {
  surfaceHost: HTMLElement;
  width?: number;
  height?: number;
  onTelemetry?: (msg: Record<string, unknown>) => void;
  /** Fires once, after the first frame (sequence 1) applies successfully. */
  onArmed?: () => void;
  onDesync?: (reason: string) => void;
};

export class LabProjectionClient {
  private readonly registry = new PageProjectionRegistry();
  private readonly persistentStrings = new PersistentStringTable();
  private readonly assembler = new FramePartAssembler();
  private readonly doc: Document;
  private readonly applier: DomFrameApplier;
  private readonly onTelemetry?: (msg: Record<string, unknown>) => void;
  private readonly onArmedCb?: () => void;
  private readonly onDesyncCb?: (reason: string) => void;

  private lastSequence = 0;
  private generation = 1;
  private armed = false;

  constructor(opts: LabProjectionClientOptions) {
    const surface = createSurfaceHost(opts.surfaceHost, {
      width: opts.width ?? 1280,
      height: opts.height ?? 720,
    });
    this.doc = surface.document;
    this.registry.register(DOCUMENT_ID, this.doc);
    this.onTelemetry = opts.onTelemetry;
    this.onArmedCb = opts.onArmed;
    this.onDesyncCb = opts.onDesync;

    this.applier = new DomFrameApplier(this.doc, this.registry, {
      onDesync: (info) => {
        this.reportApplyResult({ ok: false, sequence: this.lastSequence, opCount: 0, applyMs: 0, reason: info.reason });
        this.desync(info.reason, {
          op: info.op,
          id: info.id,
          expected: info.expected,
          actual: info.actual,
          message: info.message,
          phase: info.phase,
        });
      },
      onApplied: (frame, applyMs) => {
        this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
        this.emitFingerprint(frame.sequence);
        if (!this.armed) {
          this.armed = true;
          this.onArmedCb?.();
        }
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
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * Last sequence accepted into the apply queue (may still be one `requestAnimationFrame` away
   * from actually hitting the DOM) — lab test introspection only (Stage 2 gate: a test needs
   * this to construct a corrupted frame's `sequence` field as exactly `lastAcceptedSequence + 1`).
   */
  get lastAcceptedSequence(): number {
    return this.lastSequence;
  }

  /** Surface iframe's `contentDocument` — used for structural snapshots (lab/structuralDiff.ts). */
  get document(): Document {
    return this.doc;
  }

  ingest(bytes: Uint8Array): void {
    const decoded = decodeFramePart(bytes, this.persistentStrings);
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
    if (frame.generation !== this.generation) {
      // §7 ordering rule 1 ("EPOCH_RESET first, if present") — a frame announcing a new
      // generation is only valid when its own leading op says so explicitly (Stage 3); anything
      // else claiming a different generation without that announcement is a real mismatch.
      const firstOp = frame.ops[0];
      const isEpochReset = firstOp !== undefined && firstOp.op === OpCode.EpochReset;
      if (!isEpochReset || firstOp.generation !== frame.generation) {
        this.desync('generation_mismatch', { message: `got ${frame.generation} have ${this.generation}` });
        return;
      }
      // §1.2/§4.1: "this generation is over, nothing carries forward" — a fresh generation
      // restarts sequence numbering too (bootstrap.ts always sends its first frame at
      // `sequence: 1` for whichever generation it is), so accepting the transition here means
      // resetting `lastSequence` to just before it, not carrying the old generation's count.
      this.generation = frame.generation;
      this.lastSequence = frame.sequence - 1;
    }
    if (frame.sequence !== this.lastSequence + 1) {
      this.desync('sequence_gap', { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
      return;
    }
    this.lastSequence = frame.sequence;
    this.applier.enqueue(frame);
  }

  private emitFingerprint(sequence: number): void {
    const fp = captureParityFingerprint(this.doc, this.registry);
    this.onTelemetry?.({
      v: 1,
      kind: 'parityFingerprint',
      t: performance.now(),
      generation: this.generation,
      sequence,
      ...fp,
    });
  }

  private reportApplyResult(info: {
    ok: boolean;
    sequence: number;
    opCount: number;
    applyMs: number;
    reason?: string;
  }): void {
    this.onTelemetry?.({
      v: 1,
      kind: 'applyResult',
      t: performance.now(),
      generation: this.generation,
      sequence: info.sequence,
      ok: info.ok,
      opCount: info.opCount,
      applyMs: info.applyMs,
      tableSize: this.registry.size,
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
      /** Overrides the `errorCode → phase` default — see `DomDesyncInfo.phase` (applyDom.ts). */
      phase?: TelemetryPhase;
    },
  ): void {
    this.onTelemetry?.({
      v: 1,
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
      // §4.1 CHECK / §2 preTableHash mismatch (`reason: 'precondition'`) — u64 rides as a decimal
      // string, `bigint` is not JSON-serializable.
      expected: extra?.expected?.toString(),
      actual: extra?.actual?.toString(),
    });
    this.armed = false;
    this.assembler.reset();
    this.applier.reset();
    this.onDesyncCb?.(reason);
  }
}
