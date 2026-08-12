"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetPriorityQueue = void 0;
class AssetPriorityQueue {
    viewportMarginPx;
    jobs = new Map();
    constructor(viewportMarginPx) {
        this.viewportMarginPx = viewportMarginPx;
    }
    get size() {
        return this.jobs.size;
    }
    enqueue(job) {
        const existing = this.jobs.get(job.key);
        if (!existing || score(job, this.viewportMarginPx) > score(existing, this.viewportMarginPx)) {
            this.jobs.set(job.key, job);
        }
    }
    /** Pop the highest-priority job, or undefined when empty. */
    takeNext() {
        let best;
        let bestScore = -Infinity;
        for (const job of this.jobs.values()) {
            const s = score(job, this.viewportMarginPx);
            if (s > bestScore) {
                bestScore = s;
                best = job;
            }
        }
        if (!best)
            return undefined;
        this.jobs.delete(best.key);
        return best;
    }
    clear() {
        this.jobs.clear();
    }
}
exports.AssetPriorityQueue = AssetPriorityQueue;
function score(job, marginPx) {
    // CSS always ahead of images; then in-viewport (± margin); then by proximity.
    if (job.isCss)
        return 2_000_000 - Math.min(job.distancePx, 1_000_000);
    const inBand = job.distancePx <= marginPx ? 1_000_000 : 0;
    return inBand - job.distancePx;
}
//# sourceMappingURL=assetPriority.js.map