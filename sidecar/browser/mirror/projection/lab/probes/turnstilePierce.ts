/**
 * Shared Turnstile pierce helpers — walk closed/open shadow like Virtual bootstrap.
 * Lab-only; uses registry-backed resolveShadowRoot on Projected.
 */
/// <reference lib="dom" />

import { resolveShadowRoot } from '@speculum/page-projection/core/closedShadowLookup';

export type TurnstileRectSample = {
  name: string;
  ok: boolean;
  reason?: string;
  tagName?: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  offsetWidth?: number;
  offsetHeight?: number;
  display?: string | null;
  visibility?: string | null;
  hasSrcAttr?: boolean | null;
  src?: string | null;
};

export type TurnstilePaintSample = {
  backgroundColor: string;
  color: string;
  opacity: string;
  visibility: string;
  display: string;
  borderTopWidth: string;
  borderTopColor: string;
  borderTopStyle: string;
  width: string;
  height: string;
};

export function sampleTurnstileElement(el: Element | null, name: string): TurnstileRectSample {
  if (!el) return { name, ok: false, reason: 'missing' };
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const cs = win ? win.getComputedStyle(el) : null;
  const html = el as HTMLElement;
  const isIframe = el.tagName === 'IFRAME';
  return {
    name,
    ok: true,
    tagName: el.tagName.toLowerCase(),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    offsetWidth: html.offsetWidth,
    offsetHeight: html.offsetHeight,
    display: cs?.display ?? null,
    visibility: cs?.visibility ?? null,
    hasSrcAttr: isIframe ? el.hasAttribute('src') : null,
    src: isIframe ? el.getAttribute('src') : null,
  };
}

export function sampleTurnstilePaint(el: Element | null): TurnstilePaintSample | null {
  if (!el) return null;
  const win = el.ownerDocument.defaultView;
  const cs = win ? win.getComputedStyle(el) : null;
  if (!cs) return null;
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    opacity: cs.opacity,
    visibility: cs.visibility,
    display: cs.display,
    borderTopWidth: cs.borderTopWidth,
    borderTopColor: cs.borderTopColor,
    borderTopStyle: cs.borderTopStyle,
    width: cs.width,
    height: cs.height,
  };
}

export type CfTurnstileFindResult = {
  iframe: HTMLIFrameElement | null;
  /** Host element whose closed/open shadow contained the iframe (registry pierce). */
  shadowHost: Element | null;
};

/** Find CF Turnstile iframe — pierces closed shadow via resolveShadowRoot. */
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

/** @deprecated Root-document elementFromPoint cannot see inside iframes — do not use for Turnstile clip. */
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
