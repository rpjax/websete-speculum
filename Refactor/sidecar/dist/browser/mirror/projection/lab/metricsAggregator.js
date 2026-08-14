"use strict";
/**
 * Percentile/volume aggregation over one benchmark run's telemetry window — extracts the
 * stats math already written ad-hoc in scripts/perf-projection-lab.js (this session's
 * eneba.com/belezanaweb.com.br runs) into a shared, reusable module instead of a fourth copy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsAggregator = void 0;
exports.percentile = percentile;
exports.computeStats = computeStats;
const EMPTY_STATS = { min: 0, avg: 0, p50: 0, p95: 0, max: 0, count: 0 };
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
}
function computeStats(values) {
    if (values.length === 0)
        return EMPTY_STATS;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        min: sorted[0],
        avg: sum / sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1],
        count: sorted.length,
    };
}
/** Sequence `1` is always the cold-start `resyncVirtual` frame (frame-protocol.md §5.1) — a
 * structurally different cost than a tick-driven `TableFrameBuilder` frame, so it is reported
 * separately rather than pulled into the same percentiles (same split as the ad-hoc script). */
class MetricsAggregator {
    frameEmitted = [];
    applyResults = [];
    desyncCount = 0;
    applyOverrunCount = 0;
    transportDeferredCount = 0;
    wireBytesTotal = 0;
    observeTelemetry(msg) {
        switch (msg.kind) {
            case 'frameEmitted':
                this.frameEmitted.push(msg);
                return;
            case 'applyResult':
                this.applyResults.push(msg);
                return;
            case 'desynced':
                this.desyncCount += 1;
                return;
            case 'applyOverrun':
                this.applyOverrunCount += 1;
                return;
            case 'transportDeferred':
                this.transportDeferredCount += 1;
                return;
            default:
                return;
        }
    }
    observeWireBytes(byteLength) {
        this.wireBytesTotal += byteLength;
    }
    getSummary(wallMs) {
        const bootstrapFrame = this.frameEmitted.find((f) => f.sequence === 1) ?? null;
        const steady = this.frameEmitted.filter((f) => f.sequence !== 1);
        const applyMsValues = this.applyResults.filter((r) => r.ok).map((r) => r.applyMs);
        const applyOk = this.applyResults.filter((r) => r.ok).length;
        const applyFail = this.applyResults.length - applyOk;
        const lastTableSize = this.frameEmitted.length > 0 ? this.frameEmitted[this.frameEmitted.length - 1].tableSize : 0;
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
        };
    }
}
exports.MetricsAggregator = MetricsAggregator;
//# sourceMappingURL=metricsAggregator.js.map