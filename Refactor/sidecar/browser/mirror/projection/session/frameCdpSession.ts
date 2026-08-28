/**
 * Shared per-frame CDP session attach (OOPIF / nested browsing contexts).
 * Used by CSP Document Response hook and projection runtime installer.
 */

import type { BrowserContext, CDPSession, Frame, Page } from 'patchright';

export type FrameCdpAttachState = {
  frameSessions: WeakMap<Frame, CDPSession>;
};

export function createFrameCdpAttachState(): FrameCdpAttachState {
  return { frameSessions: new WeakMap() };
}

/**
 * Attach a CDP session to a child frame (skips main frame).
 * Idempotent per frame — returns existing session when already attached.
 */
export async function attachFrameCdp(
  frame: Frame,
  page: Page,
  context: BrowserContext,
  state: FrameCdpAttachState,
): Promise<CDPSession | null> {
  if (frame === page.mainFrame()) return null;
  const existing = state.frameSessions.get(frame);
  if (existing) return existing;
  try {
    const frameCdp = await context.newCDPSession(frame);
    state.frameSessions.set(frame, frameCdp);
    return frameCdp;
  } catch {
    /* same-process iframe / detached — page session may already see its network */
    return null;
  }
}

type WireFrameCdpLifecycleOptions = {
  page: Page;
  context: BrowserContext;
  state: FrameCdpAttachState;
  /** Called for each child frame after CDP attach (optional). */
  onFrameSession?: (frame: Frame) => void | Promise<void>;
  /** Re-enable on main frame navigation (patterns may drop after cross-process nav). */
  onMainFrameNavigated?: () => void | Promise<void>;
};

/** Wire frameattached / framenavigated for OOPIF re-bind. Awaits initial frame attach round. */
export async function wireFrameCdpLifecycle(opts: WireFrameCdpLifecycleOptions): Promise<void> {
  const { page, context, state, onFrameSession, onMainFrameNavigated } = opts;

  const attach = async (frame: Frame) => {
    if (onFrameSession) {
      await onFrameSession(frame);
      return;
    }
    await attachFrameCdp(frame, page, context, state);
  };

  await Promise.all(page.frames().map((frame) => attach(frame)));

  page.on('frameattached', (frame) => {
    void attach(frame);
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      if (onMainFrameNavigated) void onMainFrameNavigated();
      return;
    }
    if (state.frameSessions.has(frame)) return;
    void attach(frame);
  });
}
