/**
 * Percentile/volume aggregation over one benchmark run's telemetry window.
 */

import type {
  ProjectionTelemetryMessage,
  TelemetryApplyResult,
  TelemetryCssomPoll,
  TelemetryFrameEmitted,
} from '@speculum/page-projection/core/telemetry';

export type Stats = { min: number; avg: number; p50: number; p95: number; max: number; count: number };

const EMPTY_STATS: Stats = { min: 0, avg: 0, p50: 0, p95: 0, max: 0, count: 0 };

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function computeStats(values: readonly number[]): Stats {
  if (values.length === 0) return EMPTY_STATS;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0]!,
    avg: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]!,
    count: sorted.length,
  };
}

export type BootstrapFrameInfo = { sequence: number; opCount: number; bytes: number; tableSize: number; buildMs: number };

export type ContextMetricsCounts = {
  applyOk: number;
  applyFail: number;
  desyncCount: number;
  applyOverrunCount: number;
  frameEmitted: number;
};

export type MetricsSummary = {
  wallMs: number;
  bootstrap: BootstrapFrameInfo | null;
  steadyFrameCount: number;
  steadyFps: number;
  buildMs: Stats;
  encodeMs: Stats;
  opCount: Stats;
  bytes: Stats;
  applyMs: Stats;
  /** Last `frameEmitted.tableSize` in the window (replicated rows). Time-series, not an assert. */
  lastTableSize: number;
  wireBytesTotal: number;
  applyOk: number;
  applyFail: number;
  desyncCount: number;
  applyOverrunCount: number;
  transportDeferredCount: number;
  /** Per-context event counts where the wire message carries contextId. */
  perContext: Record<number, ContextMetricsCounts>;
  cssomPoll: {
    /** Number of poll passes in the window (5 Hz × duration, if the cap is on). */
    passes: number;
    pollMs: Stats;
    identityWalkMs: Stats;
    cssTextSerializeMs: Stats;
    lastTopLevelRulesVisited: number;
    lastTopLevelRulesSerialized: number;
    lastReadableSheetCount: number;
    sheetsAbortedSum: number;
    slotsSkippedSum: number;
    lastOpCount: number;
    lastOpSheetNew: number;
    lastOpSheetDrop: number;
    lastOpSheetOrder: number;
    lastOpRuleNew: number;
    lastOpRuleDrop: number;
    lastOpRuleSet: number;
    idle: { passes: number; pollMs: Stats; cssTextSerializeMs: Stats };
    resync: { passes: number; pollMs: Stats; cssTextSerializeMs: Stats };
  };
};

/** Sequence `1` is always the cold-start `rebuildAndResync` frame (frame-protocol.md §5.1) — a
 * structurally different cost than a tick-driven `TableFrameBuilder` frame, so it is reported
 * separately rather than pulled into the same percentiles. */
export class MetricsAggregator {
  private readonly frameEmitted: TelemetryFrameEmitted[] = [];
  private readonly applyResults: TelemetryApplyResult[] = [];
  private readonly cssomPolls: TelemetryCssomPoll[] = [];
  private desyncCount = 0;
  private applyOverrunCount = 0;
  private transportDeferredCount = 0;
  private wireBytesTotal = 0;
  private readonly perContext = new Map<number, ContextMetricsCounts>();

  private countsFor(contextId: number): ContextMetricsCounts {
    let row = this.perContext.get(contextId);
    if (!row) {
      row = { applyOk: 0, applyFail: 0, desyncCount: 0, applyOverrunCount: 0, frameEmitted: 0 };
      this.perContext.set(contextId, row);
    }
    return row;
  }

  observeTelemetry(msg: ProjectionTelemetryMessage): void {
    const ctx = this.countsFor(msg.contextId);
    switch (msg.kind) {
      case 'frameEmitted':
        this.frameEmitted.push(msg);
        ctx.frameEmitted += 1;
        return;
      case 'applyResult':
        this.applyResults.push(msg);
        if (msg.ok) ctx.applyOk += 1;
        else ctx.applyFail += 1;
        return;
      case 'cssomPoll':
        this.cssomPolls.push(msg);
        return;
      case 'desynced':
        this.desyncCount += 1;
        ctx.desyncCount += 1;
        return;
      case 'applyOverrun':
        this.applyOverrunCount += 1;
        ctx.applyOverrunCount += 1;
        return;
      case 'transportDeferred':
        this.transportDeferredCount += 1;
        return;
      default:
        return;
    }
  }

  observeWireBytes(byteLength: number): void {
    this.wireBytesTotal += byteLength;
  }

  reset(): void {
    this.frameEmitted.length = 0;
    this.applyResults.length = 0;
    this.cssomPolls.length = 0;
    this.desyncCount = 0;
    this.applyOverrunCount = 0;
    this.transportDeferredCount = 0;
    this.wireBytesTotal = 0;
    this.perContext.clear();
  }

  getSummary(wallMs: number): MetricsSummary {
    const bootstrapFrame = this.frameEmitted.find((f) => f.sequence === 1) ?? null;
    const steady = this.frameEmitted.filter((f) => f.sequence !== 1);
    const applyMsValues = this.applyResults.filter((r) => r.ok).map((r) => r.applyMs);
    const applyOk = this.applyResults.filter((r) => r.ok).length;
    const applyFail = this.applyResults.length - applyOk;
    const lastTableSize = this.frameEmitted.length > 0 ? this.frameEmitted[this.frameEmitted.length - 1]!.tableSize : 0;

    const lastPoll = this.cssomPolls.length > 0 ? this.cssomPolls[this.cssomPolls.length - 1]! : null;
    const idlePolls = this.cssomPolls.filter((s) => s.source === 'idle');
    const resyncPolls = this.cssomPolls.filter((s) => s.source === 'resync');

    return {
      wallMs,
      bootstrap: bootstrapFrame
        ? {
            sequence: bootstrapFrame.sequence,
            opCount: bootstrapFrame.opCount,
            bytes: bootstrapFrame.bytes,
            tableSize: bootstrapFrame.tableSize,
            buildMs: bootstrapFrame.buildMs,
          }
        : null,
      steadyFrameCount: steady.length,
      steadyFps: wallMs > 0 ? steady.length / (wallMs / 1000) : 0,
      buildMs: computeStats(steady.map((f) => f.buildMs)),
      encodeMs: computeStats(steady.map((f) => f.encodeMs)),
      opCount: computeStats(steady.map((f) => f.opCount)),
      bytes: computeStats(steady.map((f) => f.bytes)),
      applyMs: computeStats(applyMsValues),
      lastTableSize,
      wireBytesTotal: this.wireBytesTotal,
      applyOk,
      applyFail,
      desyncCount: this.desyncCount,
      applyOverrunCount: this.applyOverrunCount,
      transportDeferredCount: this.transportDeferredCount,
      perContext: Object.fromEntries(this.perContext),
      cssomPoll: {
        passes: this.cssomPolls.length,
        pollMs: computeStats(this.cssomPolls.map((s) => s.pollMs)),
        identityWalkMs: computeStats(this.cssomPolls.map((s) => s.identityWalkMs)),
        cssTextSerializeMs: computeStats(this.cssomPolls.map((s) => s.cssTextSerializeMs)),
        lastTopLevelRulesVisited: lastPoll?.topLevelRulesVisited ?? 0,
        lastTopLevelRulesSerialized: lastPoll?.topLevelRulesSerialized ?? 0,
        lastReadableSheetCount: lastPoll?.readableSheetCount ?? 0,
        sheetsAbortedSum: this.cssomPolls.reduce((n, s) => n + s.sheetsAborted, 0),
        slotsSkippedSum: this.cssomPolls.reduce((n, s) => n + s.slotsSkipped, 0),
        lastOpCount: lastPoll?.opCount ?? 0,
        lastOpSheetNew: lastPoll?.opSheetNew ?? 0,
        lastOpSheetDrop: lastPoll?.opSheetDrop ?? 0,
        lastOpSheetOrder: lastPoll?.opSheetOrder ?? 0,
        lastOpRuleNew: lastPoll?.opRuleNew ?? 0,
        lastOpRuleDrop: lastPoll?.opRuleDrop ?? 0,
        lastOpRuleSet: lastPoll?.opRuleSet ?? 0,
        idle: {
          passes: idlePolls.length,
          pollMs: computeStats(idlePolls.map((s) => s.pollMs)),
          cssTextSerializeMs: computeStats(idlePolls.map((s) => s.cssTextSerializeMs)),
        },
        resync: {
          passes: resyncPolls.length,
          pollMs: computeStats(resyncPolls.map((s) => s.pollMs)),
          cssTextSerializeMs: computeStats(resyncPolls.map((s) => s.cssTextSerializeMs)),
        },
      },
    };
  }
}
