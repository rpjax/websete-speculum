/**
 * PP-TOUCH-FLING-TAP — does the tap that arrests an inertial scroll emit a
 * Projected `down`/`up` intent (i.e. a click on the Virtual page)?
 *
 * iOS arrests momentum with the first tap and does **not** activate the target.
 * Blink flings too, so the client-side tap path in `projectedInputCapture`
 * (native `click` → down/up) can be measured here, without a device.
 *
 * Cells:
 *   G-FLING-TAP  fling the page, then tap while it still coasts.
 *   G-IDLE-TAP   tap with no fling — MUST emit, or the instrument proved nothing.
 * Surfaces:
 *   P  Projected surface (intent journal is the effect assert).
 *   C  control page — the same fixture in a normal tab (native oracle).
 */

import { chromium, type Browser, type CDPSession, type Page } from 'patchright';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { DossierHandle } from '../dossier/write';
import { writeJson } from '../dossier/write';

export type TouchFlingTapVerdictCode =
  | 'VOID'
  | 'ARREST_TAP_EMITS'
  | 'ARREST_TAP_CLEAN';

export type FlingCellRecord = {
  surface: 'P' | 'C';
  gesture: 'G-FLING-TAP' | 'G-IDLE-TAP';
  /** Scroll kept moving after synthesizeScrollGesture returned. */
  flingObserved: boolean;
  scrollStart: number;
  scrollAfterGesture: number;
  scrollAtTap: number;
  scrollAfterSettle: number;
  /** Travel after the tap — near zero means the tap arrested the fling. */
  postTapTravel: number;
  /** Travel over the sample window immediately before the tap. */
  preTapTravel: number;
  intentDownDelta: number;
  intentUpDelta: number;
  locationChanged: boolean;
  hitTagName: string | null;
  hitClosestHref: string | null;
  error?: string;
};

export type TouchFlingTapDiagnostic = {
  capturedAt: string;
  fixtureUrl: string;
  anchorSelector: string;
  surfaceHost: { width: number; height: number; x: number; y: number } | null;
  controlViewport: { width: number; height: number } | null;
  cells: FlingCellRecord[];
  verdict: TouchFlingTapVerdictCode;
  voidReasons: string[];
  hypothesis: string[];
};

/** Fling start offset — mid-page so the gesture moves regardless of sign. */
const START_SCROLL_TOP = 400;
const FLING_Y_DISTANCE = -240;
const FLING_SPEED = 3000;
const SAMPLE_MS = 30;
const SAMPLE_TRIES = 12;
const SETTLE_MS = 900;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function countDownUpIntents(
  intents: ReadonlyArray<{ intent: Record<string, unknown> }>,
): { down: number; up: number } {
  let down = 0;
  let up = 0;
  for (const entry of intents) {
    const type = entry.intent.type;
    if (type === 'down') down += 1;
    else if (type === 'up') up += 1;
  }
  return { down, up };
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

async function enableTouch(cdp: CDPSession): Promise<void> {
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
}

/** Projected document lives in the surface iframe; C uses the page document. */
async function readScrollTop(page: Page, mode: 'projected' | 'control'): Promise<number> {
  return page.evaluate((mode) => {
    let doc: Document = document;
    if (mode === 'projected') {
      const host = document.getElementById('surfaceHost');
      const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe?.contentDocument) return -1;
      doc = iframe.contentDocument;
    }
    const se = doc.scrollingElement as HTMLElement | null;
    return doc.defaultView?.scrollY || se?.scrollTop || 0;
  }, mode);
}

async function seedScrollTop(
  page: Page,
  mode: 'projected' | 'control',
  top: number,
): Promise<void> {
  await page.evaluate(
    ({ mode, top }) => {
      const apply = (doc: Document) => {
        const se = doc.scrollingElement as HTMLElement | null;
        if (se) se.scrollTop = top;
        doc.defaultView?.scrollTo(0, top);
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
    { mode, top },
  );
  await wait(120);
}

/** Centre of the drawn surface (P) or of the control viewport (C), in top-page coords. */
async function anchorPointTopPage(
  page: Page,
  mode: 'projected' | 'control',
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((mode) => {
    if (mode === 'control') {
      return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    }
    const host = document.getElementById('surfaceHost');
    const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
    if (!iframe) return null;
    const r = iframe.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, mode);
}

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
      return { hitTagName: el.tagName, hitClosestHref: a ? a.getAttribute('href') : null };
    },
    { mode, point },
  );
}

async function readDocLocation(page: Page, mode: 'projected' | 'control'): Promise<string | null> {
  return page.evaluate((mode) => {
    if (mode === 'control') return location.href;
    const host = document.getElementById('surfaceHost');
    const iframe = host?.querySelector('iframe') as HTMLIFrameElement | null;
    try {
      return iframe?.contentWindow?.location.href ?? null;
    } catch {
      return null;
    }
  }, mode);
}

/** Real touch fling through the input pipeline — `preventFling` stays false on purpose. */
async function dispatchFling(cdp: CDPSession, at: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.synthesizeScrollGesture', {
    x: at.x,
    y: at.y,
    xDistance: 0,
    yDistance: FLING_Y_DISTANCE,
    speed: FLING_SPEED,
    gestureSourceType: 'touch',
    preventFling: false,
    repeatCount: 0,
  });
}

async function dispatchTap(cdp: CDPSession, at: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: at.x, y: at.y, id: 1 }],
  });
  await wait(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export function foldTouchFlingTap(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { touchFlingTap?: TouchFlingTapDiagnostic }).touchFlingTap;
  if (!diag) {
    return [{ id: 'touchFlingTap', status: 'fail', reason: 'probe_missing' }];
  }
  const code = diag.verdict;
  if (code === 'VOID' || code === 'ARREST_TAP_EMITS') {
    return [
      {
        id: 'touchFlingTap',
        status: 'fail',
        reason: `${code}: ${diag.voidReasons.join('; ') || diag.hypothesis[0] || code}`,
      },
    ];
  }
  return [
    { id: 'touchFlingTap', status: 'pass', reason: `${code}: ${diag.hypothesis[0] ?? code}` },
  ];
}

export async function runTouchFlingTapProbe(opts: {
  chassis: LabChassis;
  dossier?: DossierHandle | null;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
  fixtureUrl?: string;
  /** Selector kept for dossier provenance; the tap uses the surface centre. */
  anchorSelector?: string;
}): Promise<TouchFlingTapDiagnostic> {
  const anchorSelector = opts.anchorSelector ?? '#hscroller-v2';
  const fixtureUrl =
    opts.fixtureUrl ??
    `${(opts.labOrigin ?? '').replace(/\/$/, '')}/fixtures/touch-scroll-axis.html`;
  const voidReasons: string[] = [];
  const cells: FlingCellRecord[] = [];
  const empty: TouchFlingTapDiagnostic = {
    capturedAt: new Date().toISOString(),
    fixtureUrl,
    anchorSelector,
    surfaceHost: null,
    controlViewport: null,
    cells,
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
    await controlCdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(hostRect.width),
      height: Math.round(hostRect.height),
      deviceScaleFactor: 1,
      mobile: true,
    });
    await wait(100);
    empty.controlViewport = await control.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    const projectedCdp = await ctx.newCDPSession(projected);
    await enableTouch(projectedCdp);
    await enableTouch(controlCdp);

    const surfaces: {
      surface: 'P' | 'C';
      page: Page;
      cdp: CDPSession;
      mode: 'projected' | 'control';
    }[] = [
      { surface: 'P', page: projected, cdp: projectedCdp, mode: 'projected' },
      { surface: 'C', page: control, cdp: controlCdp, mode: 'control' },
    ];

    for (const s of surfaces) {
      // Baseline first: a dead capture must be visible before the experiment runs.
      for (const gesture of ['G-IDLE-TAP', 'G-FLING-TAP'] as const) {
        const cell: FlingCellRecord = {
          surface: s.surface,
          gesture,
          flingObserved: false,
          scrollStart: 0,
          scrollAfterGesture: 0,
          scrollAtTap: 0,
          scrollAfterSettle: 0,
          postTapTravel: 0,
          preTapTravel: 0,
          intentDownDelta: 0,
          intentUpDelta: 0,
          locationChanged: false,
          hitTagName: null,
          hitClosestHref: null,
        };
        try {
          await seedScrollTop(s.page, s.mode, START_SCROLL_TOP);
          cell.scrollStart = await readScrollTop(s.page, s.mode);

          const at = await anchorPointTopPage(s.page, s.mode);
          if (!at) {
            cell.error = 'anchor_point_missing';
            cells.push(cell);
            continue;
          }

          const locBefore = await readDocLocation(s.page, s.mode);
          const intentBefore = countDownUpIntents(opts.chassis.journal.intents);

          if (gesture === 'G-FLING-TAP') {
            await dispatchFling(s.cdp, at);
            cell.scrollAfterGesture = await readScrollTop(s.page, s.mode);
            // Coast detection: the gesture already returned, so any further
            // travel is fling, not finger.
            let prev = cell.scrollAfterGesture;
            for (let i = 0; i < SAMPLE_TRIES; i++) {
              await wait(SAMPLE_MS);
              const now = await readScrollTop(s.page, s.mode);
              if (Math.abs(now - prev) > 1) {
                cell.flingObserved = true;
                cell.preTapTravel = Math.abs(now - prev);
                prev = now;
                break;
              }
              prev = now;
            }
            cell.scrollAtTap = prev;
          } else {
            cell.scrollAfterGesture = cell.scrollStart;
            cell.scrollAtTap = cell.scrollStart;
          }

          const hit = await hitAtTopPoint(s.page, s.mode, at);
          cell.hitTagName = hit.hitTagName;
          cell.hitClosestHref = hit.hitClosestHref;

          await dispatchTap(s.cdp, at);
          await wait(SETTLE_MS);

          cell.scrollAfterSettle = await readScrollTop(s.page, s.mode);
          cell.postTapTravel = Math.abs(cell.scrollAfterSettle - cell.scrollAtTap);

          const intentAfter = countDownUpIntents(opts.chassis.journal.intents);
          cell.intentDownDelta = intentAfter.down - intentBefore.down;
          cell.intentUpDelta = intentAfter.up - intentBefore.up;

          const locAfter = await readDocLocation(s.page, s.mode);
          cell.locationChanged = locBefore != null && locAfter != null && locBefore !== locAfter;
        } catch (err) {
          cell.error = err instanceof Error ? err.message : String(err);
        }
        cells.push(cell);
      }
    }

    const pFling = cells.find((c) => c.surface === 'P' && c.gesture === 'G-FLING-TAP');
    const pIdle = cells.find((c) => c.surface === 'P' && c.gesture === 'G-IDLE-TAP');
    const cFling = cells.find((c) => c.surface === 'C' && c.gesture === 'G-FLING-TAP');

    if (!pFling || !pIdle) voidReasons.push('projected_cells_missing');
    if (pIdle && pIdle.intentDownDelta < 1) {
      // Instrument dead: if an ordinary tap emits nothing, a clean fling cell proves nothing.
      voidReasons.push('idle_tap_no_intent');
    }
    if (pFling && !pFling.flingObserved) voidReasons.push('no_fling_observed_projected');

    let verdict: TouchFlingTapVerdictCode;
    const hypothesis: string[] = [];
    if (voidReasons.length > 0) {
      verdict = 'VOID';
      hypothesis.push(`VOID: ${voidReasons.join('; ')}`);
    } else if (pFling && pFling.intentDownDelta >= 1) {
      verdict = 'ARREST_TAP_EMITS';
      hypothesis.push(
        `Arrest tap emitted down=${pFling.intentDownDelta} up=${pFling.intentUpDelta} on Projected — phantom click reproduced without a device.`,
      );
      hypothesis.push(
        `Control same gesture: locationChanged=${cFling?.locationChanged ? 'Y' : 'n'} (native oracle).`,
      );
    } else {
      verdict = 'ARREST_TAP_CLEAN';
      hypothesis.push(
        'Arrest tap emitted no down/up on Projected — Blink does not reproduce the phantom click; the iOS report stays device-only.',
      );
    }

    const diagnostic: TouchFlingTapDiagnostic = {
      capturedAt: new Date().toISOString(),
      fixtureUrl,
      anchorSelector,
      surfaceHost: hostRect,
      controlViewport: empty.controlViewport,
      cells,
      verdict,
      voidReasons: [...voidReasons],
      hypothesis,
    };

    (opts.chassis.journal as { touchFlingTap?: TouchFlingTapDiagnostic }).touchFlingTap =
      diagnostic;
    if (opts.dossier) {
      await writeJson(opts.dossier, 'probes/touch-fling-tap.json', diagnostic, 'probes.touchFlingTap');
    }
    return diagnostic;
  } catch (err) {
    empty.voidReasons = [`probe_exception:${err instanceof Error ? err.message : String(err)}`];
    empty.verdict = 'VOID';
    empty.hypothesis = empty.voidReasons;
    empty.cells = cells;
    (opts.chassis.journal as { touchFlingTap?: TouchFlingTapDiagnostic }).touchFlingTap = empty;
    if (opts.dossier) {
      await writeJson(opts.dossier, 'probes/touch-fling-tap.json', empty, 'probes.touchFlingTap');
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
