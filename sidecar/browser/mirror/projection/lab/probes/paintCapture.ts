/**
 * Unified Virtual + Projected viewport clip capture for lab paint probes.
 */

import type { PageProjectionBrowserSession } from '../../session/PageProjectionBrowserSession';
import type { BrowserSession } from '../../../../BrowserSession';
import { captureProjectedViewportClip, type ViewportClip } from '../host/labProjectedCapture';

export type ClipCapturePair = {
  clip: ViewportClip;
  virtual: { ok: boolean; base64?: string; reason?: string; byteLength?: number };
  projected: { ok: boolean; base64?: string; reason?: string; byteLength?: number };
};

export async function captureClipPair(opts: {
  session: BrowserSession;
  clip: ViewportClip;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
}): Promise<ClipCapturePair> {
  const session = opts.session as BrowserSession & {
    captureViewportClip?: PageProjectionBrowserSession['captureViewportClip'];
  };
  let virtual: ClipCapturePair['virtual'] = { ok: false, reason: 'no_captureViewportClip' };
  if (typeof session.captureViewportClip === 'function') {
    virtual = await session.captureViewportClip(opts.clip);
  }
  let projected: ClipCapturePair['projected'] = { ok: false, reason: 'no_projected_cdp' };
  if (opts.projectedCdpUrl && opts.labOrigin) {
    projected = await captureProjectedViewportClip(opts.projectedCdpUrl, opts.clip, opts.labOrigin);
  }
  return { clip: opts.clip, virtual, projected };
}
