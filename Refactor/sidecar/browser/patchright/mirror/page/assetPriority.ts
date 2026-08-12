/**
 * §5.12.1 — L1 asset fetch priority: CSS / in-viewport (± margin) before below-fold.
 * Higher priority number = sooner. Never silent — callers must drain and report misses.
 */
export type AssetFetchJob = {
  key: string;
  sourceUrl: string;
  /** Distance from viewport center in CSS px (0 = in view). */
  distancePx: number;
  /** True when the resource is stylesheet / critical CSS. */
  isCss: boolean;
};

export class AssetPriorityQueue {
  private readonly jobs = new Map<string, AssetFetchJob>();

  constructor(private readonly viewportMarginPx: number) {}

  get size(): number {
    return this.jobs.size;
  }

  enqueue(job: AssetFetchJob): void {
    const existing = this.jobs.get(job.key);
    if (!existing || score(job, this.viewportMarginPx) > score(existing, this.viewportMarginPx)) {
      this.jobs.set(job.key, job);
    }
  }

  /** Pop the highest-priority job, or undefined when empty. */
  takeNext(): AssetFetchJob | undefined {
    let best: AssetFetchJob | undefined;
    let bestScore = -Infinity;
    for (const job of this.jobs.values()) {
      const s = score(job, this.viewportMarginPx);
      if (s > bestScore) {
        bestScore = s;
        best = job;
      }
    }
    if (!best) return undefined;
    this.jobs.delete(best.key);
    return best;
  }

  clear(): void {
    this.jobs.clear();
  }
}

function score(job: AssetFetchJob, marginPx: number): number {
  // CSS always ahead of images; then in-viewport (± margin); then by proximity.
  if (job.isCss) return 2_000_000 - Math.min(job.distancePx, 1_000_000);
  const inBand = job.distancePx <= marginPx ? 1_000_000 : 0;
  return inBand - job.distancePx;
}
