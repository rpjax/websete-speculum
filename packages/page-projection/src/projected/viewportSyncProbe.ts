/**
 * Temporary measurement probe — enable with ?viewportSyncProbe=1 or window.__VIEWPORT_SYNC_PROBE__ = true.
 */

import type { ViewportSize } from './viewportPolicy';

type ProbeResizeResult = {
  applied: boolean;
  width?: number;
  height?: number;
  message?: string;
  errorCode?: string;
};

export type ViewportSyncProbeTick = {
  kind: 'tick';
  t: number;
  measure: ViewportSize;
  remote: ViewportSize;
};

export type ViewportSyncProbeResize = {
  kind: 'resize';
  t: number;
  target: ViewportSize;
  result: ProbeResizeResult;
};

export type ViewportSyncProbeReject = {
  kind: 'resize_reject';
  t: number;
  detail: string;
};

export type ViewportSyncProbeSkip = {
  kind: 'schedule_skip';
  t: number;
  reason: string;
  measure: ViewportSize;
  remote: ViewportSize;
  rawW: number;
  rawH: number;
};

export type ViewportSyncProbeRecord =
  | ViewportSyncProbeTick
  | ViewportSyncProbeResize
  | ViewportSyncProbeReject
  | ViewportSyncProbeSkip;

declare global {
  interface Window {
    __VIEWPORT_SYNC_PROBE__?: boolean;
    __viewportSyncProbeLog?: ViewportSyncProbeRecord[];
  }
}

export function viewportSyncProbeActive(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.__VIEWPORT_SYNC_PROBE__ === true) {
    return true;
  }
  try {
    return new URLSearchParams(window.location.search).has('viewportSyncProbe');
  } catch {
    return false;
  }
}

export function viewportSyncProbeEmit(record: ViewportSyncProbeRecord): void {
  if (!viewportSyncProbeActive()) {
    return;
  }
  const log = window.__viewportSyncProbeLog ?? [];
  log.push(record);
  window.__viewportSyncProbeLog = log;
  console.log('[viewportSyncProbe]', JSON.stringify(record));
}

export function viewportSyncProbeStartSampler(
  measure: () => ViewportSize,
  remote: () => ViewportSize,
  intervalMs = 250,
): () => void {
  if (!viewportSyncProbeActive()) {
    return () => {};
  }
  const id = setInterval(() => {
    viewportSyncProbeEmit({
      kind: 'tick',
      t: performance.now(),
      measure: measure(),
      remote: remote(),
    });
  }, intervalMs);
  return () => clearInterval(id);
}
