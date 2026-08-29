/**
 * Turnstile pierce helpers — re-exports labPierce + Turnstile-specific finders.
 */
/// <reference lib="dom" />

import { resolveShadowRoot } from '@speculum/page-projection/core/closedShadowLookup';
import {
  sampleElement as sampleTurnstileElement,
  samplePaint as sampleTurnstilePaint,
  type ElementPaintSample as TurnstilePaintSample,
  type ElementRectSample as TurnstileRectSample,
} from './labPierce';

export type { TurnstileRectSample, TurnstilePaintSample };
export { sampleTurnstileElement, sampleTurnstilePaint };

export type CfTurnstileFindResult = {
  iframe: HTMLIFrameElement | null;
  shadowHost: Element | null;
};

export function findCfTurnstileIframe(doc: Document): HTMLIFrameElement | null {
  return findCfTurnstileWithHost(doc).iframe;
}

export function findCfTurnstileWithHost(doc: Document): CfTurnstileFindResult {
  const root = doc.documentElement;
  if (!root) return { iframe: null, shadowHost: null };
  const queue: Array<{ node: Node; shadowHost: Element | null }> = [{ node: root, shadowHost: null }];
  while (queue.length > 0) {
    const { node: n, shadowHost } = queue.shift()!;
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    if (el.tagName === 'IFRAME') {
      const id = el.id || '';
      const src = el.getAttribute('src') || '';
      if (id.startsWith('cf-chl') || /challenges\.cloudflare\.com|turnstile/i.test(src)) {
        const hostFromRoot =
          shadowHost ??
          (el.getRootNode() instanceof ShadowRoot
            ? ((el.getRootNode() as ShadowRoot).host as Element)
            : null);
        return { iframe: el as HTMLIFrameElement, shadowHost: hostFromRoot };
      }
    }
    const sr = resolveShadowRoot(el);
    if (sr) {
      for (const c of Array.from(sr.childNodes)) queue.push({ node: c, shadowHost: el });
    }
    for (const c of Array.from(el.childNodes)) queue.push({ node: c, shadowHost });
  }
  return { iframe: null, shadowHost: null };
}

export function measureTurnstileRootRectsFromDocument(doc: Document): TurnstileRectSample[] {
  const { iframe, shadowHost } = findCfTurnstileWithHost(doc);
  return [
    sampleTurnstileElement(iframe, 'nested_host_iframe_in_root'),
    sampleTurnstileElement(shadowHost, 'root_shadow_host'),
    sampleTurnstileElement(doc.documentElement, 'root_documentElement'),
  ];
}

export type ClipPixelProbe = {
  x: number;
  y: number;
  tag: string | null;
  id: string | null;
  backgroundColor: string;
  opacity: string;
  visibility: string;
};

/** @deprecated Root-document elementFromPoint cannot see inside iframes. */
export function probeClipPixels(
  doc: Document,
  clip: { x: number; y: number; width: number; height: number },
  grid = 5,
): ClipPixelProbe[] {
  const win = doc.defaultView;
  if (!win) return [];
  const out: ClipPixelProbe[] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = clip.x + (clip.width * (i + 0.5)) / grid;
      const y = clip.y + (clip.height * (j + 0.5)) / grid;
      const el = doc.elementFromPoint(x, y);
      const cs = el && win ? win.getComputedStyle(el) : null;
      out.push({
        x,
        y,
        tag: el?.tagName?.toLowerCase() ?? null,
        id: el?.id || null,
        backgroundColor: cs?.backgroundColor ?? '',
        opacity: cs?.opacity ?? '',
        visibility: cs?.visibility ?? '',
      });
    }
  }
  return out;
}
