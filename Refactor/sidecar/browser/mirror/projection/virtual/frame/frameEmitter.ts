/**
 * Orchestrator: clock → mutation buffer → builder → encoder → transport.
 */

import type { FrameBuilder } from './frameBuilder';
import type { FrameEncoder } from './frameEncoder';
import type { FrameClock } from '../clock/frameClock';
import type { FrameTransport } from '../transport/frameTransport';
import type { Frame } from '../../models/frame';
import type { MutationBuffer } from '../dom/mutationBuffer';
import type { DomNodeTable } from '../dom/domNodeTable';
import type { ProjectionTelemetry } from '../telemetry/projectionTelemetry';

export type FrameEmitterOptions = {
  clock: FrameClock;
  buffer: MutationBuffer;
  builder: FrameBuilder;
  encoder: FrameEncoder;
  transport: FrameTransport;
  domNodes: DomNodeTable;
  telemetry?: ProjectionTelemetry | null;
};

/**
 * Ticks between mutation-independent GC-sweep opportunities (`tableFrameBuilder.ts`'s
 * `emitNodeDropSweep`) when the mutation buffer is otherwise empty — a detached row becomes
 * GC-eligible purely by `sequence` age (§1.6), not by new activity, so an idle session must
 * still occasionally give the sweep a chance to run. Throttled (not every idle tick) because
 * `collectDroppableIds` is an O(table size) scan; the sweep's own age threshold is ~120
 * sequences (§models/limits.ts), so checking far more often than that buys nothing.
 */
const IDLE_SWEEP_INTERVAL_TICKS = 30;

export class FrameEmitter {
  private readonly clock: FrameClock;
  private readonly buffer: MutationBuffer;
  private readonly builder: FrameBuilder;
  private readonly encoder: FrameEncoder;
  private readonly transport: FrameTransport;
  private readonly domNodes: DomNodeTable;
  private readonly telemetry: ProjectionTelemetry | null;

  private sequence = 0;
  private idleTicks = 0;
  private pendingFrame: Frame | null = null;
  private pendingParts: Uint8Array[] | null = null;
  private pendingPartIndex = 0;
  private pendingRecords: MutationRecord[] | null = null;

  constructor(opts: FrameEmitterOptions) {
    this.clock = opts.clock;
    this.buffer = opts.buffer;
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

  /**
   * Sends a frame built outside the ordinary clock-driven path — bootstrap's `resyncVirtual`
   * (frame-protocol.md §5.1/§5.8), before `start()` has ever run. Retries a deferred transport
   * with a short async spin rather than `onBoundary`'s defer-until-next-tick, because there is no
   * clock ticking yet to drive that retry. Sets `this.sequence` on success so the first
   * clock-driven frame continues numbering from here, not from 0.
   */
  async sendInitial(frame: Frame): Promise<void> {
    const parts = this.encoder.encode(frame);
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

    this.telemetry?.recordFrameEmitted({
      generation: frame.generation,
      sequence: frame.sequence,
      opCount: frame.ops.length,
      partCount: parts.length,
      bytes: totalBytes,
      tableSize: this.domNodes.size,
      buildMs: 0,
      encodeMs: 0,
    });

    this.sequence = frame.sequence;
  }

  private onBoundary(): void {
    if (this.pendingParts !== null && this.pendingFrame !== null) {
      this.trySendPending();
      return;
    }

    const hasWork = this.buffer.hasWork();
    if (!hasWork) {
      this.idleTicks += 1;
      if (this.idleTicks < IDLE_SWEEP_INTERVAL_TICKS) return;
    }
    this.idleTicks = 0;

    const records = hasWork ? this.buffer.drain() : [];
    const nextSequence = this.sequence + 1;
    const frame = this.builder.build(records, {
      generation: this.domNodes.generation,
      sequence: nextSequence,
    });

    const unconsumed = this.builder.takeUnconsumedRecords?.();
    if (unconsumed && unconsumed.length > 0) this.buffer.reclaim(unconsumed);

    if (frame === null) return; // nothing publishable this tick — sequence not consumed

    const parts = this.encoder.encode(frame);
    if (parts.length === 0) return;

    this.pendingFrame = frame;
    this.pendingParts = parts;
    this.pendingPartIndex = 0;
    this.pendingRecords = null;
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

    const stats = this.builder.takeBuildStats?.() ?? null;
    this.telemetry?.recordFrameEmitted({
      generation: frame.generation,
      sequence: frame.sequence,
      opCount: frame.ops.length,
      partCount: parts.length,
      bytes: totalBytes,
      tableSize: this.domNodes.size,
      buildMs: stats?.buildMs ?? 0,
      encodeMs: 0,
    });

    this.sequence = frame.sequence;
    this.pendingFrame = null;
    this.pendingParts = null;
    this.pendingPartIndex = 0;
    this.pendingRecords = null;
  }
}
