/**
 * Projected surface input capture — UnifiedIntent (§10.6), sparse-cdp only.
 * Mouse: pointerdown/up → down/up intents. Touch tap: native click → down+up — the
 * platform recognizer handles slop, scroll-cancel, and momentum-arrest suppression.
 * Safe because K5/CSP (script-src 'none') prevents page JS from synthesizing click().
 * local-first scrollSet.
 */

import type { PageProjectionRegistry } from '../registry';
import type { UnifiedIntent } from '../../core/input/unifiedIntentTypes';
import { UNIFIED_INTENT_SCHEMA_VERSION } from '../../core/input/unifiedIntentTypes';
import type { ProjectedInputCaptureMetrics } from './inputCaptureMetrics';
import { ClientBuffer } from './ClientBuffer';
import {
  attachProjectedNativeGuard,
  isProjectedNavigable,
  layoutViewportSize,
} from './projectedNativeGuard';

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
/** Synthetic pointerId for touch click → down+up (touch no longer uses pointer capture). */
const TOUCH_CLICK_POINTER_ID = 1;
/** Navigable touchend fallback — guard suppresses click synthesis on `<a href>`. */
const NAVIGABLE_TAP_SLOP_PX = 8;

type PointerGeometry = {
  nodeId: number;
  localX: number;
  localY: number;
  x: number;
  y: number;
  button: 'left' | 'middle' | 'right';
};

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
  /** Pointers that emitted `down` — iOS Safari often sends `pointercancel` instead of `up`. */
  const pendingPointers = new Set<number>();
  /** Last pointerdown type — click follows mouse pointerup; ignore duplicate click for mouse. */
  let lastPointerType: string | null = null;
  /** Active touch gesture — navigable fallback tracks scroll + slop. */
  let touchGesture: {
    scrolled: boolean;
    startX: number;
    startY: number;
    maxDist: number;
  } | null = null;

  // TEMP-DIAG (descartavel, PP-SCROLL-AXIS iOS) — per-gesture counters read by the
  // touchend record below. Real handlers only increment; no behaviour depends on it.
  const tempDiagState = {
    pointerMoves: 0,
    tapEmitted: false,
    cancelled: false,
    lastScrollAt: 0,
    scrollOrigins: new Map<string, { left: number; top: number }>(),
  };

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
    const vis = layoutViewportSize(rootWin);
    const visW = vis.width;
    const visH = vis.height;
    if (visW <= 0 || visH <= 0) return null;
    const { width: vw, height: vh } = opts.getViewportSize();
    if (vw <= 0 || vh <= 0) return null;
    const sx = x * (vw / visW);
    const sy = y * (vh / visH);
    return { x: Math.min(Math.max(sx, 0), vw - 1e-6), y: Math.min(Math.max(sy, 0), vh - 1e-6) };
  };

  const resolvePointerGeometry = (event: PointerEvent | MouseEvent): PointerGeometry | null => {
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return null;
    }
    const target = event.target;
    if (!target || typeof target !== 'object' || !('nodeType' in target)) {
      opts.metrics?.noteSkip('no_node');
      return null;
    }
    const el = target as Element;
    if (el.nodeType !== 1) {
      opts.metrics?.noteSkip('no_node');
      return null;
    }
    const nodeId = registry.idOf(el);
    if (nodeId == null) {
      opts.metrics?.noteSkip('no_node');
      return null;
    }
    // Local % in the event window's box — before frame-hop to root (same space as clientX/Y).
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      opts.metrics?.noteSkip('no_coords');
      return null;
    }
    const rawLocalX = (event.clientX - box.left) / box.width;
    const rawLocalY = (event.clientY - box.top) / box.height;
    const localX = Math.min(1, Math.max(0, rawLocalX));
    const localY = Math.min(1, Math.max(0, rawLocalY));
    const coords = surfaceCoordsFromClient(event.clientX, event.clientY);
    if (!coords) {
      opts.metrics?.noteSkip('no_coords');
      return null;
    }
    return {
      nodeId,
      localX,
      localY,
      x: coords.x,
      y: coords.y,
      button: buttonFromEvent(event.button),
    };
  };

  const emitPointerEdge = (type: 'down' | 'up', geometry: PointerGeometry, pointerId: number) => {
    const stamp = viewportStamp();
    enqueue({
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type,
      timestampClient: performance.now(),
      ...stamp,
      x: geometry.x,
      y: geometry.y,
      localX: geometry.localX,
      localY: geometry.localY,
      button: geometry.button,
      contextId: opts.contextId,
      nodeId: geometry.nodeId,
    });
    if (type === 'down') pendingPointers.add(pointerId);
    else pendingPointers.delete(pointerId);
  };

  const runPointerEdge = (event: PointerEvent, type: 'down' | 'up') => {
    const geometry = resolvePointerGeometry(event);
    if (!geometry) return;
    emitPointerEdge(type, geometry, event.pointerId);
  };

  const onPointerEdge = (event: PointerEvent, type: 'down' | 'up') => {
    runPointerEdge(event, type);
  };

  const emitTouchTap = (target: EventTarget | null, clientX: number, clientY: number) => {
    const geometry = resolvePointerGeometry({
      target,
      clientX,
      clientY,
      button: 0,
    } as MouseEvent);
    if (!geometry) return false;
    tempDiagState.tapEmitted = true; // TEMP-DIAG
    emitPointerEdge('down', geometry, TOUCH_CLICK_POINTER_ID);
    emitPointerEdge('up', geometry, TOUCH_CLICK_POINTER_ID);
    return true;
  };

  const onClick = (event: MouseEvent) => {
    // Enter/Space on focused control — keyDown/keyUp already forwarded; Virtual activates.
    if (event.detail === 0) return;
    // Mouse pointerdown/up already emitted down+up; click is a duplicate.
    if (lastPointerType !== 'touch') return;
    touchGesture = null;

    if (!emitTouchTap(event.target, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * Navigable `<a href>`: nativeGuard preventDefault on touchend blocks click synthesis.
   * Emit down/up here (before the guard) when the gesture matches a platform tap.
   */
  const beginTouchGesture = (clientX: number, clientY: number) => {
    lastPointerType = 'touch';
    touchGesture = {
      scrolled: false,
      startX: clientX,
      startY: clientY,
      maxDist: 0,
    };
  };

  const trackTouchMove = (clientX: number, clientY: number) => {
    if (!touchGesture) return;
    const dist = Math.hypot(clientX - touchGesture.startX, clientY - touchGesture.startY);
    touchGesture.maxDist = Math.max(touchGesture.maxDist, dist);
  };

  const touchTargetAt = (
    clientX: number,
    clientY: number,
    fallback: EventTarget | null,
  ): EventTarget | null => {
    if (typeof doc.elementFromPoint === 'function') {
      return doc.elementFromPoint(clientX, clientY) ?? fallback;
    }
    return fallback;
  };

  const onTouchStartTrack = (event: TouchEvent) => {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch) return;
    beginTouchGesture(touch.clientX, touch.clientY);
  };

  const onTouchMoveTrack = (event: TouchEvent) => {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) return;
    trackTouchMove(touch.clientX, touch.clientY);
  };

  const onNavigableTouchEnd = (event: TouchEvent) => {
    const gesture = touchGesture;
    touchGesture = null;
    if (lastPointerType !== 'touch' || !gesture) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const target = touchTargetAt(touch.clientX, touch.clientY, event.target);
    if (!isProjectedNavigable(target)) return;
    if (gesture.scrolled) return;
    if (gesture.maxDist > NAVIGABLE_TAP_SLOP_PX) return;
    emitTouchTap(target, touch.clientX, touch.clientY);
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
    if (touchGesture) touchGesture.scrolled = true;
    if (!opts.isArmed()) {
      opts.metrics?.noteSkip('disarmed');
      return;
    }
    const el = event.target;
    if (el === doc || el === win || (isElement(el) && el === doc.scrollingElement)) {
      if (!win) return;
      const se = doc.scrollingElement as HTMLElement | null;
      const top = win.scrollY || se?.scrollTop || 0;
      const left = win.scrollX || se?.scrollLeft || 0;
      const rangeY = se ? se.scrollHeight - se.clientHeight : 0;
      const rangeX = se ? se.scrollWidth - se.clientWidth : 0;
      if (rangeY === 0 && rangeX === 0) return;
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
        scrollFracX: rangeX === 0 ? 0 : left / rangeX,
        scrollFracY: rangeY === 0 ? 0 : top / rangeY,
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
    const rangeY = el.scrollHeight - el.clientHeight;
    const rangeX = el.scrollWidth - el.clientWidth;
    if (rangeY === 0 && rangeX === 0) return;
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
      scrollFracX: rangeX === 0 ? 0 : left / rangeX,
      scrollFracY: rangeY === 0 ? 0 : top / rangeY,
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

  const pointerOpts: AddEventListenerOptions = { capture: true, passive: false };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && win) {
      const rootWin = opts.getRootWindow?.() ?? win;
      const vw = layoutViewportSize(rootWin).width;
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
      lastPointerType = 'touch';
      beginTouchGesture(event.clientX, event.clientY);
      return;
    }
    lastPointerType = event.pointerType;
    touchGesture = null;
    onPointerEdge(event, 'down');
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      tempDiagState.pointerMoves += 1; // TEMP-DIAG
      trackTouchMove(event.clientX, event.clientY);
    }
    if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const clearEdgeSwipe = (event: PointerEvent) => {
    if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId) return false;
    edgeSwipe = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const finishPendingPointer = (event: PointerEvent) => {
    if (!pendingPointers.delete(event.pointerId)) return;
    runPointerEdge(event, 'up');
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
    if (event.pointerType === 'touch') return;
    onPointerEdge(event, 'up');
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (clearEdgeSwipe(event)) return;
    if (event.pointerType === 'touch') return;
    finishPendingPointer(event);
  };

  const onLostPointerCapture = (event: PointerEvent) => {
    if (edgeSwipe?.pointerId === event.pointerId) {
      edgeSwipe = null;
      return;
    }
    finishPendingPointer(event);
  };

  doc.addEventListener('pointerdown', onPointerDown as EventListener, pointerOpts);
  doc.addEventListener('pointermove', onPointerMove as EventListener, pointerOpts);
  doc.addEventListener('pointerup', onPointerUp as EventListener, pointerOpts);
  doc.addEventListener('pointercancel', onPointerCancel as EventListener, pointerOpts);
  doc.addEventListener('lostpointercapture', onLostPointerCapture as EventListener, pointerOpts);
  const navigableTouchEndOpts: AddEventListenerOptions = { capture: true, passive: false };
  const touchTrackOpts: AddEventListenerOptions = { capture: true, passive: true };
  doc.addEventListener('touchstart', onTouchStartTrack as EventListener, touchTrackOpts);
  doc.addEventListener('touchmove', onTouchMoveTrack as EventListener, touchTrackOpts);
  doc.addEventListener('touchend', onNavigableTouchEnd as EventListener, navigableTouchEndOpts);
  const detachNativeGuard = attachProjectedNativeGuard(doc, {
    onTouchStartSeen: () => opts.metrics?.noteTouchStartSeen(),
  });
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

  // TEMP-DIAG — scroll axis (manual device gestures). Read: projected iframe console → filter [TEMP-DIAG]
  type TempDiagTouch = {
    id: number;
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    /** Max path displacement (what a path-based slop test would see). */
    maxDist: number;
    moves: number;
    preventedMoves: number;
    /** ms between the previous scroll event and this touchstart (momentum-arrest tap). */
    msSincePrevScroll: number | null;
    /** Per-element scroll consumed during this gesture — the axis-lock answer. */
    scrolled: Record<string, { dLeft: number; dTop: number }>;
    /** Hit element -> <html>, with touch-action/overflow/scroll range per level. */
    chain: Record<string, unknown>[];
    viewport: Record<string, unknown> | null;
    t0: number;
  };
  let tempDiagTouch: TempDiagTouch | null = null;
  const tempDiagLog: unknown[] = [];
  const tempDiagTag = (el: Element) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return `${el.tagName}${id}${cls ? `.${cls}` : ''}`.slice(0, 60);
  };

  /**
   * Ancestor chain from the gesture's hit element to <html>, with everything that
   * decides which box the engine latches a pan to. Read once at touchstart.
   */
  const tempDiagChain = (x: number, y: number) => {
    const rows: Record<string, unknown>[] = [];
    let el = doc.elementFromPoint(x, y) as Element | null;
    let depth = 0;
    while (el && depth < 24) {
      const he = el as HTMLElement;
      const cs = win?.getComputedStyle(he);
      rows.push({
        depth,
        tag: tempDiagTag(el),
        touchAction: cs?.touchAction ?? null,
        overflowX: cs?.overflowX ?? null,
        overflowY: cs?.overflowY ?? null,
        overscrollX: cs?.overscrollBehaviorX ?? null,
        overscrollY: cs?.overscrollBehaviorY ?? null,
        rangeX: he.scrollWidth - he.clientWidth,
        rangeY: he.scrollHeight - he.clientHeight,
      });
      el = el.parentElement;
      depth += 1;
    }
    return rows;
  };

  /** Layout vs visual viewport — a mismatch here skews every mapped coordinate. */
  const tempDiagViewport = () => {
    if (!win) return null;
    const de = doc.documentElement;
    const vv = (win as Window & { visualViewport?: VisualViewport }).visualViewport;
    return {
      clientW: de?.clientWidth ?? 0,
      clientH: de?.clientHeight ?? 0,
      innerW: win.innerWidth,
      innerH: win.innerHeight,
      visualW: vv?.width ?? null,
      visualH: vv?.height ?? null,
      visualScale: vv?.scale ?? null,
      dpr: win.devicePixelRatio,
      surfaceW: opts.getViewportSize().width,
      surfaceH: opts.getViewportSize().height,
    };
  };
  const tempDiagLabel = () =>
    (win as Window & { __SCROLL_DIAG_LABEL?: string }).__SCROLL_DIAG_LABEL ?? null;

  const tempDiagOnTouchStart = (event: TouchEvent) => {
    const t = event.changedTouches[0];
    if (!t) return;
    tempDiagTouch = {
      id: t.identifier,
      x0: t.clientX,
      y0: t.clientY,
      dx: 0,
      dy: 0,
      maxDist: 0,
      moves: 0,
      preventedMoves: 0,
      msSincePrevScroll:
        tempDiagState.lastScrollAt === 0
          ? null
          : Math.round(performance.now() - tempDiagState.lastScrollAt),
      scrolled: {},
      chain: tempDiagChain(t.clientX, t.clientY),
      viewport: tempDiagViewport(),
      t0: performance.now(),
    };
    tempDiagState.pointerMoves = 0;
    tempDiagState.tapEmitted = false;
    tempDiagState.cancelled = false;
    tempDiagState.scrollOrigins.clear();
  };

  const tempDiagOnTouchMove = (event: TouchEvent) => {
    if (!tempDiagTouch) return;
    const t =
      Array.from(event.changedTouches).find((c) => c.identifier === tempDiagTouch!.id) ??
      event.touches[0];
    if (!t) return;
    tempDiagTouch.dx = t.clientX - tempDiagTouch.x0;
    tempDiagTouch.dy = t.clientY - tempDiagTouch.y0;
    tempDiagTouch.maxDist = Math.max(
      tempDiagTouch.maxDist,
      Math.hypot(tempDiagTouch.dx, tempDiagTouch.dy),
    );
    tempDiagTouch.moves += 1;
    if (event.defaultPrevented) tempDiagTouch.preventedMoves += 1;
  };

  const tempDiagEmitGesture = (event: TouchEvent, ended: 'touchend' | 'touchcancel') => {
    if (!tempDiagTouch) return;
    const rec = {
      phase: 'gesture',
      ended,
      ...tempDiagTouch,
      dx: Math.round(tempDiagTouch.dx),
      dy: Math.round(tempDiagTouch.dy),
      maxDist: Math.round(tempDiagTouch.maxDist),
      /** Endpoint displacement — what a slop test would compare. */
      endDist: Math.round(Math.hypot(tempDiagTouch.dx, tempDiagTouch.dy)),
      touchMoves: tempDiagTouch.moves,
      pointerMoves: tempDiagState.pointerMoves,
      tapEmitted: tempDiagState.tapEmitted,
      pointerCancelled: tempDiagState.cancelled,
      durationMs: Math.round(performance.now() - tempDiagTouch.t0),
      docUrl: (() => {
        try {
          return win?.location.href ?? null;
        } catch {
          return null;
        }
      })(),
      defaultPrevented: event.defaultPrevented,
      label: tempDiagLabel(),
    };
    tempDiagLog.push(rec);
    console.log('[TEMP-DIAG gesture]', JSON.stringify(rec));
    tempDiagTouch = null;
  };

  const tempDiagOnTouchEnd = (event: TouchEvent) => tempDiagEmitGesture(event, 'touchend');
  const tempDiagOnTouchCancel = (event: TouchEvent) => tempDiagEmitGesture(event, 'touchcancel');

  const tempDiagOnScroll = (event: Event) => {
    const t = event.target;
    if (!t || typeof t !== 'object') return;
    const el = (
      'tagName' in t ? (t as HTMLElement) : (doc.scrollingElement as HTMLElement | null)
    );
    if (!el) return;
    tempDiagState.lastScrollAt = performance.now();
    if (!tempDiagTouch) return;
    const key = tempDiagTag(el);
    const origin = tempDiagState.scrollOrigins.get(key);
    if (!origin) {
      tempDiagState.scrollOrigins.set(key, { left: el.scrollLeft, top: el.scrollTop });
      tempDiagTouch.scrolled[key] = { dLeft: 0, dTop: 0 };
      return;
    }
    tempDiagTouch.scrolled[key] = {
      dLeft: Math.round(el.scrollLeft - origin.left),
      dTop: Math.round(el.scrollTop - origin.top),
    };
  };

  const tempDiagOnPointerCancel = (event: PointerEvent) => {
    if (event.pointerType === 'touch') tempDiagState.cancelled = true;
  };

  const tempDiagOpts = { capture: true, passive: true as const };
  doc.addEventListener('touchstart', tempDiagOnTouchStart, tempDiagOpts);
  doc.addEventListener('touchmove', tempDiagOnTouchMove, tempDiagOpts);
  doc.addEventListener('touchend', tempDiagOnTouchEnd, tempDiagOpts);
  doc.addEventListener('touchcancel', tempDiagOnTouchCancel, tempDiagOpts);
  doc.addEventListener('scroll', tempDiagOnScroll, tempDiagOpts);
  doc.addEventListener('pointercancel', tempDiagOnPointerCancel, tempDiagOpts);
  if (win) {
    (win as Window & { __SCROLL_DIAG_LOG?: unknown[]; __SCROLL_DIAG_CLEAR?: () => void }).__SCROLL_DIAG_LOG =
      tempDiagLog;
    (win as Window & { __SCROLL_DIAG_CLEAR?: () => void }).__SCROLL_DIAG_CLEAR = () => {
      tempDiagLog.length = 0;
      tempDiagTouch = null;
    };
  }

  return () => {
    buffer.dispose();
    detachHistoryTrap();
    doc.removeEventListener('pointerdown', onPointerDown as EventListener, pointerOpts);
    doc.removeEventListener('pointermove', onPointerMove as EventListener, pointerOpts);
    doc.removeEventListener('pointerup', onPointerUp as EventListener, pointerOpts);
    doc.removeEventListener('pointercancel', onPointerCancel as EventListener, pointerOpts);
    doc.removeEventListener('lostpointercapture', onLostPointerCapture as EventListener, pointerOpts);
    doc.removeEventListener('touchstart', onTouchStartTrack as EventListener, touchTrackOpts);
    doc.removeEventListener('touchmove', onTouchMoveTrack as EventListener, touchTrackOpts);
    doc.removeEventListener('touchend', onNavigableTouchEnd as EventListener, navigableTouchEndOpts);
    detachNativeGuard();
    pendingPointers.clear();
    touchGesture = null;
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
    // TEMP-DIAG teardown
    doc.removeEventListener('touchstart', tempDiagOnTouchStart, tempDiagOpts);
    doc.removeEventListener('touchmove', tempDiagOnTouchMove, tempDiagOpts);
    doc.removeEventListener('touchend', tempDiagOnTouchEnd, tempDiagOpts);
    doc.removeEventListener('touchcancel', tempDiagOnTouchCancel, tempDiagOpts);
    doc.removeEventListener('scroll', tempDiagOnScroll, tempDiagOpts);
    doc.removeEventListener('pointercancel', tempDiagOnPointerCancel, tempDiagOpts);
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
