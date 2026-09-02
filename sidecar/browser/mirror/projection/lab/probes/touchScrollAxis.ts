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
  | 'NOT_REPRODUCED';

export type TouchScrollAxisSurface = 'A' | 'B' | 'C';
export type TouchScrollAxisGesture = 'G1' | 'G2' | 'G3';

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
  pointerCancelCount: number;
  touchCancelCount: number;
  scrollEventsByNode: Record<string, number>;
  voidReason?: string;
};

export type TouchScrollAxisDiagnostic = {
  capturedAt: string;
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
        const h = doc.querySelector(scrollerSelector) as HTMLElement | null;
        if (h) {
          h.scrollTop = 0;
          h.scrollLeft = 0;
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

async function targetPointTopPage(
  page: Page,
  mode: 'projected' | 'control',
  selector: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ mode, selector }) => {
      if (mode === 'control') {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        return { x: r.left + r.width / 2, y: r.top + Math.min(24, r.height / 2) };
      }
      const host = document.getElementById('surfaceHost');
      if (!host) return null;
      const iframe = host.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe) return null;
      const iframeR = iframe.getBoundingClientRect();
      const doc = iframe.contentDocument;
      if (!doc) return null;
      const el = doc.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const x = iframeR.left + r.left + r.width / 2;
      const y = iframeR.top + r.top + Math.min(24, r.height / 2);
      // Must land inside the visible iframe box (lab HUD used to steal hits).
      if (x < iframeR.left || x > iframeR.right || y < iframeR.top || y > iframeR.bottom) {
        return null;
      }
      return { x, y };
    },
    { mode, selector },
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
}): Promise<TouchScrollAxisDiagnostic> {
  const voidReasons: string[] = [];
  const scrollerSelector = opts.scrollerSelector ?? '#hscroller';
  const plaintextSelector = opts.plaintextSelector ?? '#plaintext';
  const labOrigin = (opts.labOrigin ?? 'http://127.0.0.1:4077').replace(/\/$/, '');
  const fixtureUrl =
    opts.fixtureUrl ??
    `${labOrigin}/fixtures/touch-scroll-axis.html`;

  const empty: TouchScrollAxisDiagnostic = {
    capturedAt: new Date().toISOString(),
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

    const controlCdp = await ctx.newCDPSession(controlPage);
    await controlCdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(hostRect.width),
      height: Math.round(hostRect.height),
      deviceScaleFactor: 1,
      mobile: true,
    });
    await wait(100);
    const controlInner = await controlPage.evaluate(() => ({
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
      page: Page;
      cdp: CDPSession;
      mode: 'projected' | 'control';
      skipTouchCapture: boolean;
      targetSelector: string;
      axis: 'vertical' | 'horizontal';
    };

    const plans: CellPlan[] = [
      {
        surface: 'A',
        gesture: 'G1',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: false,
        targetSelector: scrollerSelector,
        axis: 'vertical',
      },
      {
        surface: 'A',
        gesture: 'G2',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: false,
        targetSelector: plaintextSelector,
        axis: 'vertical',
      },
      {
        surface: 'A',
        gesture: 'G3',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: false,
        targetSelector: scrollerSelector,
        axis: 'horizontal',
      },
      {
        surface: 'B',
        gesture: 'G1',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: true,
        targetSelector: scrollerSelector,
        axis: 'vertical',
      },
      {
        surface: 'B',
        gesture: 'G2',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: true,
        targetSelector: plaintextSelector,
        axis: 'vertical',
      },
      {
        surface: 'B',
        gesture: 'G3',
        page: projected,
        cdp: projectedCdp,
        mode: 'projected',
        skipTouchCapture: true,
        targetSelector: scrollerSelector,
        axis: 'horizontal',
      },
      {
        surface: 'C',
        gesture: 'G1',
        page: controlPage,
        cdp: controlCdp,
        mode: 'control',
        skipTouchCapture: false,
        targetSelector: scrollerSelector,
        axis: 'vertical',
      },
      {
        surface: 'C',
        gesture: 'G2',
        page: controlPage,
        cdp: controlCdp,
        mode: 'control',
        skipTouchCapture: false,
        targetSelector: plaintextSelector,
        axis: 'vertical',
      },
      {
        surface: 'C',
        gesture: 'G3',
        page: controlPage,
        cdp: controlCdp,
        mode: 'control',
        skipTouchCapture: false,
        targetSelector: scrollerSelector,
        axis: 'horizontal',
      },
    ];

    for (const plan of plans) {
      if (plan.mode === 'projected') {
        await setSkipTouchCapture(plan.page, plan.skipTouchCapture);
      }
      await resetScrollers(plan.page, plan.mode, scrollerSelector);
      await wait(100);

      const maxTouchPoints = await readMaxTouchPoints(plan.page, plan.mode);
      if (maxTouchPoints === 0) {
        voidReasons.push(`${plan.surface}.${plan.gesture}_maxTouchPoints_0`);
      }

      const before = await measureScroll(plan.page, plan.mode, scrollerSelector);
      // Sanity: hscroller must have horizontal overflow (form of the problem).
      if (
        plan.gesture === 'G1' &&
        plan.surface === 'C' &&
        !(before.hScrollWidth > before.hClientWidth && before.hScrollHeight === before.hClientHeight)
      ) {
        voidReasons.push(
          `hscroller_css_signature_broken sw=${before.hScrollWidth} cw=${before.hClientWidth} sh=${before.hScrollHeight} ch=${before.hClientHeight}`,
        );
      }

      await installListeners(plan.page, plan.mode, scrollerSelector);
      const point = await targetPointTopPage(plan.page, plan.mode, plan.targetSelector);
      if (!point) {
        voidReasons.push(`${plan.surface}.${plan.gesture}_target_miss`);
        await removeListeners(plan.page);
        cells.push({
          surface: plan.surface,
          gesture: plan.gesture,
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
          pointerCancelCount: 0,
          touchCancelCount: 0,
          scrollEventsByNode: {},
          voidReason: 'target_miss',
        });
        continue;
      }

      await dispatchSwipe(plan.cdp, point, plan.axis);
      await wait(SETTLE_MS);

      const after = await measureScroll(plan.page, plan.mode, scrollerSelector);
      const bag = await readListeners(plan.page);
      await removeListeners(plan.page);

      const deltaDocScrollY = after.docScrollY - before.docScrollY;
      const deltaHScrollLeft = after.hScrollLeft - before.hScrollLeft;
      const deltaHScrollTop = after.hScrollTop - before.hScrollTop;
      const deltaHostScrollY = after.hostScrollY - before.hostScrollY;

      cells.push({
        surface: plan.surface,
        gesture: plan.gesture,
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

    const verdict = computeVerdict(cells, voidReasons);
    const hypothesis: string[] = [];
    if (verdict === 'VOID') {
      hypothesis.push(`VOID: ${voidReasons.join('; ') || 'instrument_broken'}`);
    } else if (verdict === 'CONFIRMED_TOUCH_CAPTURE') {
      hypothesis.push(
        'C.G1 rolls page, A.G1 does not, B.G1 rolls — cause isolated to touch-capture branch',
      );
    } else if (verdict === 'CONFIRMED_CLIENT_OTHER') {
      const aG1 = cells.find((c) => c.surface === 'A' && c.gesture === 'G1');
      hypothesis.push(
        `C.G1 rolls, A.G1 and B.G1 do not — client culprit, touch-capture absolved; scrollNodes=${JSON.stringify(aG1?.scrollEventsByNode ?? {})}`,
      );
    } else {
      hypothesis.push('A.G1 rolls page — fixture did not reproduce; re-run with --url of real site');
    }

    const diagnostic: TouchScrollAxisDiagnostic = {
      capturedAt: new Date().toISOString(),
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
