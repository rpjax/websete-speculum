/**
 * Orchestrator: clock → accumulator → builder → encoder → transport.
 */

import type { FrameBuilder } from './frameBuilder';
import type { FrameEncoder } from './frameEncoder';
import type { FrameClock } from '../clock/frameClock';
import type { FrameTransport } from '../transport/frameTransport';
import type { Frame } from '../../models/frame';
import type { DomMutationAccumulator } from '../dom/domMutationAccumulator';
import type { DomNodeTable } from '../dom/domNodeTable';
import type { ProjectionTelemetry } from '../telemetry/projectionTelemetry';

export type FrameEmitterOptions = {
  clock: FrameClock;
  accumulator: DomMutationAccumulator;
  builder: FrameBuilder;
  encoder: FrameEncoder;
  transport: FrameTransport;
  domNodes: DomNodeTable;
  telemetry?: ProjectionTelemetry | null;
};

export class FrameEmitter {
  private readonly clock: FrameClock;
  private readonly accumulator: DomMutationAccumulator;
  private readonly builder: FrameBuilder;
  private readonly encoder: FrameEncoder;
  private readonly transport: FrameTransport;
  private readonly domNodes: DomNodeTable;
  private readonly telemetry: ProjectionTelemetry | null;

  private sequence = 0;
  private pendingFrame: Frame | null = null;
  private pendingParts: Uint8Array[] | null = null;
  private pendingPartIndex = 0;

  constructor(opts: FrameEmitterOptions) {
    this.clock = opts.clock;
    this.accumulator = opts.accumulator;
    this.builder = opts.builder;
    this.encoder = opts.encoder;
    this.transport = opts.transport;
    this.domNodes = opts.domNodes;
    this.telemetry = opts.telemetry ?? null;
  }

  start(): void {
    this.clock.start(() => this.onBoundary());
  }

  stop(): void {
    this.clock.stop();
  }

  get currentSequence(): number {
    return this.sequence;
  }

  /** After establish frame (typically sequence 0), live continues from here. */
  setCurrentSequence(sequence: number): void {
    this.sequence = sequence;
  }

  private onBoundary(): void {
    if (this.pendingParts !== null && this.pendingFrame !== null) {
      this.trySendPending();
      return;
    }

    if (!this.accumulator.hasActiveWork()) return;

    const frozen = this.accumulator.swap();
    const nextSequence = this.sequence + 1;
    const frame = this.builder.build(frozen, {
      generation: this.domNodes.generation,
      sequence: nextSequence,
    });

    if (frame === null) {
      this.accumulator.reclaimFrozen();
      return;
    }

    if (frame.ops.length === 0) {
      this.accumulator.clearFrozen();
      return;
    }

    const parts = this.encoder.encode(frame);
    if (parts.length === 0) {
      this.accumulator.reclaimFrozen();
      return;
    }

    this.pendingFrame = frame;
    this.pendingParts = parts;
    this.pendingPartIndex = 0;
    this.trySendPending();
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

    this.telemetry?.recordFrameEmitted({
      generation: frame.generation,
      sequence: frame.sequence,
      opCount: frame.ops.length,
      partCount: parts.length,
      bytes: totalBytes,
    });

    const buildStats = this.builder.takeBuildStats?.() ?? null;
    if (buildStats !== null) {
      this.telemetry?.recordBuilderStats({
        generation: frame.generation,
        sequence: frame.sequence,
        ephemeralPruned: buildStats.ephemeralPruned,
        absorbed: buildStats.absorbed,
        orphaned: buildStats.orphaned,
        opCounts: buildStats.opCounts,
      });
      this.telemetry?.recordFrameDecision({
        generation: frame.generation,
        sequence: frame.sequence,
        publishedCount: buildStats.publishedCount,
        lastChildListsParents: buildStats.lastChildListsParents,
        lastChildListsEmpty: buildStats.lastChildListsEmpty,
        dirtyIn: buildStats.dirtyIn,
        dirtyOut: buildStats.dirtyOut,
        ephemeralPruned: buildStats.ephemeralPruned,
        absorbed: buildStats.absorbed,
        orphaned: buildStats.orphaned,
        childLists: buildStats.childLists,
        childListsOmitted: buildStats.childListsOmitted,
        patches: buildStats.patches,
        scrolls: buildStats.scrolls,
        appendFromEmptyCount: buildStats.appendFromEmptyCount,
      });
    }

    this.telemetry?.recordEncoder({
      generation: frame.generation,
      sequence: frame.sequence,
      partCount: parts.length,
      bytes: totalBytes,
      maxFrameBytes: this.encoder.maxFrameBytes ?? 1 << 20,
    });

    this.sequence = frame.sequence;
    this.pendingFrame = null;
    this.pendingParts = null;
    this.pendingPartIndex = 0;
    this.accumulator.clearFrozen();
  }
}
