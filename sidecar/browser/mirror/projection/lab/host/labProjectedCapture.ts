/**
 * CDP viewport clip on the lab Projected client page (real browser tab — not Virtual).
 * Lab-only; uses connectOverCDP to the headed/headless tab running client.html.
 */

import { chromium, type Browser } from 'patchright';

export type ViewportClip = { x: number; y: number; width: number; height: number };

export type ViewportClipCapture = {
  ok: boolean;
  base64?: string;
  reason?: string;
  byteLength?: number;
};

function pickProjectedPage(browser: Browser, labOrigin: string) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages.length === 0) return null;
  const origin = labOrigin.replace(/\/$/, '');
  return (
    pages.find((p) => {
      const u = p.url();
      return u.startsWith(origin) || /\/$/.test(origin) && u.startsWith(`${origin}/`);
    }) ?? pages[pages.length - 1]
  );
}

/** Same clip contract as Virtual `PageProjectionBrowserSession.captureViewportClip`. */
export async function captureProjectedViewportClip(
  cdpUrl: string,
  clip: ViewportClip,
  labOrigin: string,
): Promise<ViewportClipCapture> {
  if (!cdpUrl.trim()) return { ok: false, reason: 'no_projected_cdp_url' };
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl.trim());
    const page = pickProjectedPage(browser, labOrigin);
    if (!page) return { ok: false, reason: 'no_projected_page' };
    const surfaceOffset = await page.evaluate(() => {
      const host = document.getElementById('surfaceHost');
      if (!host) return { x: 0, y: 0 };
      const r = host.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const buf = await page.screenshot({
      type: 'png',
      clip: {
        x: Math.max(0, clip.x + surfaceOffset.x),
        y: Math.max(0, clip.y + surfaceOffset.y),
        width: Math.max(1, clip.width),
        height: Math.max(1, clip.height),
      },
    });
    const base64 = buf.toString('base64');
    if (base64.length === 0) return { ok: false, reason: 'empty_screenshot' };
    return { ok: true, base64, byteLength: base64.length };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* disconnect only */
      }
    }
  }
}
