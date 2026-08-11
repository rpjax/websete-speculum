import type { ConsoleMessage, Page, Request } from 'patchright';
import { urlKeyOf } from './parityUtil';

export type ParityEmitter = (kind: string, payload: Record<string, unknown>) => void;

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
export class VirtualEpochTelemetry {
  private stopped = false;
  private readonly detachers: Array<() => void> = [];
  private readonly pageErrors = new Map<string, { source: string; message: string; urlKey?: string; count: number }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly page: Page,
    private readonly pageEpochId: string,
    private readonly commitAtMs: number,
    private readonly emit: ParityEmitter,
    private readonly tVirtualMs: () => number,
  ) {}

  start(): void {
    this.attachLifecycle();
    this.attachErrors();
    void this.sampleNavTiming();
    void this.sampleResourceSummary();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushErrors();
    for (const detach of this.detachers.splice(0)) {
      try {
        detach();
      } catch {
        /* page already closed */
      }
    }
  }

  private tSinceCommitMs(): number {
    return Date.now() - this.commitAtMs;
  }

  private emitLifecycle(name: string): void {
    if (this.stopped) return;
    this.emit('parity_virtual_lifecycle', {
      pageEpochId: this.pageEpochId,
      name,
      tSinceCommitMs: this.tSinceCommitMs(),
      tVirtualMs: this.tVirtualMs(),
    });
  }

  private attachLifecycle(): void {
    const onDomContentLoaded = (): void => this.emitLifecycle('domcontentloaded');
    const onLoad = (): void => this.emitLifecycle('load');
    const onFrameNavigated = (frame: { url(): string }): void => {
      if (frame !== this.page.mainFrame()) return;
      this.emitLifecycle('framenavigated');
    };
    this.page.on('domcontentloaded', onDomContentLoaded);
    this.page.on('load', onLoad);
    this.page.on('framenavigated', onFrameNavigated);
    this.detachers.push(() => this.page.off('domcontentloaded', onDomContentLoaded));
    this.detachers.push(() => this.page.off('load', onLoad));
    this.detachers.push(() => this.page.off('framenavigated', onFrameNavigated));
  }

  private attachErrors(): void {
    const onConsole = (msg: ConsoleMessage): void => {
      if (msg.type() !== 'error') return;
      this.noteError('console', msg.text());
    };
    const onPageError = (err: Error): void => {
      this.noteError('pageerror', err.message || String(err));
    };
    const onRequestFailed = (req: Request): void => {
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

  private noteError(source: string, message: string, url?: string): void {
    if (this.stopped) return;
    const trimmed = message.length > 500 ? message.slice(0, 500) : message;
    const key = `${source}:${trimmed}`;
    const existing = this.pageErrors.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.pageErrors.set(key, { source, message: trimmed, urlKey: urlKeyOf(url), count: 1 });
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushErrors(), PAGE_ERROR_FLUSH_MS);
    }
  }

  private flushErrors(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pageErrors.size === 0) return;
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

  private async sampleNavTiming(): Promise<void> {
    try {
      await this.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      if (this.stopped) return;
      const timing = (await this.page.evaluate(NAV_TIMING_SCRIPT)) as {
        redirectMs: number | null;
        dnsMs: number | null;
        connectMs: number | null;
        ttfbMs: number | null;
        domInteractiveMs: number | null;
        domContentLoadedMs: number | null;
        loadEventMs: number | null;
      } | null;
      if (!timing || this.stopped) return;
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
    } catch {
      /* mid-navigation / page closed */
    }
  }

  private async sampleResourceSummary(): Promise<void> {
    try {
      await this.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
      if (this.stopped) return;
      const summary = (await this.page.evaluate(RESOURCE_SUMMARY_SCRIPT)) as {
        byType: Array<{ type: string; count: number; bytes: number; durationMs: number }>;
        topSlow: Array<{ url: string; durationMs: number; bytes: number }>;
      } | null;
      if (!summary || this.stopped) return;
      const topSlow = summary.topSlow.map((e) => ({
        urlKey: urlKeyOf(e.url),
        durationMs: e.durationMs,
        bytes: e.bytes,
      }));
      this.emit('parity_virtual_resource_summary', {
        pageEpochId: this.pageEpochId,
        byTypeJson: JSON.stringify(summary.byType),
        topSlowJson: JSON.stringify(topSlow),
        tVirtualMs: this.tVirtualMs(),
      });
    } catch {
      /* mid-navigation / page closed */
    }
  }
}
