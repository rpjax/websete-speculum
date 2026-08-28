/**
 * Projected surface input capture — UnifiedIntent (§10.6), sparse-cdp only.
 * Pointer down/up: event.target → registry.idOf (fail-closed on miss); no pointermove; local-first scrollSet.
 */

import type { PageProjectionRegistry } from '../registry';
import type { UnifiedIntent } from '../../core/input/unifiedIntentTypes';
import { UNIFIED_INTENT_SCHEMA_VERSION } from '../../core/input/unifiedIntentTypes';
import type { ProjectedInputCaptureMetrics } from './inputCaptureMetrics';
import { ClientBuffer } from './ClientBuffer';

export type ProjectedInputCaptureOptions = {
  contextId: number;
  getGeneration: () => number;
  getViewportSize: () => { width: number; height: number };
  getRootWindow?: () => Window | null;
  isArmed: () => boolean;
  onMarkPropDirty?: (nodeId: number) => void;
  onProgrammaticScrollSuppress?: (target: 'viewport' | number) => void;
  consumeScrollEcho?: (target: 'viewport' | number, observed: { top: number; left: number }) => boolean;
  sessionId?: string | null;
  token?: string | null;
  assetBaseUrl?: string;
  getSessionId?: () => string | null | undefined;
  getToken?: () => string | null | undefined;
  getAssetBaseUrl?: () => string | undefined;
  metrics?: ProjectedInputCaptureMetrics;
};

export type ProjectedIntentSender = (intent: UnifiedIntent) => void | Promise<void>;

function isElement(node: EventTarget | null | undefined): node is Element {
  return !!node && typeof node === 'object' && (node as Node).nodeType === 1;
}

function tagName(node: EventTarget | null | undefined): string {
  return isElement(node) ? node.tagName.toUpperCase() : '';
}

function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!isElement(target)) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (target as HTMLElement).isContentEditable;
}

function buttonFromEvent(button: number): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}

const EDGE_SWIPE_PX = 24;
const EDGE_SWIPE_MIN_DX = 72;

function historyNavFromKeyboard(event: KeyboardEvent): 'back' | 'forward' | null {
  if (isEditableTarget(event.target)) return null;
  if (event.altKey && event.key === 'ArrowLeft') return 'back';
  if (event.altKey && event.key === 'ArrowRight') return 'forward';
  if (event.metaKey && event.key === '[') return 'back';
  if (event.metaKey && event.key === ']') return 'forward';
  return null;
}

type EdgeSwipeTrack = {
  pointerId: number;
  startX: number;
  startY: number;
  edge: 'left' | 'right';
};

/**
 * @param surface Any Element in the projected document (typically `documentElement`).
 */
export function attachProjectedInputCapture(
  surface: Element,
  registry: PageProjectionRegistry,
  send: ProjectedIntentSender,
  opts: ProjectedInputCaptureOptions,
): () => void {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  const buffer = new ClientBuffer();
  let edgeSwipe: EdgeSwipeTrack | null = null;

  const fireHistoryNav = (direction: 'back' | 'forward') => {
    enqueue({
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: 'historyNav',
      timestampClient: performance.now(),
      direction,
    });
  };

  const trapProjectedHistory = () => {
    if (!win) return () => undefined;
    try {
      history.pushState({ speculumHistoryTrap: true }, '', win.location.href);
    } catch {
      return () => undefined;
    }
    const onPopState = () => {
      try {
        history.pushState({ speculumHistoryTrap: true }, '', win.location.href);
      } catch {
        /* */
      }
      if (!opts.isArmed()) {
        opts.metrics?.noteSkip('disarmed');
        return;
      }
      fireHistoryNav('back');
    };
    win.addEventListener('popstate', onPopState);
    return () => win.removeEventListener('popstate', onPopState);
  };
  const detachHistoryTrap = trapProjectedHistory();

  const fire = (intent: UnifiedIntent) => {
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return;
    }
    opts.metrics?.noteEmit(intent.type);
    void Promise.resolve(send(intent)).catch(() => undefined);
  };

  const enqueue = (intent: UnifiedIntent) => {
    buffer.enqueue(intent, fire);
  };

  const viewportStamp = () => {
    const { width, height } = opts.getViewportSize();
    return { viewportW: width, viewportH: height };
  };

  const surfaceCoordsFromClient = (clientX: number, clientY: number) => {
    if (!win) return null;
    let x = clientX;
    let y = clientY;
    const rootWin = opts.getRootWindow?.() ?? win;
    if (!rootWin) return null;
    let walk: Window | null = win;
    while (walk && walk !== rootWin) {
      let frameEl: Element | null = null;
      try {
        frameEl = walk.frameElement;
      } catch {
        break;
      }
      if (!frameEl) break;
      const rect = frameEl.getBoundingClientRect();
      x += rect.left;
      y += rect.top;
      try {
        walk = walk.parent;
      } catch {
        break;
      }
    }
    const visW = rootWin.innerWidth;
    const visH = rootWin.innerHeight;
    if (visW <= 0 || visH <= 0) return null;
    const { width: vw, height: vh } = opts.getViewportSize();
    if (vw <= 0 || vh <= 0) return null;
    const sx = x * (vw / visW);
    const sy = y * (vh / visH);
    return { x: Math.min(Math.max(sx, 0), vw - 1e-6), y: Math.min(Math.max(sy, 0), vh - 1e-6) };
  };

  const runPointerEdge = (event: PointerEvent, type: 'down' | 'up') => {
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return;
    }
    const coords = surfaceCoordsFromClient(event.clientX, event.clientY);
    if (!coords) {
      opts.metrics?.noteSkip('no_coords');
      return;
    }
    const stamp = viewportStamp();
    const target = event.target;
    if (!target || typeof target !== 'object' || !('nodeType' in target)) {
      opts.metrics?.noteSkip('no_node');
      return;
    }
    const nodeId = registry.idOf(target as Node);
    if (nodeId == null) {
      opts.metrics?.noteSkip('no_node');
      return;
    }
    enqueue({
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type,
      timestampClient: performance.now(),
      ...stamp,
      x: coords.x,
      y: coords.y,
      button: buttonFromEvent(event.button),
      contextId: opts.contextId,
      nodeId,
    });
  };

  const onPointerEdge = (event: PointerEvent, type: 'down' | 'up') => {
    runPointerEdge(event, type);
  };

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onWheel = (_event: WheelEvent) => {
    // Local-first — scroll listener emits scrollSet.
  };

  const onKey = (event: KeyboardEvent) => {
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return;
    }
    const historyDir = historyNavFromKeyboard(event);
    if (historyDir) {
      event.preventDefault();
      event.stopPropagation();
      fireHistoryNav(historyDir);
      return;
    }
    if (isEditableTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
    const tag = tagName(event.target);
    const type =
      tag === 'INPUT' ? (event.target as HTMLInputElement).type : tag === 'BUTTON' ? (event.target as HTMLButtonElement).type : '';
    if (
      event.key === 'Enter'
      && (tag === 'A'
        || (tag === 'BUTTON' && type === 'submit')
        || (tag === 'INPUT' && (type === 'submit' || type === 'image')))
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
    enqueue({
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: event.type === 'keyup' ? 'keyUp' : 'keyDown',
      timestampClient: performance.now(),
      key: event.key,
      code: event.code,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      },
    });
  };

  const onScroll = (event: Event) => {
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return;
    }
    const el = event.target;
    if (el === doc || el === win || (isElement(el) && el === doc.scrollingElement)) {
      if (!win) return;
      const top = win.scrollY || doc.scrollingElement?.scrollTop || 0;
      const left = win.scrollX || doc.scrollingElement?.scrollLeft || 0;
      if (opts.consumeScrollEcho?.('viewport', { top, left })) {
        opts.onProgrammaticScrollSuppress?.('viewport');
        return;
      }
      opts.metrics?.noteScrollCoalesce();
      enqueue({
        schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
        type: 'scrollSet',
        timestampClient: performance.now(),
        contextId: opts.contextId,
        nodeId: null,
        scrollX: left,
        scrollY: top,
      });
      return;
    }
    if (!isElement(el)) return;
    const nodeId = registry.idOfNearest(el);
    if (nodeId == null) {
      opts.metrics?.noteSkip('no_node');
      return;
    }
    const top = el.scrollTop;
    const left = el.scrollLeft;
    if (opts.consumeScrollEcho?.(nodeId, { top, left })) {
      opts.onProgrammaticScrollSuppress?.(nodeId);
      return;
    }
    opts.metrics?.noteScrollCoalesce();
    enqueue({
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: 'scrollSet',
      timestampClient: performance.now(),
      contextId: opts.contextId,
      nodeId,
      scrollX: left,
      scrollY: top,
    });
  };

  // Form PROP dirty — typing is OS keys; still mark dirty for paint honesty.
  const onInput = (event: Event) => {
    if (!opts.isArmed()) return;
    const target = event.target;
    if (!isElement(target)) return;
    const nodeId = registry.idOfNearest(target);
    if (nodeId == null) return;
    opts.onMarkPropDirty?.(nodeId);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && win) {
      const vw = win.innerWidth;
      if (event.clientX <= EDGE_SWIPE_PX) {
        edgeSwipe = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          edge: 'left',
        };
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.clientX >= vw - EDGE_SWIPE_PX) {
        edgeSwipe = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          edge: 'right',
        };
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    onPointerEdge(event, 'down');
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (edgeSwipe && event.pointerId === edgeSwipe.pointerId) {
      const track = edgeSwipe;
      edgeSwipe = null;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - track.startX;
      const dy = event.clientY - track.startY;
      if (Math.abs(dy) > EDGE_SWIPE_MIN_DX * 0.75) return;
      if (track.edge === 'left' && dx >= EDGE_SWIPE_MIN_DX) {
        fireHistoryNav('back');
        return;
      }
      if (track.edge === 'right' && dx <= -EDGE_SWIPE_MIN_DX) {
        fireHistoryNav('forward');
        return;
      }
      return;
    }
    onPointerEdge(event, 'up');
  };

  doc.addEventListener('pointerdown', onPointerDown as EventListener, true);
  doc.addEventListener('pointermove', onPointerMove as EventListener, true);
  doc.addEventListener('pointerup', onPointerUp as EventListener, true);
  doc.addEventListener('click', onClick as EventListener, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('contextmenu', onContextMenu as EventListener, true);
  doc.addEventListener('wheel', onWheel as EventListener, { capture: true, passive: true });
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  doc.addEventListener('keydown', onKey as EventListener, true);
  doc.addEventListener('keyup', onKey as EventListener, true);
  doc.addEventListener('scroll', onScroll, true);
  win?.addEventListener('scroll', onScroll, true);

  return () => {
    buffer.dispose();
    detachHistoryTrap();
    doc.removeEventListener('pointerdown', onPointerDown as EventListener, true);
    doc.removeEventListener('pointermove', onPointerMove as EventListener, true);
    doc.removeEventListener('pointerup', onPointerUp as EventListener, true);
    doc.removeEventListener('click', onClick as EventListener, true);
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('contextmenu', onContextMenu as EventListener, true);
    doc.removeEventListener('wheel', onWheel as EventListener, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('change', onInput, true);
    doc.removeEventListener('keydown', onKey as EventListener, true);
    doc.removeEventListener('keyup', onKey as EventListener, true);
    doc.removeEventListener('scroll', onScroll, true);
    win?.removeEventListener('scroll', onScroll, true);
  };
}

export function attachNestedProjectedInputCapture(
  surface: Element,
  registry: PageProjectionRegistry,
  send: ProjectedIntentSender,
  opts: ProjectedInputCaptureOptions,
): () => void {
  return attachProjectedInputCapture(surface, registry, send, opts);
}
