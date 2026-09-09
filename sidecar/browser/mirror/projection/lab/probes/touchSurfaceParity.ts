/**
 * PP-TOUCH-SURFACE-PARITY — does the Projected replica carry the original's
 * gesture surface? Computed `touch-action`, `overflow`, `overscroll-behavior`
 * and the scroll ranges decide which scroller WebKit/Blink latches a swipe to.
 *
 * No gesture is injected: this is a CSSOM + geometry diff between the control
 * page (fixture in a normal tab) and the Projected document. It settles the
 * axis-hijack hypothesis on its own when the divergence is here — and, when it
 * is not, rules the replica out so the remaining suspect is the engine.
 *
 * Root note: `installProjectedTouchSurface` deliberately writes
 * `touch-action: manipulation` onto the projected `<html>`/`<body>`. That write
 * is only harmless while the original root is `auto` or `manipulation` — both
 * permit pan on both axes. If the original restricts an axis there, the write
 * masks it, and that is a fail (`ROOT_WRITE_MASKS`), not an exemption.
 */

import { chromium, type Browser, type Page } from 'patchright';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { DossierHandle } from '../dossier/write';
import { writeJson } from '../dossier/write';

export type TouchSurfaceParityVerdictCode =
  | 'VOID'
  | 'PARITY'
  | 'ROOT_WRITE_MASKS'
  | 'DIVERGENT_TOUCH_ACTION'
  | 'DIVERGENT_OVERFLOW'
  | 'DIVERGENT_SCROLL_RANGE';

export type SurfaceNodeSnapshot = {
  selector: string;
  present: boolean;
  touchAction: string | null;
  overflowX: string | null;
  overflowY: string | null;
  overscrollBehaviorX: string | null;
  overscrollBehaviorY: string | null;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  /** scrollWidth − clientWidth > 1 — the element can latch a horizontal pan. */
  scrollableX: boolean;
  scrollableY: boolean;
};

export type ParityRow = {
  selector: string;
  field: string;
  control: string | number | boolean | null;
  projected: string | number | boolean | null;
  /** Root = html/body, where the projected surface write is expected. */
  root: boolean;
};

export type TouchSurfaceParityDiagnostic = {
  capturedAt: string;
  fixtureUrl: string;
  selectors: string[];
  surfaceHost: { width: number; height: number; x: number; y: number } | null;
  controlViewport: { width: number; height: number } | null;
  control: SurfaceNodeSnapshot[];
  projected: SurfaceNodeSnapshot[];
  divergences: ParityRow[];
  verdict: TouchSurfaceParityVerdictCode;
  voidReasons: string[];
  hypothesis: string[];
};

const DEFAULT_SELECTORS = [
  'html',
  'body',
  '#plaintext',
  '#hscroller',
  '#hscroller-v2',
  '#hscroller-v3',
  '#hscroller-v4',
];

const ROOT_SELECTORS = new Set(['html', 'body']);
/** Root values that permit pan on both axes — the surface write changes nothing real. */
const ROOT_PERMISSIVE = new Set(['auto', 'manipulation']);
const SCROLL_RANGE_TOLERANCE_PX = 4;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

async function surfaceHostRect(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const host = document.getElementById('surfaceHost');
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
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

/** Projected document lives in the surface iframe; C uses the page document. */
async function readSurface(
  page: Page,
  mode: 'projected' | 'control',
  selectors: string[],
): Promise<SurfaceNodeSnapshot[] | null> {
  return page.evaluate(
    ({ mode, selectors }) => {
      let doc: Document = document;
      if (mode === 'projected') {
        const host = document.getElementById('surfaceHost');
        const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
        if (!iframe?.contentDocument) return null;
        doc = iframe.contentDocument;
      }
      const win = doc.defaultView;
      if (!win) return null;
      return selectors.map((selector) => {
        const el = doc.querySelector(selector) as HTMLElement | null;
        if (!el) {
          return {
            selector,
            present: false,
            touchAction: null,
            overflowX: null,
            overflowY: null,
            overscrollBehaviorX: null,
            overscrollBehaviorY: null,
            scrollWidth: 0,
            clientWidth: 0,
            scrollHeight: 0,
            clientHeight: 0,
            scrollableX: false,
            scrollableY: false,
          };
        }
        const cs = win.getComputedStyle(el);
        return {
          selector,
          present: true,
          touchAction: cs.touchAction,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          overscrollBehaviorX: cs.overscrollBehaviorX,
          overscrollBehaviorY: cs.overscrollBehaviorY,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollableX: el.scrollWidth - el.clientWidth > 1,
          scrollableY: el.scrollHeight - el.clientHeight > 1,
        };
      });
    },
    { mode, selectors },
  );
}

function diffSurfaces(
  control: SurfaceNodeSnapshot[],
  projected: SurfaceNodeSnapshot[],
): ParityRow[] {
  const rows: ParityRow[] = [];
  const bySelector = new Map(projected.map((p) => [p.selector, p]));
  for (const c of control) {
    const p = bySelector.get(c.selector);
    const root = ROOT_SELECTORS.has(c.selector);
    if (!p) {
      rows.push({ selector: c.selector, field: 'snapshot', control: 'present', projected: null, root });
      continue;
    }
    if (c.present !== p.present) {
      rows.push({ selector: c.selector, field: 'present', control: c.present, projected: p.present, root });
      continue;
    }
    if (!c.present) continue;
    const strFields = [
      'touchAction',
      'overflowX',
      'overflowY',
      'overscrollBehaviorX',
      'overscrollBehaviorY',
    ] as const;
    for (const field of strFields) {
      if (c[field] !== p[field]) {
        rows.push({ selector: c.selector, field, control: c[field], projected: p[field], root });
      }
    }
    if (c.scrollableX !== p.scrollableX) {
      rows.push({ selector: c.selector, field: 'scrollableX', control: c.scrollableX, projected: p.scrollableX, root });
    }
    if (c.scrollableY !== p.scrollableY) {
      rows.push({ selector: c.selector, field: 'scrollableY', control: c.scrollableY, projected: p.scrollableY, root });
    }
    const cRangeX = c.scrollWidth - c.clientWidth;
    const pRangeX = p.scrollWidth - p.clientWidth;
    if (Math.abs(cRangeX - pRangeX) > SCROLL_RANGE_TOLERANCE_PX) {
      rows.push({ selector: c.selector, field: 'scrollRangeX', control: cRangeX, projected: pRangeX, root });
    }
    const cRangeY = c.scrollHeight - c.clientHeight;
    const pRangeY = p.scrollHeight - p.clientHeight;
    if (Math.abs(cRangeY - pRangeY) > SCROLL_RANGE_TOLERANCE_PX) {
      rows.push({ selector: c.selector, field: 'scrollRangeY', control: cRangeY, projected: pRangeY, root });
    }
  }
  return rows;
}

export function foldTouchSurfaceParity(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { touchSurfaceParity?: TouchSurfaceParityDiagnostic })
    .touchSurfaceParity;
  if (!diag) {
    return [{ id: 'touchSurfaceParity', status: 'fail', reason: 'probe_missing' }];
  }
  const code = diag.verdict;
  if (code === 'PARITY') {
    return [
      { id: 'touchSurfaceParity', status: 'pass', reason: `${code}: ${diag.hypothesis[0] ?? code}` },
    ];
  }
  return [
    {
      id: 'touchSurfaceParity',
      status: 'fail',
      reason: `${code}: ${diag.voidReasons.join('; ') || diag.hypothesis[0] || code}`,
    },
  ];
}

export async function runTouchSurfaceParityProbe(opts: {
  chassis: LabChassis;
  dossier?: DossierHandle | null;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
  fixtureUrl?: string;
  selectors?: string[];
}): Promise<TouchSurfaceParityDiagnostic> {
  const selectors = opts.selectors?.length ? opts.selectors : DEFAULT_SELECTORS;
  const fixtureUrl =
    opts.fixtureUrl ??
    `${(opts.labOrigin ?? '').replace(/\/$/, '')}/fixtures/touch-scroll-axis.html`;
  const voidReasons: string[] = [];
  const empty: TouchSurfaceParityDiagnostic = {
    capturedAt: new Date().toISOString(),
    fixtureUrl,
    selectors,
    surfaceHost: null,
    controlViewport: null,
    control: [],
    projected: [],
    divergences: [],
    verdict: 'VOID',
    voidReasons,
    hypothesis: [],
  };

  const cdpUrl = (opts.projectedCdpUrl ?? '').trim();
  if (!cdpUrl) {
    empty.voidReasons = ['no_projected_cdp_url'];
    empty.hypothesis = ['VOID: projectedCdpUrl empty — never silent skip'];
    return empty;
  }

  let browser: Browser | null = null;
  let controlPage: Page | null = null;

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const projected = await pickProjectedPageBySurfaceHost(browser);
    if (!projected) {
      empty.voidReasons = ['no_projected_page_with_surfaceHost'];
      empty.hypothesis = ['VOID: no tab with #surfaceHost'];
      return empty;
    }
    await expandProjectedSurface(projected);

    const hostRect = await surfaceHostRect(projected);
    if (!hostRect || hostRect.width < 1 || hostRect.height < 1) {
      empty.voidReasons = ['surfaceHost_rect_invalid'];
      empty.hypothesis = ['VOID: #surfaceHost missing or zero size'];
      return empty;
    }
    empty.surfaceHost = hostRect;

    const ctx = projected.context();
    controlPage = await ctx.newPage();
    await controlPage.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const control = controlPage;

    const controlCdp = await ctx.newCDPSession(control);
    // Same box as the drawn surface — scroll ranges are meaningless across viewports.
    await controlCdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(hostRect.width),
      height: Math.round(hostRect.height),
      deviceScaleFactor: 1,
      mobile: true,
    });
    await wait(200);
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

    const controlSnap = await readSurface(control, 'control', selectors);
    const projectedSnap = await readSurface(projected, 'projected', selectors);
    if (!controlSnap) voidReasons.push('control_surface_unreadable');
    if (!projectedSnap) voidReasons.push('projected_surface_unreadable');
    if (projectedSnap && !projectedSnap.some((n) => n.present)) {
      voidReasons.push('projected_selectors_missing');
    }

    const divergences =
      controlSnap && projectedSnap ? diffSurfaces(controlSnap, projectedSnap) : [];

    let verdict: TouchSurfaceParityVerdictCode;
    const hypothesis: string[] = [];
    const rootTouchAction = divergences.filter((d) => d.root && d.field === 'touchAction');
    const rootMasks = rootTouchAction.some(
      (d) => typeof d.control === 'string' && !ROOT_PERMISSIVE.has(d.control),
    );
    const nonRootTouchAction = divergences.filter((d) => !d.root && d.field === 'touchAction');
    const overflow = divergences.filter((d) => d.field.startsWith('overflow') || d.field.startsWith('overscroll'));
    const range = divergences.filter((d) => d.field.startsWith('scrollRange') || d.field.startsWith('scrollable'));

    if (voidReasons.length > 0) {
      verdict = 'VOID';
      hypothesis.push(`VOID: ${voidReasons.join('; ')}`);
    } else if (rootMasks) {
      verdict = 'ROOT_WRITE_MASKS';
      hypothesis.push(
        `installProjectedTouchSurface overwrote a restrictive root touch-action: ${rootTouchAction
          .map((d) => `${d.selector} ${String(d.control)}→${String(d.projected)}`)
          .join(', ')}`,
      );
    } else if (nonRootTouchAction.length > 0) {
      verdict = 'DIVERGENT_TOUCH_ACTION';
      hypothesis.push(
        `Replica lost the original touch-action on ${nonRootTouchAction
          .map((d) => `${d.selector} ${String(d.control)}→${String(d.projected)}`)
          .join(', ')} — the engine picks the latch, not the site.`,
      );
    } else if (overflow.length > 0) {
      verdict = 'DIVERGENT_OVERFLOW';
      hypothesis.push(
        `Replica overflow/overscroll diverges on ${overflow.map((d) => `${d.selector}.${d.field}`).join(', ')}.`,
      );
    } else if (range.length > 0) {
      verdict = 'DIVERGENT_SCROLL_RANGE';
      hypothesis.push(
        `Same styles, different scroll range on ${range.map((d) => `${d.selector}.${d.field}`).join(', ')} — a scroller latches on one side and not the other.`,
      );
    } else {
      verdict = 'PARITY';
      hypothesis.push(
        'Gesture surface is 1:1 with the original — axis hijack is not the replica; the remaining suspect is the engine (device-only).',
      );
    }

    const diagnostic: TouchSurfaceParityDiagnostic = {
      capturedAt: new Date().toISOString(),
      fixtureUrl,
      selectors,
      surfaceHost: hostRect,
      controlViewport: controlInner,
      control: controlSnap ?? [],
      projected: projectedSnap ?? [],
      divergences,
      verdict,
      voidReasons: [...voidReasons],
      hypothesis,
    };

    (opts.chassis.journal as { touchSurfaceParity?: TouchSurfaceParityDiagnostic })
      .touchSurfaceParity = diagnostic;
    if (opts.dossier) {
      await writeJson(
        opts.dossier,
        'probes/touch-surface-parity.json',
        diagnostic,
        'probes.touchSurfaceParity',
      );
    }
    return diagnostic;
  } catch (err) {
    empty.voidReasons = [`probe_exception:${err instanceof Error ? err.message : String(err)}`];
    empty.verdict = 'VOID';
    empty.hypothesis = empty.voidReasons;
    (opts.chassis.journal as { touchSurfaceParity?: TouchSurfaceParityDiagnostic })
      .touchSurfaceParity = empty;
    if (opts.dossier) {
      await writeJson(
        opts.dossier,
        'probes/touch-surface-parity.json',
        empty,
        'probes.touchSurfaceParity',
      );
    }
    return empty;
  } finally {
    try {
      await controlPage?.close();
    } catch {
      /* ignore */
    }
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
