/**
 * Pipe: clock → DOM builder → encoder → transport.
 * Not the resync/snapshot algorithm — those live in `virtual/resync.ts` / `virtual/snapshot.ts`.
 * CSSOM CPU does not run here; {@link FrameEmitterOptions.takePendingCssom} attaches a finished
 * idle pass at the next tick (eventual, I5). A pending resync build blocking-scans CSSOM itself.
 */

import type { FrameBuilder } from './frameBuilder';
import type { FrameEncoder } from './frameEncoder';
import type { FrameClock } from '../clock/frameClock';
import type { FrameTransport } from '../transport/frameTransport';
import { OpCode } from '../../core/opcodes';
import { createFrame, spliceCssomBeforeCheck, type Frame, CONTEXT_ID_ROOT } from '../../core/frame';
import { stampCssomPoll } from '../../core/telemetry';
import type { MutationBuffer } from '../dom/mutationBuffer';
import type { ProjectionTelemetry } from '../telemetry/projectionTelemetry';
import type { CssomScanResult } from '../cssom/cssomPlane';
import type { ReplicatedTable } from '../../core/replicatedTable';
import { applyOpsToTable } from '../../core/replicatedTableApply';

export type FrameTableCensus = {
  generation: number;
  tableSize: number;
  identitySize: number;
};

export type FrameEmitterOptions = {
  clock: FrameClock;
  buffer: MutationBuffer;
  builder: FrameBuilder;
  encoder: FrameEncoder;
  transport: FrameTransport;
  census: () => FrameTableCensus;
  telemetry?: ProjectionTelemetry | null;
  /** Pull undelivered MutationObserver records into `buffer` before drain. */
  pullPendingMutations?: () => void;
  /**
   * CSSOM idle pass that finished since the last boundary — attach ops + telemetry
   * here so CSSOM never runs on the DOM drain tick.
   */
  takePendingCssom?: () => CssomScanResult | null;
  /** Producer table — CSSOM ops apply here so the next preTableHash matches the client. */
  table?: ReplicatedTable;
  /** Header `contextId` — this instance's mine. */
  contextId?: number;
};

const IDLE_SWEEP_INTERVAL_TICKS = 30;

export class FrameEmitter {
  private readonly clock: FrameClock;
  private readonly buffer: MutationBuffer;
  private readonly builder: FrameBuilder;
  private readonly encoder: FrameEncoder;
  private readonly transport: FrameTransport;
  private readonly census: () => FrameTableCensus;
  private readonly telemetry: ProjectionTelemetry | null;
  private readonly pullPendingMutations: (() => void) | null;
  private readonly takePendingCssom: (() => CssomScanResult | null) | null;
  private readonly table: ReplicatedTable | null;
  private readonly contextId: number;

  private sequence = 0;
  private idleTicks = 0;
  private pendingFrame: Frame | null = null;
  private pendingParts: Uint8Array[] | null = null;
  private pendingPartIndex = 0;
  private pendingRecords: MutationRecord[] | null = null;
  private pendingResyncBuild: ((nextSequence: number) => Frame) | null = null;
  /** Ops of the last frame that fully left the transport (PP-FR-1 probe). */
  private lastEmittedOps: Frame['ops'] = [];

  constructor(opts: FrameEmitterOptions) {
    this.clock = opts.clock;
    this.buffer = opts.buffer;
    this.builder = opts.builder;
    this.encoder = opts.encoder;
    this.transport = opts.transport;
    this.census = opts.census;
    this.telemetry = opts.telemetry ?? null;
    this.pullPendingMutations = opts.pullPendingMutations ?? null;
    this.takePendingCssom = opts.takePendingCssom ?? null;
    this.table = opts.table ?? null;
    this.contextId = opts.contextId ?? CONTEXT_ID_ROOT;
  }

  start(): void {
    this.clock.start(() => this.onBoundary());
  }

  stop(): void {
    this.clock.stop();
  }

  /**
   * Drain one boundary. Returns the ops of the frame emitted this call, or `[]` when idle
   * (no sequence advance) — so PP-FR-1 probes never inspect a prior tick's NODE_NEWs.
   */
  flushNow(): Frame['ops'] {
    const seq0 = this.sequence;
    this.onBoundary();
    if (this.sequence === seq0) return [];
    return this.lastEmittedOps;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  async sendInitial(frame: Frame): Promise<void> {
    const stamped = this.stamp(frame);
    const parts = this.encoder.encode(stamped);
    if (parts.length === 0) return;

    for (let i = 0; i < parts.length; i++) {
      const bytes = parts[i]!;
      let result = this.transport.send(bytes);
      let spins = 0;
      while (result === 'deferred' && spins < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        result = this.transport.send(bytes);
        spins += 1;
      }
    }

    let totalBytes = 0;
    for (let i = 0; i < parts.length; i++) totalBytes += parts[i]!.length;

    const snap = this.census();
    this.telemetry?.recordFrameEmitted({
      generation: frame.generation,
      sequence: frame.sequence,
      opCount: frame.ops.length,
      partCount: parts.length,
      bytes: totalBytes,
      tableSize: snap.tableSize,
      identitySize: snap.identitySize,
      buildMs: 0,
      encodeMs: 0,
    });

    this.lastEmittedOps = frame.ops;
    this.sequence = frame.sequence;
  }

  requestResync(build: (nextSequence: number) => Frame): void {
    this.pendingResyncBuild = build;
  }

  private onBoundary(): void {
    this.pullPendingMutations?.();

    if (this.pendingParts !== null && this.pendingFrame !== null) {
      this.trySendPending();
      return;
    }

    if (this.pendingResyncBuild !== null) {
      const build = this.pendingResyncBuild;
      this.pendingResyncBuild = null;
      this.idleTicks = 0;
      this.builder.takeBuildStats?.();
      const frame = this.stamp(build(this.sequence + 1));
      const parts = this.encoder.encode(frame);
      if (parts.length === 0) return;
      this.pendingFrame = frame;
      this.pendingParts = parts;
      this.pendingPartIndex = 0;
      this.pendingRecords = null;
      this.trySendPending();
      return;
    }

    const cssom = this.takePendingCssom?.() ?? null;
    const cssomOps = cssom?.ops ?? [];

    const hasDomWork = this.buffer.hasWork();
    if (!hasDomWork && cssomOps.length === 0) {
      this.idleTicks += 1;
      if (this.idleTicks < IDLE_SWEEP_INTERVAL_TICKS) {
        if (cssom !== null) {
          this.telemetry?.recordCssomPoll(stampCssomPoll(cssom.stats, { sequence: 0 }));
        }
        return;
      }
    }
    this.idleTicks = 0;

    const records = hasDomWork ? this.buffer.drain() : [];
    const nextSequence = this.sequence + 1;
    if (cssom !== null) {
      this.telemetry?.recordCssomPoll(stampCssomPoll(cssom.stats, { sequence: nextSequence }));
    }
    const snap = this.census();
    const preTableHash = this.table?.tableHash ?? 0n;
    const built = this.builder.build(records, {
      generation: snap.generation,
      sequence: nextSequence,
    });

    const unconsumed = this.builder.takeUnconsumedRecords?.();
    if (unconsumed && unconsumed.length > 0) this.buffer.reclaim(unconsumed);

    let ops = built?.ops ?? [];
    ops = spliceCssomBeforeCheck(ops, cssomOps);
    if (cssomOps.length > 0 && this.table !== null) {
      applyOpsToTable(this.table, cssomOps);
    }
    const last = ops[ops.length - 1];
    if (last !== undefined && last.op === OpCode.Check && this.table !== null) {
      last.hash = this.table.tableHash;
    }

    if (ops.length === 0) return;

    const frame = this.stamp(
      built === null
        ? createFrame({
            generation: snap.generation,
            sequence: nextSequence,
            ops,
            preTableHash,
            contextId: this.contextId,
          })
        : { ...built, ops },
    );

    const parts = this.encoder.encode(frame);
    if (parts.length === 0) return;

    this.pendingFrame = frame;
    this.pendingParts = parts;
    this.pendingPartIndex = 0;
    this.pendingRecords = null;
    this.trySendPending();
  }

  private stamp(frame: Frame): Frame {
    if (frame.contextId === this.contextId) return frame;
    return { ...frame, contextId: this.contextId };
  }

  private trySendPending(): void {
    const parts = this.pendingParts;
    const frame = this.pendingFrame;
    if (parts === null || frame === null) return;

    while (this.pendingPartIndex < parts.length) {
      const bytes = parts[this.pendingPartIndex]!;
      const result = this.transport.send(bytes);
      if (result === 'deferred') {
        this.telemetry?.recordTransportDeferred({
          generation: frame.generation,
          sequence: frame.sequence,
          pendingParts: parts.length - this.pendingPartIndex,
        });
        return;
      }
      this.pendingPartIndex += 1;
    }

    let totalBytes = 0;
    for (let i = 0; i < parts.length; i++) totalBytes += parts[i]!.length;

    const stats = this.builder.takeBuildStats?.() ?? null;
    const snap = this.census();
    this.telemetry?.recordFrameEmitted({
      generation: frame.generation,
      sequence: frame.sequence,
      opCount: frame.ops.length,
      partCount: parts.length,
      bytes: totalBytes,
      tableSize: stats?.tableSize ?? snap.tableSize,
      identitySize: stats?.identitySize ?? snap.identitySize,
      buildMs: stats?.buildMs ?? 0,
      encodeMs: 0,
    });

    this.lastEmittedOps = frame.ops;
    this.sequence = frame.sequence;
    this.pendingFrame = null;
    this.pendingParts = null;
    this.pendingPartIndex = 0;
    this.pendingRecords = null;
  }
}
