/**
 * Live emit / scheduler helpers — §5.5 binary parts, frame aggregate, PageEpoch
 * virtual telemetry (§5.15.6), and client-state rate policy thresholds.
 */

import type { Page } from 'patchright';
import { randomUUID } from 'node:crypto';
import type { FrameClockScheduler } from './clock';
import type { EncodedFrameMeta } from './encode';
import type { PageProjectionEngineEvents } from './PageProjection';
import type { DirtyState } from './observe';

export const WIRE_VERSION = 1;

/**
 * §5.3.5.1 sensible default — a client backlog beyond a couple of frames' worth
 * signals the client can't keep up even before an apply overrun lands; treated
 * the same as a reported overrun. `WP14` density calibration is expected to revise.
 */
export const CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD = 4;

export type LiveEmitParity = (kind: string, payload: Record<string, unknown>) => void;

export type LiveEmitDiffSink = (diff: {
  sequence: number;
  generation: number;
  plane: string;
  operation: string;
  timestampMs: number;
  body: Uint8Array;
  partIndex?: number;
  partCount?: number;
  flags?: number;
  version?: number;
}) => void;

export type LiveFrameStats = {
  framesEmitted: number;
  bytesEmitted: number;
  lastRateHz: number;
  stallCount: number;
  applyOverrunReports: number;
};

export function emitPageProjectionParts(opts: {
  parts: Uint8Array[];
  meta: EncodedFrameMeta;
  frameStats: LiveFrameStats;
  onPageProjectionDiff: LiveEmitDiffSink;
}): void {
  const { parts, meta, frameStats, onPageProjectionDiff } = opts;
  const partCount = parts.length;
  const flags = (meta.establish ? 0b01 : 0) | (meta.resync ? 0b10 : 0);
  const timestampMs = Date.now();
  frameStats.framesEmitted += 1;
  for (const body of parts) frameStats.bytesEmitted += body.byteLength;
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
      version: WIRE_VERSION,
    });
  });
}

export function emitFrameAggregateParity(opts: {
  onParity?: LiveEmitParity;
  pageEpochId: string;
  generation: number;
  frameStats: LiveFrameStats;
  rateHz: number;
  mirrorBytes: number;
  aggregateIntervalMs: number;
  tVirtualMs: number;
}): void {
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

export function buildLiveEngineEvents(opts: {
  emitParts: (parts: Uint8Array[], meta: EncodedFrameMeta) => void;
  onGenerationBumped?: (event: {
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    diffKind?: string;
  }) => void;
  frameStats: LiveFrameStats;
  onParity?: LiveEmitParity;
  getPageEpochId: () => string;
  getGeneration: () => number;
}): PageProjectionEngineEvents {
  return {
    onFrame: (parts, meta) => opts.emitParts(parts, meta),
    onGenerationBumped: (event) =>
      opts.onGenerationBumped?.({ ...event, reason: 'main_frame_navigated' }),
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

export function buildLiveScheduler(opts: {
  onSchedulerTick: (tick: () => void) => Promise<void>;
}): FrameClockScheduler {
  return {
    setInterval: (callback, ms) => setInterval(() => void opts.onSchedulerTick(callback), Math.max(1, ms)),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    now: () => Date.now(),
  };
}

export type LiveSchedulerTickState = {
  stopped: boolean;
  busy: boolean;
  hasPending: boolean;
  established: boolean;
};

/** One clock tick: poll the page for a fresh snapshot only when something is dirty, then flush. */
export async function runLiveSchedulerTick(opts: {
  state: LiveSchedulerTickState;
  setBusy: (busy: boolean) => void;
  pollAndIngest: () => Promise<void>;
  tick: () => void;
}): Promise<void> {
  if (opts.state.stopped || opts.state.busy) return;
  if (opts.state.hasPending && opts.state.established) {
    opts.setBusy(true);
    try {
      await opts.pollAndIngest();
    } catch {
      /* mid-navigation — next tick retries against the fresh document. */
    } finally {
      opts.setBusy(false);
    }
  }
  if (!opts.state.stopped) opts.tick();
}

export function detachVirtualTelemetry(detachers: Array<() => void>): void {
  for (const d of detachers.splice(0)) {
    try {
      d();
    } catch {
      /* page closed */
    }
  }
}

/** §5.15.6 — mint a pageEpochId per Document; soft-nav mints a new epoch without generation bump. */
export function mintLivePageEpoch(opts: {
  page: Page;
  soft: boolean;
  documentEpoch?: string | null;
  generation: number;
  tVirtualStartMs: number;
  onParity?: LiveEmitParity;
  detachVirtualTelemetry: () => void;
  attachVirtualTelemetry: () => void;
}): { pageEpochId: string; pageEpochCommitAtMs: number } {
  opts.detachVirtualTelemetry();
  const pageEpochId = randomUUID();
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
      } catch {
        return undefined;
      }
    })(),
    tVirtualMs: Date.now() - opts.tVirtualStartMs,
  });
  opts.attachVirtualTelemetry();
  return { pageEpochId, pageEpochCommitAtMs };
}

export function attachVirtualTelemetry(opts: {
  page: Page;
  stopped: () => boolean;
  pageEpochId: string;
  pageEpochCommitAtMs: number;
  tVirtualStartMs: number;
  getPageEpochId: () => string;
  onParity?: LiveEmitParity;
  pushDetacher: (detach: () => void) => void;
}): void {
  if (opts.stopped() || !opts.pageEpochId) return;
  const epochId = opts.pageEpochId;
  const commitAt = opts.pageEpochCommitAtMs;
  const tVirtualMs = (): number => Date.now() - opts.tVirtualStartMs;
  const emitLifecycle = (name: string): void => {
    opts.onParity?.('parity_virtual_lifecycle', {
      pageEpochId: epochId,
      name,
      tSinceCommitMs: Date.now() - commitAt,
      tVirtualMs: tVirtualMs(),
    });
  };
  const onDomContentLoaded = (): void => emitLifecycle('domcontentloaded');
  const onLoad = (): void => emitLifecycle('load');
  opts.page.on('domcontentloaded', onDomContentLoaded);
  opts.page.on('load', onLoad);
  opts.pushDetacher(() => opts.page.off('domcontentloaded', onDomContentLoaded));
  opts.pushDetacher(() => opts.page.off('load', onLoad));

  const onConsole = (msg: { type(): string; text(): string }): void => {
    if (msg.type() !== 'error') return;
    opts.onParity?.('parity_virtual_page_error', {
      pageEpochId: epochId,
      source: 'console',
      message: msg.text().slice(0, 500),
      tVirtualMs: tVirtualMs(),
    });
  };
  const onPageError = (err: Error): void => {
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
    if (!timing || opts.stopped() || opts.getPageEpochId() !== epochId) return;
    opts.onParity?.('parity_virtual_nav_timing', {
      pageEpochId: epochId,
      ...(timing as Record<string, unknown>),
      tVirtualMs: tVirtualMs(),
    });
  }).catch(() => {});
}

/**
 * §5.9.5 client → server control report helpers for visibility / overrun / backlog.
 */
export function applyClientStateReport(opts: {
  visibility: 'visible' | 'hidden';
  queuedFrames: number;
  overrunCount: number;
  setHidden: (hidden: boolean) => void;
  degradeRate: () => void;
  tryRecoverRate: () => void;
  frameStats: LiveFrameStats;
  pageEpochId: string;
  generation: number;
  onParity?: LiveEmitParity;
}): void {
  opts.setHidden(opts.visibility === 'hidden');
  if (opts.visibility === 'hidden') return;
  if (opts.overrunCount > 0 || opts.queuedFrames > CLIENT_STATE_QUEUED_FRAMES_DEGRADE_THRESHOLD) {
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
  } else {
    opts.tryRecoverRate();
  }
}

/** Merge an in-page tick's dirty sets into the pending DirtyState; returns whether any id was marked. */
export function absorbDirtyFromTick(
  pending: DirtyState,
  dirty: (Record<string, number[]> & { scrollDirty?: [number, number, number][] }) | undefined,
): boolean {
  if (!dirty) return false;
  let any = false;
  for (const id of dirty.newIds ?? []) { pending.newIds.add(id); any = true; }
  for (const id of dirty.dirtyParents ?? []) { pending.dirtyParents.add(id); any = true; }
  for (const id of dirty.attrDirty ?? []) { pending.attrDirty.add(id); any = true; }
  for (const id of dirty.textDirty ?? []) { pending.textDirty.add(id); any = true; }
  for (const id of dirty.stateDirty ?? []) { pending.stateDirty.add(id); any = true; }
  for (const id of dirty.detached ?? []) { pending.detached.add(id); any = true; }
  for (const [id, x, y] of dirty.scrollDirty ?? []) { pending.scrollDirty.set(id, { x, y }); any = true; }
  return any;
}
