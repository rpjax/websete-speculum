/**
 * Projected documents have no page JS (K5 — CSP). Native activation of
 * `<a href>` and form submit still runs without sandbox — on iOS WebKit that follows the link
 * even when a parent `click` listener later calls preventDefault. Relative hrefs resolve against
 * the lab/Sessions origin and replace the surface (lab 404 "not found").
 *
 * Guard is presentation-only: tree/table unchanged. Whole-surface `touch-action`
 * keeps iOS from delaying pointers / double-tap-zoom while native scroll still works.
 */

export function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object') return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element;
  const parent = (node as ChildNode).parentElement;
  return parent;
}

export function isProjectedNavigable(target: EventTarget | null): boolean {
  const el = eventTargetElement(target);
  if (el == null) return false;
  if (typeof el.closest !== 'function') return false;
  return el.closest('a[href], area[href]') != null;
}

export function suppressProjectedDefault(event: Event): void {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

/** Layout viewport — iOS `innerWidth` tracks the visual viewport and desyncs touch coords. */
export function layoutViewportSize(win: Window): { width: number; height: number } {
  const el = win.document?.documentElement;
  const width = el?.clientWidth || win.innerWidth;
  const height = el?.clientHeight || win.innerHeight;
  return { width, height };
}

/**
 * Installs capture-phase native suppression for the life of this Document.
 * Safe to call more than once (second install still works; callers own teardown).
 */
/** Pan + tap without pinch/double-tap delay; native scroll events still fire. */
function installProjectedTouchSurface(doc: Document): void {
  const touchAction = 'manipulation';
  const root = doc.documentElement;
  if (root) root.style.touchAction = touchAction;
  if (doc.body) doc.body.style.touchAction = touchAction;
}

export type ProjectedNativeGuardOptions = {
  onTouchStartSeen?: () => void;
};

export function attachProjectedNativeGuard(doc: Document, opts?: ProjectedNativeGuardOptions): () => void {
  installProjectedTouchSurface(doc);
  const onActivate = (event: Event) => suppressProjectedDefault(event);
  const onPointerDown = (event: Event) => {
    const pe = event as PointerEvent;
    if (typeof pe.button === 'number' && pe.button !== 0) return;
    if (isProjectedNavigable(event.target)) suppressProjectedDefault(event);
  };
  const onTouchStart = (event: Event) => {
    opts?.onTouchStartSeen?.();
    if (isProjectedNavigable(event.target)) suppressProjectedDefault(event);
  };

  doc.addEventListener('click', onActivate, true);
  doc.addEventListener('auxclick', onActivate, true);
  doc.addEventListener('dblclick', onActivate, true);
  doc.addEventListener('submit', onActivate, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });

  return () => {
    doc.removeEventListener('click', onActivate, true);
    doc.removeEventListener('auxclick', onActivate, true);
    doc.removeEventListener('dblclick', onActivate, true);
    doc.removeEventListener('submit', onActivate, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('touchstart', onTouchStart, true);
  };
}
