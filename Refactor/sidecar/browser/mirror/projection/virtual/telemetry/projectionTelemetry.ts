/**
 * Virtual-side projection telemetry — push-active on DataPlane Telemetry channel.
 * Producer-only message kinds (frameEmitted / transportDeferred / aggregate / clock);
 * `applyResult` / `desynced` / `applyOverrun` are client-emitted and relayed by the lab
 * session, not created here (models/telemetry.ts).
 */

import { PlaneChannel } from '../../plane';
import type { DataPlane } from '../../plane';
import type { ProjectionTelemetryConfig, ProjectionTelemetryMessage } from '../../models/telemetry';

export type ProjectionTelemetryOptions = {
  config: Readonly<ProjectionTelemetryConfig>;
  dataPlane: DataPlane | null;
  now?: () => number;
};

export class ProjectionTelemetry {
  private readonly config: Readonly<ProjectionTelemetryConfig>;
  private readonly dataPlane: DataPlane | null;
  private readonly now: () => number;
  private readonly textEncoder = new TextEncoder();

  private framesEmitted = 0;
  private opsEmitted = 0;
  private partsAccepted = 0;
  private bytesAccepted = 0;
  private deferredCount = 0;
  private lastSequence = 0;
  private buildMsSum = 0;
  private encodeMsSum = 0;
  private aggregateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ProjectionTelemetryOptions) {
    this.config = opts.config;
    this.dataPlane = opts.dataPlane;
    this.now = opts.now ?? (() => performance.now());
  }

  start(): void {
    if (!this.config.enabled || !this.config.aggregate) return;
    if (this.aggregateTimer !== null) return;
    this.aggregateTimer = setInterval(() => this.pushAggregate(), this.config.aggregateIntervalMs);
  }

  stop(): void {
    if (this.aggregateTimer !== null) {
      clearInterval(this.aggregateTimer);
      this.aggregateTimer = null;
    }
  }

  recordFrameEmitted(info: {
    generation: number;
    sequence: number;
    opCount: number;
    partCount: number;
    bytes: number;
    tableSize: number;
    buildMs: number;
    encodeMs: number;
  }): void {
    if (!this.config.enabled) return;
    this.framesEmitted += 1;
    this.opsEmitted += info.opCount;
    this.partsAccepted += info.partCount;
    this.bytesAccepted += info.bytes;
    this.lastSequence = info.sequence;
    this.buildMsSum += info.buildMs;
    this.encodeMsSum += info.encodeMs;
    if (!this.config.frameEmitted) return;
    this.push({
      v: 1,
      kind: 'frameEmitted',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      opCount: info.opCount,
      partCount: info.partCount,
      bytes: info.bytes,
      tableSize: info.tableSize,
      buildMs: info.buildMs,
      encodeMs: info.encodeMs,
    });
  }

  recordTransportDeferred(info: { generation: number; sequence: number; pendingParts: number }): void {
    if (!this.config.enabled) return;
    this.deferredCount += 1;
    if (!this.config.transportDeferred) return;
    this.push({
      v: 1,
      kind: 'transportDeferred',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      pendingParts: info.pendingParts,
    });
  }

  recordClockStalled(info: { sinceLastTickMs: number; rateHz: number }): void {
    if (!this.config.enabled || !this.config.clock) return;
    this.push({
      v: 1,
      kind: 'clockStalled',
      t: this.now(),
      sinceLastTickMs: info.sinceLastTickMs,
      rateHz: info.rateHz,
    });
  }

  recordRateChanged(info: { fromHz: number; toHz: number; reason: 'hidden' | 'degrade' | 'recover' | 'config' }): void {
    if (!this.config.enabled || !this.config.clock) return;
    this.push({
      v: 1,
      kind: 'rateChanged',
      t: this.now(),
      fromHz: info.fromHz,
      toHz: info.toHz,
      reason: info.reason,
    });
  }

  private pushAggregate(): void {
    if (!this.config.enabled || !this.config.aggregate) return;
    this.push({
      v: 1,
      kind: 'aggregate',
      t: this.now(),
      framesEmitted: this.framesEmitted,
      opsEmitted: this.opsEmitted,
      partsAccepted: this.partsAccepted,
      bytesAccepted: this.bytesAccepted,
      deferredCount: this.deferredCount,
      lastSequence: this.lastSequence,
      avgBuildMs: this.framesEmitted > 0 ? this.buildMsSum / this.framesEmitted : 0,
      avgEncodeMs: this.framesEmitted > 0 ? this.encodeMsSum / this.framesEmitted : 0,
    });
  }

  private push(message: ProjectionTelemetryMessage): void {
    const plane = this.dataPlane;
    if (plane === null || !plane.isOpen) return;
    const bytes = this.textEncoder.encode(JSON.stringify(message));
    void plane.send(PlaneChannel.Telemetry, bytes);
  }
}
