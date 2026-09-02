/**
 * PP-SCROLL-AXIS — one automated round, computed verdict.
 * Surfaces A (projected) / B (projected + skip touch-capture) / C (raw fixture).
 * Gestures G1 (vertical on #hscroller) / G2 (vertical on #plaintext) / G3 (horizontal on #hscroller).
 *
 * Does not modify product capture; only reads/sets the existing
 * `__SCROLL_DIAG_SKIP_TOUCH_CAPTURE__` window flag on surface B.
 */

import { chromium, type Browser, type CDPSession, type Page } from 'patchright';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { DossierHandle } from '../dossier/write';
import { writeJson } from '../dossier/write';

export type TouchScrollAxisVerdictCode =
  | 'VOID'
  | 'CONFIRMED_TOUCH_CAPTURE'
  | 'CONFIRMED_CLIENT_OTHER'
  | 'CONFIRMED_NAVIGABLE_GUARD'
  | 'NOT_REPRODUCED';

export type TouchScrollAxisSurface = 'A' | 'B' | 'C';
export type TouchScrollAxisGesture = 'G1' | 'G2' | 'G3';
export type TouchScrollAxisVariant = 'V1' | 'V2' | 'V3' | 'V4';
export type TouchScrollAxisMatrixMode = 'r1' | 'navigable';

export type TouchEventNote = {
  type: string;
  cancelable: boolean;
  defaultPrevented: boolean;
};

export type ScrollSnapshot = {
  docScrollY: number;
  docScrollTop: number;
  hScrollLeft: number;
  hScrollTop: number;
  hostScrollY: number;
  hScrollWidth: number;
  hClientWidth: number;
  hScrollHeight: number;
  hClientHeight: number;
};

export type CellRecord = {
  surface: TouchScrollAxisSurface;
  gesture: TouchScrollAxisGesture;
  /** Round-2 navigable matrix only; absent on r1 cells. */
  variant?: TouchScrollAxisVariant;
  maxTouchPoints: number;
  before: ScrollSnapshot;
  after: ScrollSnapshot;
  deltaDocScrollY: number;
  deltaHScrollLeft: number;
  deltaHScrollTop: number;
  deltaHostScrollY: number;
  pageRolled: boolean;
  hScrollerRolledX: boolean;
  touchStarts: TouchEventNote[];
  touchMoves: TouchEventNote[];
  /** First touchstart.cancelable (explicit round-2 field). */
  touchstartCancelable: boolean | null;
  /** First touchstart.defaultPrevented (explicit round-2 field). */
  touchstartDefaultPrevented: boolean | null;
  /** closest('a[href]') href at gesture start via elementFromPoint, or null. */
  hitClosestHref: string | null;
  hitTagName: string | null;
  pointerCancelCount: number;
  touchCancelCount: number;
  scrollEventsByNode: Record<string, number>;
  voidReason?: string;
};

export type TouchScrollAxisDiagnostic = {
  capturedAt: string;
  matrixMode: TouchScrollAxisMatrixMode;
  fixtureUrl: string;
  scrollerSelector: string;
  plaintextSelector: string;
  surfaceHost: { width: number; height: number; x: number; y: number } | null;
  controlViewport: { width: number; height: number } | null;
  cells: CellRecord[];
  verdict: TouchScrollAxisVerdictCode;
  voidReasons: string[];
  hypothesis: string[];
};

const MOVE_STEPS = 12;
const STEP_PX = 10;
const STEP_MS = 16;
const SETTLE_MS = 400;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function expandProjectedSurface(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hud = document.getElementById('surfaceHud');
    if (hud && hud.dataset.collapsed !== 'true') {
      const toggle = document.getElementById('hudToggle') as HTMLButtonElement | null;
      toggle?.click();
    }
    const sheet = document.getElementById('investigationSheet');
    if (sheet) sheet.dataset.snap = 'collapsed';
    const main = document.getElementById('labMain');
    if (main) main.style.setProperty('--sheet-h', '48px');
  });
  await wait(200);
}

async function pickProjectedPageBySurfaceHost(browser: Browser): Promise<Page | null> {
  const pages = browser.contexts().flatMap((c) => c.pages());
  for (const page of pages) {
    try {
      const has = await page.evaluate(() => !!document.getElementById('surfaceHost'));
      if (has) return page;
    } catch {
      /* detached / cross-origin */
    }
  }
  return null;
}

async function surfaceHostRect(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  return page.evaluate(() => {
    const host = document.getElementById('surfaceHost');
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** Projected document lives in the surface iframe; C uses the page document. */
async function measureScroll(
  page: Page,
  mode: 'projected' | 'control',
  scrollerSelector: string,
): Promise<ScrollSnapshot> {
  return page.evaluate(
    ({ mode, scrollerSelector }) => {
      const hostScrollY = window.scrollY || document.scrollingElement?.scrollTop || 0;
      let doc: Document = document;
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        const nested = iframe?.contentDocument;
        if (!nested) {
          return {
            docScrollY: 0,
            docScrollTop: 0,
            hScrollLeft: 0,
            hScrollTop: 0,
            hostScrollY,
            hScrollWidth: 0,
            hClientWidth: 0,
            hScrollHeight: 0,
            hClientHeight: 0,
          };
        }
        doc = nested;
      }
      const win = doc.defaultView;
      const se = doc.scrollingElement;
      const h = doc.querySelector(scrollerSelector) as HTMLElement | null;
      return {
        docScrollY: win?.scrollY || se?.scrollTop || 0,
        docScrollTop: se?.scrollTop || 0,
        hScrollLeft: h?.scrollLeft ?? 0,
        hScrollTop: h?.scrollTop ?? 0,
        hostScrollY,
        hScrollWidth: h?.scrollWidth ?? 0,
        hClientWidth: h?.clientWidth ?? 0,
        hScrollHeight: h?.scrollHeight ?? 0,
        hClientHeight: h?.clientHeight ?? 0,
      };
    },
    { mode, scrollerSelector },
  );
}

async function resetScrollers(
  page: Page,
  mode: 'projected' | 'control',
  scrollerSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ mode, scrollerSelector }) => {
      const apply = (doc: Document) => {
        const se = doc.scrollingElement as HTMLElement | null;
        if (se) {
          se.scrollTop = 0;
          se.scrollLeft = 0;
        }
        doc.defaultView?.scrollTo(0, 0);
        for (const h of Array.from(doc.querySelectorAll('.hscroller, #hscroller'))) {
          (h as HTMLElement).scrollTop = 0;
          (h as HTMLElement).scrollLeft = 0;
        }
        const one = doc.querySelector(scrollerSelector) as HTMLElement | null;
        if (one) {
          one.scrollTop = 0;
          one.scrollLeft = 0;
        }
      };
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        if (iframe?.contentDocument) apply(iframe.contentDocument);
        window.scrollTo(0, 0);
        return;
      }
      apply(document);
    },
    { mode, scrollerSelector },
  );
  await wait(80);
}

/** Bring the cell's scroller into the visible iframe/page viewport (V2–V4 sit below the fold). */
async function ensureTargetInView(
  page: Page,
  mode: 'projected' | 'control',
  scrollerOrPlainSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ mode, scrollerOrPlainSelector }) => {
      const bring = (doc: Document) => {
        const el = doc.querySelector(scrollerOrPlainSelector) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      };
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        if (iframe?.contentDocument) bring(iframe.contentDocument);
        return;
      }
      bring(document);
    },
    { mode, scrollerOrPlainSelector },
  );
  await wait(120);
}

async function setSkipTouchCapture(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((on) => {
    const host = document.getElementById('surfaceHost');
    const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
    const w = iframe?.contentWindow as (Window & { __SCROLL_DIAG_SKIP_TOUCH_CAPTURE__?: boolean }) | null;
    if (!w) throw new Error('projected_iframe_missing');
    if (on) w.__SCROLL_DIAG_SKIP_TOUCH_CAPTURE__ = true;
    else delete w.__SCROLL_DIAG_SKIP_TOUCH_CAPTURE__;
  }, enabled);
}

type HitMode = 'plaintext' | 'tile' | 'link' | 'gap' | 'img';

async function targetPointTopPage(
  page: Page,
  mode: 'projected' | 'control',
  scrollerOrPlainSelector: string,
  hitMode: HitMode,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ mode, scrollerOrPlainSelector, hitMode }) => {
      const inBox = (
        x: number,
        y: number,
        box: { left: number; top: number; right: number; bottom: number },
      ) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

      const pointInDoc = (
        doc: Document,
        origin: { left: number; top: number; right: number; bottom: number },
      ): { x: number; y: number } | null => {
        if (hitMode === 'plaintext') {
          const el = doc.querySelector(scrollerOrPlainSelector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return null;
          const x = origin.left + r.left + r.width / 2;
          const y = origin.top + r.top + Math.min(24, r.height / 2);
          return inBox(x, y, origin) ? { x, y } : null;
        }
        const scroller = doc.querySelector(scrollerOrPlainSelector) as HTMLElement | null;
        if (!scroller) return null;
        if (hitMode === 'tile') {
          const tile = scroller.querySelector('[data-tile="0"]') as HTMLElement | null;
          if (!tile) return null;
          const r = tile.getBoundingClientRect();
          const x = origin.left + r.left + r.width / 2;
          const y = origin.top + r.top + r.height / 2;
          return inBox(x, y, origin) ? { x, y } : null;
        }
        if (hitMode === 'link') {
          const a = scroller.querySelector('a[href][data-tile="0"]') as HTMLElement | null;
          if (!a) return null;
          const r = a.getBoundingClientRect();
          const x = origin.left + r.left + r.width / 2;
          const y = origin.top + r.top + r.height / 2;
          return inBox(x, y, origin) ? { x, y } : null;
        }
        if (hitMode === 'gap') {
          const a0 = scroller.querySelector('a[href][data-tile="0"]') as HTMLElement | null;
          const a1 = scroller.querySelector('a[href][data-tile="1"]') as HTMLElement | null;
          if (!a0 || !a1) return null;
          const r0 = a0.getBoundingClientRect();
          const r1 = a1.getBoundingClientRect();
          const x = origin.left + (r0.right + r1.left) / 2;
          const y = origin.top + r0.top + r0.height / 2;
          return inBox(x, y, origin) ? { x, y } : null;
        }
        // img
        const img = scroller.querySelector('a[href][data-tile="0"] img') as HTMLElement | null;
        if (!img) return null;
        const r = img.getBoundingClientRect();
        const x = origin.left + r.left + r.width / 2;
        const y = origin.top + r.top + r.height / 2;
        return inBox(x, y, origin) ? { x, y } : null;
      };

      if (mode === 'control') {
        return pointInDoc(document, {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        });
      }
      const host = document.getElementById('surfaceHost');
      if (!host) return null;
      const iframe = host.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe?.contentDocument) return null;
      const iframeR = iframe.getBoundingClientRect();
      return pointInDoc(iframe.contentDocument, iframeR);
    },
    { mode, scrollerOrPlainSelector, hitMode },
  );
}

/** elementFromPoint at gesture start — reports closest('a[href]'). */
async function hitAtTopPoint(
  page: Page,
  mode: 'projected' | 'control',
  point: { x: number; y: number },
): Promise<{ hitTagName: string | null; hitClosestHref: string | null }> {
  return page.evaluate(
    ({ mode, point }) => {
      let doc: Document = document;
      let x = point.x;
      let y = point.y;
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        if (!iframe?.contentDocument) return { hitTagName: null, hitClosestHref: null };
        const iframeR = iframe.getBoundingClientRect();
        doc = iframe.contentDocument;
        x = point.x - iframeR.left;
        y = point.y - iframeR.top;
      }
      const el = doc.elementFromPoint(x, y);
      if (!el || !(el instanceof Element)) return { hitTagName: null, hitClosestHref: null };
      const a = el.closest('a[href]');
      return {
        hitTagName: el.tagName,
        hitClosestHref: a ? a.getAttribute('href') : null,
      };
    },
    { mode, point },
  );
}

type ListenerBag = {
  touchStarts: TouchEventNote[];
  touchMoves: TouchEventNote[];
  pointerCancelCount: number;
  touchCancelCount: number;
  scrollEventsByNode: Record<string, number>;
};

async function installListeners(
  page: Page,
  mode: 'projected' | 'control',
  scrollerSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ mode, scrollerSelector }) => {
      type Bag = {
        touchStarts: { type: string; cancelable: boolean; defaultPrevented: boolean }[];
        touchMoves: { type: string; cancelable: boolean; defaultPrevented: boolean }[];
        pointerCancelCount: number;
        touchCancelCount: number;
        scrollEventsByNode: Record<string, number>;
        cleanup: () => void;
      };
      const g = globalThis as typeof globalThis & { __touchScrollAxisBag?: Bag };
      g.__touchScrollAxisBag?.cleanup?.();

      let doc: Document = document;
      let win: Window = window;
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        if (!iframe?.contentDocument || !iframe.contentWindow) {
          throw new Error('projected_iframe_missing');
        }
        doc = iframe.contentDocument;
        win = iframe.contentWindow;
      }

      const bag: Bag = {
        touchStarts: [],
        touchMoves: [],
        pointerCancelCount: 0,
        touchCancelCount: 0,
        scrollEventsByNode: {},
        cleanup: () => undefined,
      };

      const onTouchStart = (ev: TouchEvent) => {
        bag.touchStarts.push({
          type: 'touchstart',
          cancelable: ev.cancelable,
          defaultPrevented: ev.defaultPrevented,
        });
      };
      const onTouchMove = (ev: TouchEvent) => {
        bag.touchMoves.push({
          type: 'touchmove',
          cancelable: ev.cancelable,
          defaultPrevented: ev.defaultPrevented,
        });
      };
      const onTouchCancel = () => {
        bag.touchCancelCount += 1;
      };
      const onPointerCancel = () => {
        bag.pointerCancelCount += 1;
      };
      const onScroll = (ev: Event) => {
        const t = ev.target;
        let key = 'unknown';
        if (t === doc || t === win || (t as Node) === doc.scrollingElement) key = 'document';
        else if (t instanceof Element) {
          if (t.id) key = `#${t.id}`;
          else key = t.tagName.toLowerCase();
        }
        bag.scrollEventsByNode[key] = (bag.scrollEventsByNode[key] ?? 0) + 1;
      };

      // Capture phase, registered after projectedNativeGuard: sees defaultPrevented after
      // suppressProjectedDefault (which also stopPropagation — bubble would miss the event).
      doc.addEventListener('touchstart', onTouchStart, true);
      doc.addEventListener('touchmove', onTouchMove, true);
      doc.addEventListener('touchcancel', onTouchCancel, true);
      doc.addEventListener('pointercancel', onPointerCancel, true);
      doc.addEventListener('scroll', onScroll, true);
      win.addEventListener('scroll', onScroll, true);
      // Also listen on host page for wrong-document scroll (projected cells).
      if (mode === 'projected') {
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('scroll', onScroll, true);
      }

      bag.cleanup = () => {
        doc.removeEventListener('touchstart', onTouchStart, true);
        doc.removeEventListener('touchmove', onTouchMove, true);
        doc.removeEventListener('touchcancel', onTouchCancel, true);
        doc.removeEventListener('pointercancel', onPointerCancel, true);
        doc.removeEventListener('scroll', onScroll, true);
        win.removeEventListener('scroll', onScroll, true);
        if (mode === 'projected') {
          document.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('scroll', onScroll, true);
        }
        delete g.__touchScrollAxisBag;
      };
      g.__touchScrollAxisBag = bag;
      void scrollerSelector;
    },
    { mode, scrollerSelector },
  );
}

async function readListeners(page: Page): Promise<ListenerBag> {
  return page.evaluate(() => {
    const g = globalThis as typeof globalThis & {
      __touchScrollAxisBag?: {
        touchStarts: TouchEventNote[];
        touchMoves: TouchEventNote[];
        pointerCancelCount: number;
        touchCancelCount: number;
        scrollEventsByNode: Record<string, number>;
      };
    };
    const bag = g.__touchScrollAxisBag;
    if (!bag) {
      return {
        touchStarts: [],
        touchMoves: [],
        pointerCancelCount: 0,
        touchCancelCount: 0,
        scrollEventsByNode: {},
      };
    }
    return {
      touchStarts: bag.touchStarts.slice(),
      touchMoves: bag.touchMoves.slice(),
      pointerCancelCount: bag.pointerCancelCount,
      touchCancelCount: bag.touchCancelCount,
      scrollEventsByNode: { ...bag.scrollEventsByNode },
    };
  });
}

async function removeListeners(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as typeof globalThis & {
      __touchScrollAxisBag?: { cleanup: () => void };
    };
    g.__touchScrollAxisBag?.cleanup?.();
  });
}

async function enableTouch(cdp: CDPSession): Promise<void> {
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
}

async function readMaxTouchPoints(page: Page, mode: 'projected' | 'control'): Promise<number> {
  return page.evaluate((mode) => {
    if (mode === 'control') return navigator.maxTouchPoints;
    const host = document.getElementById('surfaceHost');
    const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
    const w = iframe?.contentWindow;
    return w?.navigator.maxTouchPoints ?? navigator.maxTouchPoints;
  }, mode);
}

async function dispatchSwipe(
  cdp: CDPSession,
  start: { x: number; y: number },
  axis: 'vertical' | 'horizontal',
): Promise<void> {
  const point = { x: start.x, y: start.y, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  for (let i = 1; i <= MOVE_STEPS; i++) {
    await wait(STEP_MS);
    // First step already exceeds typical touch slop (~10px) on the chosen axis only.
    const dx = axis === 'horizontal' ? -STEP_PX * i : 0;
    const dy = axis === 'vertical' ? -STEP_PX * i : 0;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + dx, y: start.y + dy, id: 1 }],
    });
  }
  await wait(STEP_MS);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

function computeVerdict(cells: CellRecord[], voidReasons: string[]): TouchScrollAxisVerdictCode {
  if (voidReasons.length > 0) return 'VOID';

  const find = (s: TouchScrollAxisSurface, g: TouchScrollAxisGesture) =>
    cells.find((c) => c.surface === s && c.gesture === g);

  const aG1 = find('A', 'G1');
  const bG1 = find('B', 'G1');
  const cG1 = find('C', 'G1');
  const aG2 = find('A', 'G2');
  const g3any = cells.filter((c) => c.gesture === 'G3');

  if (!cG1?.pageRolled) {
    voidReasons.push('C.G1_page_did_not_roll');
    return 'VOID';
  }
  if (!aG2?.pageRolled) {
    voidReasons.push('A.G2_page_did_not_roll');
    return 'VOID';
  }
  if (!g3any.some((c) => c.hScrollerRolledX)) {
    voidReasons.push('G3_hscroller_did_not_roll_x_on_any_surface');
    return 'VOID';
  }

  if (aG1?.pageRolled) return 'NOT_REPRODUCED';
  if (cG1.pageRolled && !aG1?.pageRolled && bG1?.pageRolled) return 'CONFIRMED_TOUCH_CAPTURE';
  if (cG1.pageRolled && !aG1?.pageRolled && !bG1?.pageRolled) return 'CONFIRMED_CLIENT_OTHER';

  voidReasons.push('unclassified_matrix');
  return 'VOID';
}

/** Round 2 — 4 variants × A/B/C × G1 (navigable-guard hypothesis). */
function computeVerdictNavigable(
  cells: CellRecord[],
  voidReasons: string[],
): TouchScrollAxisVerdictCode {
  if (voidReasons.length > 0) return 'VOID';

  const cell = (v: TouchScrollAxisVariant, s: TouchScrollAxisSurface) =>
    cells.find((c) => c.variant === v && c.surface === s && c.gesture === 'G1');

  const v1A = cell('V1', 'A');
  const v1C = cell('V1', 'C');

  // Same instrument bars as r1, mapped onto V1: projected page can roll; raw C can roll.
  if (!v1C?.pageRolled) {
    voidReasons.push('V1.C_page_did_not_roll');
    return 'VOID';
  }
  if (!v1A?.pageRolled) {
    voidReasons.push('V1.A_page_did_not_roll');
    return 'VOID';
  }

  const guardHit = (v: 'V2' | 'V4'): boolean => {
    const a = cell(v, 'A');
    const c = cell(v, 'C');
    return (
      !!c?.pageRolled &&
      !a?.pageRolled &&
      a?.touchstartDefaultPrevented === true &&
      !!v1A.pageRolled
    );
  };

  if (guardHit('V2') || guardHit('V4')) return 'CONFIRMED_NAVIGABLE_GUARD';

  const stuckNoPrevent = (['V1', 'V2', 'V3', 'V4'] as TouchScrollAxisVariant[]).some((v) => {
    const a = cell(v, 'A');
    const c = cell(v, 'C');
    return !!c?.pageRolled && !a?.pageRolled && a?.touchstartDefaultPrevented === false;
  });
  if (stuckNoPrevent) return 'CONFIRMED_CLIENT_OTHER';

  const allARoll = (['V1', 'V2', 'V3', 'V4'] as TouchScrollAxisVariant[]).every(
    (v) => cell(v, 'A')?.pageRolled,
  );
  if (allARoll) return 'NOT_REPRODUCED';

  voidReasons.push('unclassified_navigable_matrix');
  return 'VOID';
}

export function foldTouchScrollAxis(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { touchScrollAxis?: TouchScrollAxisDiagnostic }).touchScrollAxis;
  if (!diag) {
    return [{ id: 'touchScrollAxis', status: 'fail', reason: 'probe_missing' }];
  }
  const code = diag.verdict;
  if (code === 'VOID') {
    return [
      {
        id: 'touchScrollAxis',
        status: 'fail',
        reason: `VOID: ${diag.voidReasons.join('; ') || 'instrument_broken'}`,
      },
    ];
  }
  return [
    {
      id: 'touchScrollAxis',
      status: 'pass',
      reason: `${code}: ${diag.hypothesis[0] ?? code}`,
    },
  ];
}

export async function runTouchScrollAxisProbe(opts: {
  chassis: LabChassis;
  dossier?: DossierHandle | null;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
  /** Absolute or host-relative fixture URL for control page (and default boot). */
  fixtureUrl?: string;
  scrollerSelector?: string;
  plaintextSelector?: string;
  /** r1 = original 9-cell matrix; navigable = V1–V4 × A/B/C × G1. */
  matrixMode?: TouchScrollAxisMatrixMode;
}): Promise<TouchScrollAxisDiagnostic> {
  const voidReasons: string[] = [];
  const matrixMode: TouchScrollAxisMatrixMode = opts.matrixMode === 'navigable' ? 'navigable' : 'r1';
  const scrollerSelector = opts.scrollerSelector ?? '#hscroller';
  const plaintextSelector = opts.plaintextSelector ?? '#plaintext';
  const labOrigin = (opts.labOrigin ?? 'http://127.0.0.1:4077').replace(/\/$/, '');
  const fixtureUrl =
    opts.fixtureUrl ??
    `${labOrigin}/fixtures/touch-scroll-axis.html`;

  const empty: TouchScrollAxisDiagnostic = {
    capturedAt: new Date().toISOString(),
    matrixMode,
    fixtureUrl,
    scrollerSelector,
    plaintextSelector,
    surfaceHost: null,
    controlViewport: null,
    cells: [],
    verdict: 'VOID',
    voidReasons: [],
    hypothesis: [],
  };

  const cdpUrl = (opts.projectedCdpUrl ?? '').trim();
  if (!cdpUrl) {
    empty.voidReasons = ['no_projected_cdp_url'];
    empty.verdict = 'VOID';
    empty.hypothesis = ['VOID: projectedCdpUrl empty — never silent skip'];
    return empty;
  }

  let browser: Browser | null = null;
  let controlPage: Page | null = null;
  const cells: CellRecord[] = [];

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const projected = await pickProjectedPageBySurfaceHost(browser);
    if (!projected) {
      empty.voidReasons = ['no_projected_page_with_surfaceHost'];
      empty.verdict = 'VOID';
      empty.hypothesis = ['VOID: no tab with #surfaceHost'];
      return empty;
    }

    // Collapse lab chrome so #surfaceHost is large enough for page scroll + hit targets.
    await expandProjectedSurface(projected);

    const hostRect = await surfaceHostRect(projected);
    if (!hostRect || hostRect.width < 1 || hostRect.height < 1) {
      empty.voidReasons = ['surfaceHost_rect_invalid'];
      empty.verdict = 'VOID';
      empty.hypothesis = ['VOID: #surfaceHost missing or zero size'];
      return empty;
    }
    empty.surfaceHost = hostRect;

    const ctx = projected.context();
    controlPage = await ctx.newPage();
    await controlPage.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const control = controlPage;

    const controlCdp = await ctx.newCDPSession(control);
    await controlCdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(hostRect.width),
      height: Math.round(hostRect.height),
      deviceScaleFactor: 1,
      mobile: true,
    });
    await wait(100);
    const controlInner = await control.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    empty.controlViewport = controlInner;
    if (
      controlInner.width !== Math.round(hostRect.width) ||
      controlInner.height !== Math.round(hostRect.height)
    ) {
      voidReasons.push(
        `control_viewport_mismatch host=${Math.round(hostRect.width)}x${Math.round(hostRect.height)} control=${controlInner.width}x${controlInner.height}`,
      );
    }

    const projectedCdp = await ctx.newCDPSession(projected);
    await enableTouch(projectedCdp);
    await enableTouch(controlCdp);

    type CellPlan = {
      surface: TouchScrollAxisSurface;
      gesture: TouchScrollAxisGesture;
      variant?: TouchScrollAxisVariant;
      page: Page;
      cdp: CDPSession;
      mode: 'projected' | 'control';
      skipTouchCapture: boolean;
      targetSelector: string;
      hitMode: HitMode;
      axis: 'vertical' | 'horizontal';
    };

    const variantMeta: Record<
      TouchScrollAxisVariant,
      { selector: string; hitMode: HitMode }
    > = {
      V1: { selector: '#hscroller', hitMode: 'tile' },
      V2: { selector: '#hscroller-v2', hitMode: 'link' },
      V3: { selector: '#hscroller-v3', hitMode: 'gap' },
      V4: { selector: '#hscroller-v4', hitMode: 'img' },
    };

    const plans: CellPlan[] =
      matrixMode === 'navigable'
        ? (['V1', 'V2', 'V3', 'V4'] as TouchScrollAxisVariant[]).flatMap((variant) => {
            const meta = variantMeta[variant];
            return (
              [
                { surface: 'A' as const, skip: false, page: projected, cdp: projectedCdp, mode: 'projected' as const },
                { surface: 'B' as const, skip: true, page: projected, cdp: projectedCdp, mode: 'projected' as const },
                { surface: 'C' as const, skip: false, page: control, cdp: controlCdp, mode: 'control' as const },
              ] as const
            ).map((row) => ({
              surface: row.surface,
              gesture: 'G1' as const,
              variant,
              page: row.page,
              cdp: row.cdp,
              mode: row.mode,
              skipTouchCapture: row.skip,
              targetSelector: meta.selector,
              hitMode: meta.hitMode,
              axis: 'vertical' as const,
            }));
          })
        : [
            {
              surface: 'A' as const,
              gesture: 'G1' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: false,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'A' as const,
              gesture: 'G2' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: false,
              targetSelector: plaintextSelector,
              hitMode: 'plaintext' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'A' as const,
              gesture: 'G3' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: false,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'horizontal' as const,
            },
            {
              surface: 'B' as const,
              gesture: 'G1' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: true,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'B' as const,
              gesture: 'G2' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: true,
              targetSelector: plaintextSelector,
              hitMode: 'plaintext' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'B' as const,
              gesture: 'G3' as const,
              page: projected,
              cdp: projectedCdp,
              mode: 'projected' as const,
              skipTouchCapture: true,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'horizontal' as const,
            },
            {
              surface: 'C' as const,
              gesture: 'G1' as const,
              page: control,
              cdp: controlCdp,
              mode: 'control' as const,
              skipTouchCapture: false,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'C' as const,
              gesture: 'G2' as const,
              page: control,
              cdp: controlCdp,
              mode: 'control' as const,
              skipTouchCapture: false,
              targetSelector: plaintextSelector,
              hitMode: 'plaintext' as const,
              axis: 'vertical' as const,
            },
            {
              surface: 'C' as const,
              gesture: 'G3' as const,
              page: control,
              cdp: controlCdp,
              mode: 'control' as const,
              skipTouchCapture: false,
              targetSelector: scrollerSelector,
              hitMode: 'tile' as const,
              axis: 'horizontal' as const,
            },
          ];

    for (const plan of plans) {
      if (plan.mode === 'projected') {
        await setSkipTouchCapture(plan.page, plan.skipTouchCapture);
      }
      await resetScrollers(plan.page, plan.mode, plan.targetSelector);
      await ensureTargetInView(plan.page, plan.mode, plan.targetSelector);
      await wait(100);

      const maxTouchPoints = await readMaxTouchPoints(plan.page, plan.mode);
      if (maxTouchPoints === 0) {
        voidReasons.push(
          `${plan.variant ?? ''}${plan.surface}.${plan.gesture}_maxTouchPoints_0`,
        );
      }

      const before = await measureScroll(plan.page, plan.mode, plan.targetSelector);
      if (
        plan.gesture === 'G1' &&
        plan.surface === 'C' &&
        (plan.variant === undefined || plan.variant === 'V1') &&
        !(before.hScrollWidth > before.hClientWidth && before.hScrollHeight === before.hClientHeight)
      ) {
        voidReasons.push(
          `hscroller_css_signature_broken sw=${before.hScrollWidth} cw=${before.hClientWidth} sh=${before.hScrollHeight} ch=${before.hClientHeight}`,
        );
      }

      await installListeners(plan.page, plan.mode, plan.targetSelector);
      const point = await targetPointTopPage(
        plan.page,
        plan.mode,
        plan.targetSelector,
        plan.hitMode,
      );
      if (!point) {
        voidReasons.push(
          `${plan.variant ? plan.variant + '.' : ''}${plan.surface}.${plan.gesture}_target_miss`,
        );
        await removeListeners(plan.page);
        cells.push({
          surface: plan.surface,
          gesture: plan.gesture,
          variant: plan.variant,
          maxTouchPoints,
          before,
          after: before,
          deltaDocScrollY: 0,
          deltaHScrollLeft: 0,
          deltaHScrollTop: 0,
          deltaHostScrollY: 0,
          pageRolled: false,
          hScrollerRolledX: false,
          touchStarts: [],
          touchMoves: [],
          touchstartCancelable: null,
          touchstartDefaultPrevented: null,
          hitClosestHref: null,
          hitTagName: null,
          pointerCancelCount: 0,
          touchCancelCount: 0,
          scrollEventsByNode: {},
          voidReason: 'target_miss',
        });
        continue;
      }

      const hit = await hitAtTopPoint(plan.page, plan.mode, point);
      await dispatchSwipe(plan.cdp, point, plan.axis);
      await wait(SETTLE_MS);

      const after = await measureScroll(plan.page, plan.mode, plan.targetSelector);
      const bag = await readListeners(plan.page);
      await removeListeners(plan.page);

      const firstStart = bag.touchStarts[0];
      const deltaDocScrollY = after.docScrollY - before.docScrollY;
      const deltaHScrollLeft = after.hScrollLeft - before.hScrollLeft;
      const deltaHScrollTop = after.hScrollTop - before.hScrollTop;
      const deltaHostScrollY = after.hostScrollY - before.hostScrollY;

      cells.push({
        surface: plan.surface,
        gesture: plan.gesture,
        variant: plan.variant,
        maxTouchPoints,
        before,
        after,
        deltaDocScrollY,
        deltaHScrollLeft,
        deltaHScrollTop,
        deltaHostScrollY,
        pageRolled: deltaDocScrollY !== 0,
        hScrollerRolledX: deltaHScrollLeft !== 0,
        touchStarts: bag.touchStarts,
        touchMoves: bag.touchMoves,
        touchstartCancelable: firstStart ? firstStart.cancelable : null,
        touchstartDefaultPrevented: firstStart ? firstStart.defaultPrevented : null,
        hitClosestHref: hit.hitClosestHref,
        hitTagName: hit.hitTagName,
        pointerCancelCount: bag.pointerCancelCount,
        touchCancelCount: bag.touchCancelCount,
        scrollEventsByNode: bag.scrollEventsByNode,
      });
    }

    // Restore capture flag off after B cells.
    try {
      await setSkipTouchCapture(projected, false);
    } catch {
      /* */
    }

    const verdict =
      matrixMode === 'navigable'
        ? computeVerdictNavigable(cells, voidReasons)
        : computeVerdict(cells, voidReasons);
    const hypothesis: string[] = [];
    if (verdict === 'VOID') {
      hypothesis.push(`VOID: ${voidReasons.join('; ') || 'instrument_broken'}`);
    } else if (verdict === 'CONFIRMED_TOUCH_CAPTURE') {
      hypothesis.push(
        'C.G1 rolls page, A.G1 does not, B.G1 rolls — cause isolated to touch-capture branch',
      );
    } else if (verdict === 'CONFIRMED_NAVIGABLE_GUARD') {
      hypothesis.push(
        'V2/V4: C rolls, A blocked with touchstart.defaultPrevented=true; V1.A still rolls — navigable guard',
      );
    } else if (verdict === 'CONFIRMED_CLIENT_OTHER') {
      const stuck = cells.find(
        (c) =>
          c.surface === 'A' &&
          c.gesture === 'G1' &&
          !c.pageRolled &&
          c.touchstartDefaultPrevented === false,
      );
      hypothesis.push(
        `A stuck without defaultPrevented; variant=${stuck?.variant ?? '?'} hit=${stuck?.hitTagName}/${stuck?.hitClosestHref} scrollNodes=${JSON.stringify(stuck?.scrollEventsByNode ?? {})}`,
      );
    } else {
      hypothesis.push(
        matrixMode === 'navigable'
          ? 'All variants roll on A — fixture did not reproduce; re-run with --url of real site + NAV.zyqj8m selector'
          : 'A.G1 rolls page — fixture did not reproduce; re-run with --url of real site',
      );
    }

    const diagnostic: TouchScrollAxisDiagnostic = {
      capturedAt: new Date().toISOString(),
      matrixMode,
      fixtureUrl,
      scrollerSelector,
      plaintextSelector,
      surfaceHost: hostRect,
      controlViewport: empty.controlViewport,
      cells,
      verdict,
      voidReasons: [...voidReasons],
      hypothesis,
    };

    (opts.chassis.journal as { touchScrollAxis?: TouchScrollAxisDiagnostic }).touchScrollAxis =
      diagnostic;
    if (opts.dossier) {
      await writeJson(opts.dossier, 'probes/touch-scroll-axis.json', diagnostic, 'probes.touchScrollAxis');
    }
    return diagnostic;
  } catch (err) {
    empty.voidReasons = [`probe_exception:${err instanceof Error ? err.message : String(err)}`];
    empty.verdict = 'VOID';
    empty.hypothesis = empty.voidReasons;
    empty.cells = cells;
    (opts.chassis.journal as { touchScrollAxis?: TouchScrollAxisDiagnostic }).touchScrollAxis = empty;
    if (opts.dossier) {
      await writeJson(opts.dossier, 'probes/touch-scroll-axis.json', empty, 'probes.touchScrollAxis');
    }
    return empty;
  } finally {
    if (controlPage) {
      try {
        await controlPage.close();
      } catch {
        /* */
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* disconnect only */
      }
    }
  }
}
