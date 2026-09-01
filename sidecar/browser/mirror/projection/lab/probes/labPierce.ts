/**
 * Lab pierce helpers — walk closed/open shadow via resolveShadowRoot.
 * Shared by Turnstile probes, CSSOM matrix, sheet dump.
 */
/// <reference lib="dom" />

import { resolveShadowRoot } from '@speculum/page-projection/core/closedShadowLookup';

export type ElementRectSample = {
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

export type ElementPaintSample = {
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

/** BFS element walk — pierces closed shadow via resolveShadowRoot. */
export function walkElements(
  root: Node,
  visit: (el: Element, shadowHost: Element | null) => void | boolean,
): void {
  const queue: Array<{ node: Node; shadowHost: Element | null }> = [{ node: root, shadowHost: null }];
  while (queue.length > 0) {
    const { node: n, shadowHost } = queue.shift()!;
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    const stop = visit(el, shadowHost);
    if (stop === true) return;
    const sr = resolveShadowRoot(el);
    if (sr) {
      for (const c of Array.from(sr.childNodes)) queue.push({ node: c, shadowHost: el });
    }
    for (const c of Array.from(el.childNodes)) queue.push({ node: c, shadowHost });
  }
}

export function findElementById(doc: Document, id: string): Element | null {
  let found: Element | null = null;
  walkElements(doc.documentElement, (el) => {
    if (el.id === id) {
      found = el;
      return true;
    }
    return false;
  });
  return found;
}

export function sampleElement(el: Element | null, name: string): ElementRectSample {
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

export function samplePaint(el: Element | null): ElementPaintSample | null {
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
