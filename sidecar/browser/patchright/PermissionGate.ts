/**
 * Origin-scoped camera/mic permission gate.
 *
 * On main-frame http(s) navigation, asks {@link BrowserSessionEvents} (Live → EventBridge →
 * Api SessionHooks) then applies Chromium permissions via the BrowserContext.
 * Fail-closed: timeout / throw → deny.
 */

import type { BrowserContext, Page } from 'patchright';
import type { BrowserPermissionDecision, BrowserSessionEvents } from '../BrowserSession';

const DECISION_TIMEOUT_MS = 15_000;

export type PermissionGateHandle = {
  dispose(): void;
  /** Re-arm after primary page replace (same context). */
  rebind(page: Page): void;
  /** Re-query policy and re-apply Chromium permissions for the current main-frame origin. */
  resync(urlOverride?: string): void;
  /** Awaitable resync for harness / probes. */
  resyncAsync(urlOverride?: string): Promise<{ camera: 'allow' | 'deny'; microphone: 'allow' | 'deny' }>;
};

export type AttachPermissionGateOptions = {
  context: BrowserContext;
  page: Page;
  events: Pick<
    BrowserSessionEvents,
    'onCameraPermissionRequested' | 'onMicrophonePermissionRequested'
  >;
  decisionTimeoutMs?: number;
};

async function decide(
  request: () => Promise<BrowserPermissionDecision>,
  timeoutMs: number,
): Promise<'allow' | 'deny'> {
  try {
    const result = await Promise.race([
      request(),
      new Promise<'deny'>((resolve) => {
        setTimeout(() => resolve('deny'), timeoutMs);
      }),
    ]);
    return result === 'allow' ? 'allow' : 'deny';
  } catch {
    return 'deny';
  }
}

async function applyOriginPermissions(
  context: BrowserContext,
  origin: string,
  camera: 'allow' | 'deny',
  microphone: 'allow' | 'deny',
): Promise<void> {
  const granted: Array<'camera' | 'microphone'> = [];
  if (camera === 'allow') granted.push('camera');
  if (microphone === 'allow') granted.push('microphone');

  try {
    // Reset then grant only allowed kinds (fail-closed default).
    await context.clearPermissions();
    if (granted.length > 0) {
      await context.grantPermissions(granted, { origin });
    }
  } catch {
    /* context may be closing */
  }
}

/**
 * Attach main-frame permission sync. Returns a handle to dispose / rebind on freshPage.
 */
export function attachPermissionGate(opts: AttachPermissionGateOptions): PermissionGateHandle {
  const timeoutMs = opts.decisionTimeoutMs ?? DECISION_TIMEOUT_MS;
  let page = opts.page;
  let disposed = false;
  let lastOrigin: string | null = null;

  const syncOriginAsync = async (
    url: string,
    force: boolean,
  ): Promise<{ camera: 'allow' | 'deny'; microphone: 'allow' | 'deny' } | null> => {
    if (disposed) return null;
    let origin: string;
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
      origin = new URL(url).origin;
    } catch {
      return null;
    }
    if (!force && origin === lastOrigin) return null;
    lastOrigin = origin;

    const camera = await decide(() => opts.events.onCameraPermissionRequested(), timeoutMs);
    const microphone = await decide(
      () => opts.events.onMicrophonePermissionRequested(),
      timeoutMs,
    );
    if (disposed) return null;
    await applyOriginPermissions(opts.context, origin, camera, microphone);
    return { camera, microphone };
  };

  const syncOrigin = (url: string): void => {
    void syncOriginAsync(url, false);
  };

  const onMainFrameNavigated = (): void => {
    try {
      if (disposed) return;
      syncOrigin(page.url());
    } catch {
      /* */
    }
  };

  const bindPage = (p: Page): void => {
    page = p;
    p.on('framenavigated', (frame) => {
      try {
        if (frame !== page.mainFrame()) return;
        onMainFrameNavigated();
      } catch {
        /* */
      }
    });
  };

  bindPage(page);
  try {
    syncOrigin(page.url());
  } catch {
    /* */
  }

  return {
    dispose(): void {
      disposed = true;
      lastOrigin = null;
    },
    rebind(next: Page): void {
      if (disposed) return;
      lastOrigin = null;
      bindPage(next);
      try {
        syncOrigin(page.url());
      } catch {
        /* */
      }
    },
    resync(urlOverride?: string): void {
      if (disposed) return;
      lastOrigin = null;
      try {
        syncOrigin(urlOverride ?? page.url());
      } catch {
        /* */
      }
    },
    async resyncAsync(urlOverride?: string): Promise<{ camera: 'allow' | 'deny'; microphone: 'allow' | 'deny' }> {
      if (disposed) return { camera: 'deny', microphone: 'deny' };
      lastOrigin = null;
      try {
        const result = await syncOriginAsync(urlOverride ?? page.url(), true);
        return result ?? { camera: 'deny', microphone: 'deny' };
      } catch {
        return { camera: 'deny', microphone: 'deny' };
      }
    },
  };
}
