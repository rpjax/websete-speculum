/**
 * Nested iframe viewport chain — one hop origin (parent document) + compose to root.
 */

import type { LocalHitRect } from './localHit';

export type ViewportHop = {
  dx: number;
  dy: number;
  scale: number;
};

/** Content-box origin of a nested browsing host iframe in this document's viewport. */
export function iframeContentBoxOrigin(el: HTMLElement): ViewportHop {
  const rect = el.getBoundingClientRect();
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
  const borderLeft = cs ? Number.parseFloat(cs.borderLeftWidth) || 0 : 0;
  const borderTop = cs ? Number.parseFloat(cs.borderTopWidth) || 0 : 0;
  const padLeft = cs ? Number.parseFloat(cs.paddingLeft) || 0 : 0;
  const padTop = cs ? Number.parseFloat(cs.paddingTop) || 0 : 0;
  const layoutW = el.offsetWidth;
  const scale = layoutW > 0 ? rect.width / layoutW : 1;
  return {
    dx: rect.left + borderLeft + padLeft,
    dy: rect.top + borderTop + padTop,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

export function elementLocalViewportRect(el: Element): LocalHitRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Map a point in child viewport coords to parent viewport coords (one hop). */
export function mapPointAcrossHop(x: number, y: number, hop: ViewportHop): { x: number; y: number } {
  return { x: x * hop.scale + hop.dx, y: y * hop.scale + hop.dy };
}

/** Compose child-viewport point to root using ordered hops leaf→root (one hop per ancestry step). */
export function composePointToRoot(
  localX: number,
  localY: number,
  hopsLeafToRoot: ViewportHop[],
): { x: number; y: number } {
  let x = localX;
  let y = localY;
  for (const hop of hopsLeafToRoot) {
    const mapped = mapPointAcrossHop(x, y, hop);
    x = mapped.x;
    y = mapped.y;
  }
  return { x, y };
}
