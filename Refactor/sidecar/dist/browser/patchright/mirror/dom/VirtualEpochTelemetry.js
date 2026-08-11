"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualEpochTelemetry = void 0;
const parityUtil_1 = require("./parityUtil");
const RESOURCE_SUMMARY_TOP_SLOW = 20;
const PAGE_ERROR_FLUSH_MS = 1500;
const NAV_TIMING_SCRIPT = `(() => {
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
})()`;
const RESOURCE_SUMMARY_SCRIPT = `(() => {
  const entries = performance.getEntriesByType('resource');
  const byType = new Map();
  const items = [];
  for (const e of entries) {
    const type = e.initiatorType || 'other';
    const bytes = e.transferSize || 0;
    const duration = Math.round(e.duration || 0);
    let agg = byType.get(type);
    if (!agg) { agg = { type, count: 0, bytes: 0, durationMs: 0 }; byType.set(type, agg); }
    agg.count += 1;
    agg.bytes += bytes;
    agg.durationMs += duration;
    items.push({ url: e.name, durationMs: duration, bytes });
  }
  items.sort((a, b) => b.durationMs - a.durationMs);
  return { byType: [...byType.values()], topSlow: items.slice(0, ${RESOURCE_SUMMARY_TOP_SLOW}) };
})()`;
/**
 * Attaches Virtual-phase parity telemetry (NavTiming / ResourceSummary / PageError /
 * Lifecycle) to a page for the lifetime of one PageEpoch. Detached and replaced on the
 * next NavCommit — never spans across a document swap.
 */
class VirtualEpochTelemetry {
    page;
    pageEpochId;
    commitAtMs;
    emit;
    tVirtualMs;
    stopped = false;
    detachers = [];
    pageErrors = new Map();
    flushTimer = null;
    constructor(page, pageEpochId, commitAtMs, emit, tVirtualMs) {
        this.page = page;
        this.pageEpochId = pageEpochId;
        this.commitAtMs = commitAtMs;
        this.emit = emit;
        this.tVirtualMs = tVirtualMs;
    }
    start() {
        this.attachLifecycle();
        this.attachErrors();
        void this.sampleNavTiming();
        void this.sampleResourceSummary();
    }
    stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flushErrors();
        for (const detach of this.detachers.splice(0)) {
            try {
                detach();
            }
            catch {
                /* page already closed */
            }
        }
    }
    tSinceCommitMs() {
        return Date.now() - this.commitAtMs;
    }
    emitLifecycle(name) {
        if (this.stopped)
            return;
        this.emit('parity_virtual_lifecycle', {
            pageEpochId: this.pageEpochId,
            name,
            tSinceCommitMs: this.tSinceCommitMs(),
            tVirtualMs: this.tVirtualMs(),
        });
    }
    attachLifecycle() {
        const onDomContentLoaded = () => this.emitLifecycle('domcontentloaded');
        const onLoad = () => this.emitLifecycle('load');
        const onFrameNavigated = (frame) => {
            if (frame !== this.page.mainFrame())
                return;
            this.emitLifecycle('framenavigated');
        };
        this.page.on('domcontentloaded', onDomContentLoaded);
        this.page.on('load', onLoad);
        this.page.on('framenavigated', onFrameNavigated);
        this.detachers.push(() => this.page.off('domcontentloaded', onDomContentLoaded));
        this.detachers.push(() => this.page.off('load', onLoad));
        this.detachers.push(() => this.page.off('framenavigated', onFrameNavigated));
    }
    attachErrors() {
        const onConsole = (msg) => {
            if (msg.type() !== 'error')
                return;
            this.noteError('console', msg.text());
        };
        const onPageError = (err) => {
            this.noteError('pageerror', err.message || String(err));
        };
        const onRequestFailed = (req) => {
            const reason = req.failure()?.errorText ?? 'request failed';
            this.noteError('requestfailed', reason, req.url());
        };
        this.page.on('console', onConsole);
        this.page.on('pageerror', onPageError);
        this.page.on('requestfailed', onRequestFailed);
        this.detachers.push(() => this.page.off('console', onConsole));
        this.detachers.push(() => this.page.off('pageerror', onPageError));
        this.detachers.push(() => this.page.off('requestfailed', onRequestFailed));
    }
    noteError(source, message, url) {
        if (this.stopped)
            return;
        const trimmed = message.length > 500 ? message.slice(0, 500) : message;
        const key = `${source}:${trimmed}`;
        const existing = this.pageErrors.get(key);
        if (existing) {
            existing.count += 1;
        }
        else {
            this.pageErrors.set(key, { source, message: trimmed, urlKey: (0, parityUtil_1.urlKeyOf)(url), count: 1 });
        }
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flushErrors(), PAGE_ERROR_FLUSH_MS);
        }
    }
    flushErrors() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pageErrors.size === 0)
            return;
        for (const entry of this.pageErrors.values()) {
            this.emit('parity_virtual_page_error', {
                pageEpochId: this.pageEpochId,
                source: entry.source,
                message: entry.message,
                urlKey: entry.urlKey,
                count: entry.count,
                tVirtualMs: this.tVirtualMs(),
            });
        }
        this.pageErrors.clear();
    }
    async sampleNavTiming() {
        try {
            await this.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
            if (this.stopped)
                return;
            const timing = (await this.page.evaluate(NAV_TIMING_SCRIPT));
            if (!timing || this.stopped)
                return;
            this.emit('parity_virtual_nav_timing', {
                pageEpochId: this.pageEpochId,
                redirectMs: timing.redirectMs ?? undefined,
                dnsMs: timing.dnsMs ?? undefined,
                connectMs: timing.connectMs ?? undefined,
                ttfbMs: timing.ttfbMs ?? undefined,
                domInteractiveMs: timing.domInteractiveMs ?? undefined,
                domContentLoadedMs: timing.domContentLoadedMs ?? undefined,
                loadEventMs: timing.loadEventMs ?? undefined,
                tVirtualMs: this.tVirtualMs(),
            });
        }
        catch {
            /* mid-navigation / page closed */
        }
    }
    async sampleResourceSummary() {
        try {
            await this.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
            if (this.stopped)
                return;
            const summary = (await this.page.evaluate(RESOURCE_SUMMARY_SCRIPT));
            if (!summary || this.stopped)
                return;
            const topSlow = summary.topSlow.map((e) => ({
                urlKey: (0, parityUtil_1.urlKeyOf)(e.url),
                durationMs: e.durationMs,
                bytes: e.bytes,
            }));
            this.emit('parity_virtual_resource_summary', {
                pageEpochId: this.pageEpochId,
                byTypeJson: JSON.stringify(summary.byType),
                topSlowJson: JSON.stringify(topSlow),
                tVirtualMs: this.tVirtualMs(),
            });
        }
        catch {
            /* mid-navigation / page closed */
        }
    }
}
exports.VirtualEpochTelemetry = VirtualEpochTelemetry;
//# sourceMappingURL=VirtualEpochTelemetry.js.map