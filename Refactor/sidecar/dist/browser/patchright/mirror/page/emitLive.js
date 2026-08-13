"use strict";
/**
 * Live emit / scheduler helpers — §5.5 binary parts, frame aggregate, PageEpoch
 * virtual telemetry (§5.15.6), and client-state rate policy thresholds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD = exports.WIRE_VERSION = void 0;
exports.emitPageProjectionParts = emitPageProjectionParts;
exports.emitFrameAggregateParity = emitFrameAggregateParity;
exports.buildLiveEngineEvents = buildLiveEngineEvents;
exports.buildLiveScheduler = buildLiveScheduler;
exports.runLiveSchedulerTick = runLiveSchedulerTick;
exports.detachVirtualTelemetry = detachVirtualTelemetry;
exports.mintLivePageEpoch = mintLivePageEpoch;
exports.attachVirtualTelemetry = attachVirtualTelemetry;
exports.applyClientStateReport = applyClientStateReport;
exports.absorbDirtyFromTick = absorbDirtyFromTick;
const node_crypto_1 = require("node:crypto");
exports.WIRE_VERSION = 1;
/**
 * §5.3.5.1 sensible default — a client backlog beyond a couple of frames' worth
 * signals the client can't keep up even before an apply overrun lands; treated
 * the same as a reported overrun. `WP14` density calibration is expected to revise.
 */
exports.CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD = 4;
function emitPageProjectionParts(opts) {
    const { parts, meta, frameStats, onPageProjectionDiff } = opts;
    const partCount = parts.length;
    const flags = (meta.establish ? 0b01 : 0) | (meta.resync ? 0b10 : 0);
    const timestampMs = Date.now();
    frameStats.framesEmitted += 1;
    for (const body of parts)
        frameStats.bytesEmitted += body.byteLength;
    parts.forEach((body, partIndex) => {
        onPageProjectionDiff({
            sequence: meta.sequence,
            generation: meta.generation,
            plane: '',
            operation: '',
            timestampMs,
            body,
            partIndex,
            partCount,
            flags,
            version: exports.WIRE_VERSION,
        });
    });
}
function emitFrameAggregateParity(opts) {
    opts.onParity?.('parity_frame_aggregate', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        framesEmitted: opts.frameStats.framesEmitted,
        bytesEmitted: opts.frameStats.bytesEmitted,
        rateHz: opts.rateHz,
        stallCount: opts.frameStats.stallCount,
        applyOverrunReports: opts.frameStats.applyOverrunReports,
        mirrorBytes: opts.mirrorBytes,
        intervalMs: opts.aggregateIntervalMs,
        tVirtualMs: opts.tVirtualMs,
    });
}
function buildLiveEngineEvents(opts) {
    return {
        onFrame: (parts, meta) => opts.emitParts(parts, meta),
        onGenerationBumped: (event) => opts.onGenerationBumped?.({ ...event, reason: 'main_frame_navigated' }),
        onClockStalled: (info) => {
            opts.frameStats.stallCount += 1;
            opts.onParity?.('parity_frame_clock_stalled', {
                pageEpochId: opts.getPageEpochId(),
                sinceLastTickMs: info.sinceLastTickMs,
                generation: opts.getGeneration(),
            });
        },
        onRateChanged: (hz) => {
            const fromHz = opts.frameStats.lastRateHz;
            opts.frameStats.lastRateHz = hz;
            opts.onParity?.('parity_frame_rate_changed', {
                pageEpochId: opts.getPageEpochId(),
                fromHz,
                toHz: hz,
                generation: opts.getGeneration(),
            });
        },
    };
}
function buildLiveScheduler(opts) {
    return {
        setInterval: (callback, ms) => setInterval(() => void opts.onSchedulerTick(callback), Math.max(1, ms)),
        clearInterval: (handle) => clearInterval(handle),
        now: () => Date.now(),
    };
}
/** One clock tick: poll the page for a fresh snapshot only when something is dirty, then flush. */
async function runLiveSchedulerTick(opts) {
    if (opts.state.stopped || opts.state.busy)
        return;
    if (opts.state.hasPending && opts.state.established) {
        opts.setBusy(true);
        try {
            await opts.pollAndIngest();
        }
        catch {
            /* mid-navigation — next tick retries against the fresh document. */
        }
        finally {
            opts.setBusy(false);
        }
    }
    if (!opts.state.stopped)
        opts.tick();
}
function detachVirtualTelemetry(detachers) {
    for (const d of detachers.splice(0)) {
        try {
            d();
        }
        catch {
            /* page closed */
        }
    }
}
/** §5.15.6 — mint a pageEpochId per Document; soft-nav mints a new epoch without generation bump. */
function mintLivePageEpoch(opts) {
    opts.detachVirtualTelemetry();
    const pageEpochId = (0, node_crypto_1.randomUUID)();
    const pageEpochCommitAtMs = Date.now();
    opts.onParity?.('parity_virtual_nav_commit', {
        pageEpochId,
        soft: opts.soft,
        navigationType: opts.soft ? 'soft' : 'hard',
        documentEpoch: opts.documentEpoch,
        generation: opts.generation,
        url: (() => {
            try {
                return opts.page.url();
            }
            catch {
                return undefined;
            }
        })(),
        tVirtualMs: Date.now() - opts.tVirtualStartMs,
    });
    opts.attachVirtualTelemetry();
    return { pageEpochId, pageEpochCommitAtMs };
}
function attachVirtualTelemetry(opts) {
    if (opts.stopped() || !opts.pageEpochId)
        return;
    const epochId = opts.pageEpochId;
    const commitAt = opts.pageEpochCommitAtMs;
    const tVirtualMs = () => Date.now() - opts.tVirtualStartMs;
    const emitLifecycle = (name) => {
        opts.onParity?.('parity_virtual_lifecycle', {
            pageEpochId: epochId,
            name,
            tSinceCommitMs: Date.now() - commitAt,
            tVirtualMs: tVirtualMs(),
        });
    };
    const onDomContentLoaded = () => emitLifecycle('domcontentloaded');
    const onLoad = () => emitLifecycle('load');
    opts.page.on('domcontentloaded', onDomContentLoaded);
    opts.page.on('load', onLoad);
    opts.pushDetacher(() => opts.page.off('domcontentloaded', onDomContentLoaded));
    opts.pushDetacher(() => opts.page.off('load', onLoad));
    const onConsole = (msg) => {
        if (msg.type() !== 'error')
            return;
        opts.onParity?.('parity_virtual_page_error', {
            pageEpochId: epochId,
            source: 'console',
            message: msg.text().slice(0, 500),
            tVirtualMs: tVirtualMs(),
        });
    };
    const onPageError = (err) => {
        opts.onParity?.('parity_virtual_page_error', {
            pageEpochId: epochId,
            source: 'pageerror',
            message: (err.message || String(err)).slice(0, 500),
            tVirtualMs: tVirtualMs(),
        });
    };
    opts.page.on('console', onConsole);
    opts.page.on('pageerror', onPageError);
    opts.pushDetacher(() => opts.page.off('console', onConsole));
    opts.pushDetacher(() => opts.page.off('pageerror', onPageError));
    void opts.page.evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      const rel = (end, start) => (typeof end === 'number' && typeof start === 'number' && end >= start ? Math.round(end - start) : null);
      return {
        redirectMs: rel(nav.redirectEnd, nav.redirectStart),
        dnsMs: rel(nav.domainLookupEnd, nav.domainLookupStart),
        connectMs: rel(nav.connectEnd, nav.connectStart),
        ttfbMs: rel(nav.responseStart, nav.requestStart),
        domInteractiveMs: rel(nav.domInteractive, nav.startTime),
        domContentLoadedMs: rel(nav.domContentLoadedEventEnd, nav.startTime),
        loadEventMs: rel(nav.loadEventEnd, nav.startTime),
      };
    })()`).then((timing) => {
        if (!timing || opts.stopped() || opts.getPageEpochId() !== epochId)
            return;
        opts.onParity?.('parity_virtual_nav_timing', {
            pageEpochId: epochId,
            ...timing,
            tVirtualMs: tVirtualMs(),
        });
    }).catch(() => { });
}
/**
 * §5.9.5 client → server control report helpers for visibility / overrun / backlog.
 */
function applyClientStateReport(opts) {
    opts.setHidden(opts.visibility === 'hidden');
    if (opts.visibility === 'hidden')
        return;
    if (opts.overrunCount > 0 || opts.queuedFrames > exports.CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD) {
        if (opts.overrunCount > 0) {
            opts.frameStats.applyOverrunReports += opts.overrunCount;
            opts.onParity?.('parity_frame_apply_overrun', {
                pageEpochId: opts.pageEpochId,
                overrunCount: opts.overrunCount,
                queuedFrames: opts.queuedFrames,
                generation: opts.generation,
            });
        }
        opts.degradeRate();
    }
    else {
        opts.tryRecoverRate();
    }
}
/** Merge an in-page tick's dirty sets into the pending DirtyState; returns whether any id was marked. */
function absorbDirtyFromTick(pending, dirty) {
    if (!dirty)
        return false;
    let any = false;
    for (const id of dirty.newIds ?? []) {
        pending.newIds.add(id);
        any = true;
    }
    for (const id of dirty.dirtyParents ?? []) {
        pending.dirtyParents.add(id);
        any = true;
    }
    for (const id of dirty.attrDirty ?? []) {
        pending.attrDirty.add(id);
        any = true;
    }
    for (const id of dirty.textDirty ?? []) {
        pending.textDirty.add(id);
        any = true;
    }
    for (const id of dirty.stateDirty ?? []) {
        pending.stateDirty.add(id);
        any = true;
    }
    for (const id of dirty.detached ?? []) {
        pending.detached.add(id);
        any = true;
    }
    for (const [id, x, y] of dirty.scrollDirty ?? []) {
        pending.scrollDirty.set(id, { x, y });
        any = true;
    }
    return any;
}
//# sourceMappingURL=emitLive.js.map