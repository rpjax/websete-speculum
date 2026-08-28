/**
 * Virtual-side projection telemetry — push-active on DataPlane Telemetry channel.
 * Nested instances emit on the postMessage bus; root runtime fans out to the DataPlane.
 */

import { PlaneChannel } from '../../core/plane';
import type { DataPlane } from '../../core/plane';
import type { VirtualDomainBus } from '../bus/virtualDomainBus';
import {
  TELEMETRY_WIRE_VERSION,
  type ProjectionTelemetryConfig,
  type ProjectionTelemetryMessage,
  type TelemetryCssomPoll,
} from '../../core/telemetry';
import { bootDiagLog } from '../bootDiag';

export type EmissionStats = {
  contextId: number;
  samples: number;
  fps: { min: number; max: number; avg: number };
  buildMs: { min: number; max: number; avg: number };
};

export type ProjectionTelemetryOptions = {
  config: Readonly<ProjectionTelemetryConfig>;
  dataPlane: DataPlane | null;
  contextId: number;
  bus?: VirtualDomainBus | null;
  now?: () => number;
};

export class ProjectionTelemetry {
  private readonly config: Readonly<ProjectionTelemetryConfig>;
  private readonly dataPlane: DataPlane | null;
  private readonly bus: VirtualDomainBus | null;
  private readonly contextId: number;
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

  private lastEmitAt: number | null = null;
  private fpsSamples = 0;
  private fpsSum = 0;
  private fpsMin = Number.POSITIVE_INFINITY;
  private fpsMax = 0;
  private buildSamples = 0;
  private buildStatSum = 0;
  private buildMin = Number.POSITIVE_INFINITY;
  private buildMax = 0;

  constructor(opts: ProjectionTelemetryOptions) {
    this.config = opts.config;
    this.dataPlane = opts.dataPlane;
    this.bus = opts.bus ?? null;
    this.contextId = opts.contextId;
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
    identitySize?: number;
    buildMs: number;
    encodeMs: number;
    resync?: boolean;
    emitPath?: string;
  }): void {
    bootDiagLog('frame_emitted', {
      contextId: this.contextId,
      generation: info.generation,
      sequence: info.sequence,
      opCount: info.opCount,
      partCount: info.partCount,
      bytes: info.bytes,
      tableSize: info.tableSize,
      identitySize: info.identitySize ?? null,
      resync: info.resync === true,
      emitPath: info.emitPath ?? null,
      framesEmittedBefore: this.framesEmitted,
      telemetryEnabled: this.config.enabled,
    });
    if (!this.config.enabled) return;
    this.framesEmitted += 1;
    this.opsEmitted += info.opCount;
    this.partsAccepted += info.partCount;
    this.bytesAccepted += info.bytes;
    this.lastSequence = info.sequence;
    this.buildMsSum += info.buildMs;
    this.encodeMsSum += info.encodeMs;
    this.noteEmission(info.buildMs);
    if (!this.config.frameEmitted) return;
    this.push({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'frameEmitted',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      opCount: info.opCount,
      partCount: info.partCount,
      bytes: info.bytes,
      tableSize: info.tableSize,
      identitySize: info.identitySize,
      buildMs: info.buildMs,
      encodeMs: info.encodeMs,
    });
  }

  recordTransportDeferred(info: { generation: number; sequence: number; pendingParts: number }): void {
    if (!this.config.enabled) return;
    this.deferredCount += 1;
    if (!this.config.transportDeferred) return;
    this.push({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
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
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'clockStalled',
      t: this.now(),
      sinceLastTickMs: info.sinceLastTickMs,
      rateHz: info.rateHz,
    });
  }

  recordRateChanged(info: { fromHz: number; toHz: number; reason: 'hidden' | 'degrade' | 'recover' | 'config' }): void {
    if (!this.config.enabled || !this.config.clock) return;
    this.push({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'rateChanged',
      t: this.now(),
      fromHz: info.fromHz,
      toHz: info.toHz,
      reason: info.reason,
    });
  }

  recordCssomPoll(info: Omit<TelemetryCssomPoll, 'v' | 'kind' | 't' | 'contextId'>): void {
    if (!this.config.enabled || !this.config.cssomPoll) return;
    this.push({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
      kind: 'cssomPoll',
      t: this.now(),
      ...info,
    });
  }

  /** Running min/max/avg of emit FPS and table buildMs — fixture HUD / investigation. */
  emissionStats(): EmissionStats | null {
    if (this.fpsSamples === 0 && this.buildSamples === 0) return null;
    return {
      contextId: this.contextId,
      samples: Math.max(this.fpsSamples, this.buildSamples),
      fps:
        this.fpsSamples === 0
          ? { min: 0, max: 0, avg: 0 }
          : { min: this.fpsMin, max: this.fpsMax, avg: this.fpsSum / this.fpsSamples },
      buildMs:
        this.buildSamples === 0
          ? { min: 0, max: 0, avg: 0 }
          : { min: this.buildMin, max: this.buildMax, avg: this.buildStatSum / this.buildSamples },
    };
  }

  private noteEmission(buildMs: number): void {
    const t = this.now();
    if (this.lastEmitAt !== null) {
      const dt = t - this.lastEmitAt;
      if (dt > 0) {
        const fps = 1000 / dt;
        this.fpsSamples += 1;
        this.fpsSum += fps;
        if (fps < this.fpsMin) this.fpsMin = fps;
        if (fps > this.fpsMax) this.fpsMax = fps;
      }
    }
    this.lastEmitAt = t;
    if (buildMs > 0) {
      this.buildSamples += 1;
      this.buildStatSum += buildMs;
      if (buildMs < this.buildMin) this.buildMin = buildMs;
      if (buildMs > this.buildMax) this.buildMax = buildMs;
    }
  }

  private pushAggregate(): void {
    if (!this.config.enabled || !this.config.aggregate) return;
    this.push({
      v: TELEMETRY_WIRE_VERSION,
      contextId: this.contextId,
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
    if (plane !== null && plane.isOpen) {
      const bytes = this.textEncoder.encode(JSON.stringify(message));
      void plane.send(PlaneChannel.Telemetry, bytes);
      return;
    }
    this.bus?.emitTelemetry(message);
  }
}
