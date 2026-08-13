/**
 * Virtual-side projection telemetry — push-active on DataPlane Telemetry channel.
 */

import { PlaneChannel } from '../../plane';
import type { DataPlane } from '../../plane';
import type {
  ChildListDecisionFact,
  DirtyCard,
  ProjectionTelemetryConfig,
  ProjectionTelemetryMessage,
} from '../../models/telemetry';

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
  private partsAccepted = 0;
  private bytesAccepted = 0;
  private deferredCount = 0;
  private lastSequence = 0;
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

  recordEstablishStarted(generation: number): void {
    if (!this.config.enabled || !this.config.establish) return;
    this.push({
      v: 1,
      kind: 'establishStarted',
      t: this.now(),
      generation,
    });
  }

  recordEstablishCompleted(info: {
    generation: number;
    nodeCount: number;
    checksum: number;
    bytes: number;
    tableSize?: number;
  }): void {
    if (!this.config.enabled || !this.config.establish) return;
    this.push({
      v: 1,
      kind: 'establishCompleted',
      t: this.now(),
      generation: info.generation,
      nodeCount: info.nodeCount,
      checksum: info.checksum,
      bytes: info.bytes,
      tableSize: info.tableSize,
    });
  }

  recordEstablishFailed(generation: number, message: string): void {
    if (!this.config.enabled || !this.config.establish) return;
    this.push({
      v: 1,
      kind: 'establishFailed',
      t: this.now(),
      generation,
      message,
    });
  }

  recordHandoff(info: {
    generation: number;
    publishedCount: number;
    tableSize: number;
    lastChildListsSeeded: boolean;
    lastChildListsParents: number;
  }): void {
    if (!this.config.enabled || !this.config.handoff) return;
    this.push({
      v: 1,
      kind: 'handoff',
      t: this.now(),
      generation: info.generation,
      publishedCount: info.publishedCount,
      tableSize: info.tableSize,
      lastChildListsSeeded: info.lastChildListsSeeded,
      lastChildListsParents: info.lastChildListsParents,
    });
  }

  recordBuilderStats(info: {
    generation: number;
    sequence: number;
    ephemeralPruned: number;
    absorbed: number;
    orphaned: number;
    opCounts: Record<string, number>;
  }): void {
    if (!this.config.enabled || !this.config.builderStats) return;
    this.push({
      v: 1,
      kind: 'builderStats',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      ephemeralPruned: info.ephemeralPruned,
      absorbed: info.absorbed,
      orphaned: info.orphaned,
      opCounts: info.opCounts,
    });
  }

  recordFrameDecision(info: {
    generation: number;
    sequence: number;
    publishedCount: number;
    lastChildListsParents: number;
    lastChildListsEmpty: boolean;
    dirtyIn: DirtyCard;
    dirtyOut: DirtyCard;
    ephemeralPruned: number;
    absorbed: number;
    orphaned: number;
    childLists: ChildListDecisionFact[];
    childListsOmitted: number;
    patches: number;
    scrolls: number;
    appendFromEmptyCount: number;
  }): void {
    if (!this.config.enabled || !this.config.frameDecision) return;
    this.push({
      v: 1,
      kind: 'frameDecision',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      publishedCount: info.publishedCount,
      lastChildListsParents: info.lastChildListsParents,
      lastChildListsEmpty: info.lastChildListsEmpty,
      dirtyIn: info.dirtyIn,
      dirtyOut: info.dirtyOut,
      ephemeralPruned: info.ephemeralPruned,
      absorbed: info.absorbed,
      orphaned: info.orphaned,
      childLists: info.childLists,
      childListsOmitted: info.childListsOmitted,
      patches: info.patches,
      scrolls: info.scrolls,
      appendFromEmptyCount: info.appendFromEmptyCount,
    });
  }

  recordEncoder(info: {
    generation: number;
    sequence: number;
    partCount: number;
    bytes: number;
    maxFrameBytes: number;
  }): void {
    if (!this.config.enabled || !this.config.encoder) return;
    this.push({
      v: 1,
      kind: 'encoder',
      t: this.now(),
      generation: info.generation,
      sequence: info.sequence,
      partCount: info.partCount,
      bytes: info.bytes,
      maxFrameBytes: info.maxFrameBytes,
      split: info.partCount > 1,
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

  recordRateChanged(info: {
    fromHz: number;
    toHz: number;
    reason: 'hidden' | 'degrade' | 'recover' | 'config';
  }): void {
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

  recordFrameEmitted(info: {
    generation: number;
    sequence: number;
    opCount: number;
    partCount: number;
    bytes: number;
    establish?: boolean;
  }): void {
    if (!this.config.enabled) return;
    this.framesEmitted += 1;
    this.partsAccepted += info.partCount;
    this.bytesAccepted += info.bytes;
    this.lastSequence = info.sequence;
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
      establish: info.establish,
    });
  }

  recordTransportDeferred(info: {
    generation: number;
    sequence: number;
    pendingParts: number;
  }): void {
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

  private pushAggregate(): void {
    if (!this.config.enabled || !this.config.aggregate) return;
    this.push({
      v: 1,
      kind: 'aggregate',
      t: this.now(),
      framesEmitted: this.framesEmitted,
      partsAccepted: this.partsAccepted,
      bytesAccepted: this.bytesAccepted,
      deferredCount: this.deferredCount,
      lastSequence: this.lastSequence,
    });
  }

  private push(message: ProjectionTelemetryMessage): void {
    const plane = this.dataPlane;
    if (plane === null || !plane.isOpen) return;
    const bytes = this.textEncoder.encode(JSON.stringify(message));
    void plane.send(PlaneChannel.Telemetry, bytes);
  }
}
