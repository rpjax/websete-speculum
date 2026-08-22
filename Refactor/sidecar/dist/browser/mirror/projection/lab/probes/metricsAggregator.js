"use strict";
/**
 * Percentile/volume aggregation over one benchmark run's telemetry window.
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
/** Sequence `1` is always the cold-start `rebuildAndResync` frame (frame-protocol.md §5.1) — a
 * structurally different cost than a tick-driven `TableFrameBuilder` frame, so it is reported
 * separately rather than pulled into the same percentiles. */
class MetricsAggregator {
    frameEmitted = [];
    applyResults = [];
    cssomPolls = [];
    desyncCount = 0;
    applyOverrunCount = 0;
    transportDeferredCount = 0;
    wireBytesTotal = 0;
    perContext = new Map();
    countsFor(contextId) {
        let row = this.perContext.get(contextId);
        if (!row) {
            row = { applyOk: 0, applyFail: 0, desyncCount: 0, applyOverrunCount: 0, frameEmitted: 0 };
            this.perContext.set(contextId, row);
        }
        return row;
    }
    observeTelemetry(msg) {
        const ctx = this.countsFor(msg.contextId);
        switch (msg.kind) {
            case 'frameEmitted':
                this.frameEmitted.push(msg);
                ctx.frameEmitted += 1;
                return;
            case 'applyResult':
                this.applyResults.push(msg);
                if (msg.ok)
                    ctx.applyOk += 1;
                else
                    ctx.applyFail += 1;
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
        const lastPoll = this.cssomPolls.length > 0 ? this.cssomPolls[this.cssomPolls.length - 1] : null;
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
exports.MetricsAggregator = MetricsAggregator;
//# sourceMappingURL=metricsAggregator.js.map