/**
 * Projected capture counters — lab Stop folds these into probes/input-pipeline.json.
 * Cheap: no per-mousemove disk; rolling latency samples only.
 */

export type InputLatencyStats = {
  count: number;
  min: number;
  avg: number;
  p95: number;
  max: number;
};

export type ProjectedInputCaptureMetricsSnapshot = {
  emitted: number;
  emittedByType: Record<string, number>;
  moveCoalesced: number;
  scrollCoalesced: number;
  skippedDisarmed: number;
  skippedNoCoords: number;
  skippedNoNodeId: number;
  /** Guard touchstart (capture) — separates "touch reaches doc" vs "pointerdown missing" on iOS. */
  touchstartSeen: number;
  /** Wall interval between successive emits (detect stalls / floods). */
  emitIntervalMs: InputLatencyStats;
  lastEmitWallMs: number | null;
};

const SAMPLE_CAP = 256;

function emptyStats(): InputLatencyStats {
  return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
}

function latencyStats(samples: readonly number[]): InputLatencyStats {
  if (samples.length === 0) return emptyStats();
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return {
    count: sorted.length,
    min: sorted[0]!,
    avg: sum / sorted.length,
    p95: sorted[p95Idx]!,
    max: sorted[sorted.length - 1]!,
  };
}

export class ProjectedInputCaptureMetrics {
  private emitted = 0;
  private readonly emittedByType: Record<string, number> = {};
  private moveCoalesced = 0;
  private scrollCoalesced = 0;
  private skippedDisarmed = 0;
  private skippedNoCoords = 0;
  private skippedNoNodeId = 0;
  private touchstartSeen = 0;
  private lastEmitWallMs: number | null = null;
  private readonly intervalSamples: number[] = [];

  noteEmit(type: string): void {
    this.emitted += 1;
    const key = type || 'unknown';
    this.emittedByType[key] = (this.emittedByType[key] ?? 0) + 1;
    const now = Date.now();
    if (this.lastEmitWallMs != null) {
      const gap = now - this.lastEmitWallMs;
      if (Number.isFinite(gap) && gap >= 0) {
        this.intervalSamples.push(gap);
        if (this.intervalSamples.length > SAMPLE_CAP) this.intervalSamples.shift();
      }
    }
    this.lastEmitWallMs = now;
  }

  noteMoveCoalesce(): void {
    this.moveCoalesced += 1;
  }

  noteScrollCoalesce(): void {
    this.scrollCoalesced += 1;
  }

  noteSkip(reason: 'disarmed' | 'no_coords' | 'no_node'): void {
    if (reason === 'disarmed') this.skippedDisarmed += 1;
    else if (reason === 'no_coords') this.skippedNoCoords += 1;
    else this.skippedNoNodeId += 1;
  }

  noteTouchStartSeen(): void {
    this.touchstartSeen += 1;
  }

  snapshot(): ProjectedInputCaptureMetricsSnapshot {
    return {
      emitted: this.emitted,
      emittedByType: { ...this.emittedByType },
      moveCoalesced: this.moveCoalesced,
      scrollCoalesced: this.scrollCoalesced,
      skippedDisarmed: this.skippedDisarmed,
      skippedNoCoords: this.skippedNoCoords,
      skippedNoNodeId: this.skippedNoNodeId,
      touchstartSeen: this.touchstartSeen,
      emitIntervalMs: latencyStats(this.intervalSamples),
      lastEmitWallMs: this.lastEmitWallMs,
    };
  }
}
