/**
 * Turnstile rect ladder — compare Virtual vs Projected geometry level-by-level.
 * First level where width/height diverge pinpoints render/compositing breakage.
 * Lab artifact: `probes/turnstile-rect-ladder.json`.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { PageProjectionBrowserSession } from '../../session/PageProjectionBrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { ClientStateSnapshot } from './isomorphism';
import { TURNSTILE_NESTED_REGISTRY_PROBE_IDS } from './nestedApplyFailureDiagnostic';

/** @deprecated Use measureTurnstileRootRects loopback — live evaluate cannot pierce closed shadow. */
export const VIRTUAL_ROOT_RECT_LADDER_EXPR = `(() => JSON.stringify({ levels: [] }))()`;

export type RectLevelSample = {
  level?: number;
  name: string;
  ok: boolean;
  reason?: string;
  tagName?: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  offsetWidth?: number | null;
  offsetHeight?: number | null;
  display?: string | null;
  visibility?: string | null;
  hasSrcAttr?: boolean | null;
  src?: string | null;
};

export type TurnstileRectLadderDiagnostic = {
  capturedAt: string;
  nestedContextId: number;
  widgetNodeId: number;
  virtual: {
    nested: RectLevelSample[];
    root: RectLevelSample[];
  };
  projected: RectLevelSample[];
  firstDivergence: {
    level: number;
    name: string;
    virtual: RectLevelSample | null;
    projected: RectLevelSample | null;
    note: string;
  } | null;
  hypothesis: string[];
};

const NESTED_HTML_NODE_ID = 3;
const NESTED_WIDGET_NODE_ID = 21;
const SIZE_TOL = 0.5;

function parseVirtualRootLevels(
  payload: Awaited<
    ReturnType<PageProjectionBrowserSession['measureTurnstileRootRects']>
  >,
): RectLevelSample[] {
  if (!payload.ok || !payload.levels) return [];
  return payload.levels.map((s, i) => virtualToLevel(s as RectLevelSample, i + 3));
}

function virtualToLevel(sample: RectLevelSample, level: number): RectLevelSample {
  return { ...sample, level };
}

function sizeOf(sample: RectLevelSample | null | undefined): { w: number; h: number } | null {
  if (!sample?.ok || !sample.rect) return null;
  return { w: sample.rect.width, h: sample.rect.height };
}

function sizesDiverge(
  a: RectLevelSample | null | undefined,
  b: RectLevelSample | null | undefined,
): boolean {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  if (sa === null && sb === null) return false;
  if (sa === null || sb === null) return true;
  return Math.abs(sa.w - sb.w) > SIZE_TOL || Math.abs(sa.h - sb.h) > SIZE_TOL;
}

function findFirstDivergence(
  virtualLevels: RectLevelSample[],
  projectedLevels: RectLevelSample[],
): TurnstileRectLadderDiagnostic['firstDivergence'] {
  const byLevel = (levels: RectLevelSample[]) =>
    new Map(levels.filter((l) => typeof l.level === 'number').map((l) => [l.level as number, l]));
  const vMap = byLevel(virtualLevels);
  const pMap = byLevel(projectedLevels);
  for (const level of [1, 2, 3, 4, 5]) {
    const v = vMap.get(level) ?? null;
    const p = pMap.get(level) ?? null;
    if (sizesDiverge(v, p)) {
      const note =
        level === 3 && p?.hasSrcAttr === false && v?.hasSrcAttr === true
          ? 'iframe host: Virtual has src attr, Projected stripped (isNestedHostNavAttr) — CSS [src*=] selectors may miss'
          : `width/height diverge at level ${level}`;
      return {
        level,
        name: p?.name ?? v?.name ?? `level_${level}`,
        virtual: v,
        projected: p,
        note,
      };
    }
  }
  return null;
}

function buildHypothesis(diag: TurnstileRectLadderDiagnostic): string[] {
  const out: string[] = [];
  const div = diag.firstDivergence;
  if (!div) {
    out.push('all five levels match within tolerance — render break is above root documentElement or perceptual (opacity/paint)');
    return out;
  }
  out.push(
    `FIRST DIVERGENCE level ${div.level} (${div.name}): Virtual ${div.virtual?.rect?.width ?? '?'}x${div.virtual?.rect?.height ?? '?'} vs Projected ${div.projected?.rect?.width ?? '?'}x${div.projected?.rect?.height ?? '?'}`,
  );
  out.push(div.note);
  if (div.level === 3) {
    out.push(
      'suspect: nested host iframe sizing — check CSS attribute selectors on src, sandbox iframe layout, nested host dimensions',
    );
  }
  if (div.level === 4) {
    const p3 = diag.projected.find((l) => l.level === 3);
    const v3 = [...diag.virtual.nested, ...diag.virtual.root].find((l) => l.level === 3);
    if (p3?.ok && v3?.ok && div.projected?.reason === 'missing') {
      out.push(
        'level 4 missing on Projected while level 3 iframe matches — likely probe pierce gap, not layout; compare CDP clip PNGs',
      );
    } else {
      out.push('suspect: root closed-shadow host container clipping or zero height');
    }
  }
  if (div.level <= 2) {
    out.push('suspect: nested doc apply/CSSOM inside Turnstile iframe (not compositing chain)');
  }
  return out;
}

export async function runTurnstileRectLadder(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  nestedContextId?: number;
  widgetNodeId?: number;
  getClientRectLadder?: (
    nestedContextId: number,
    widgetNodeId: number,
  ) => Promise<ClientStateSnapshot['rectLadder'] | null>;
}): Promise<TurnstileRectLadderDiagnostic> {
  const nestedContextId = opts.nestedContextId ?? 2;
  const widgetNodeId = opts.widgetNodeId ?? NESTED_WIDGET_NODE_ID;
  const session = opts.session as BrowserSession & {
    measureNodeRect?: PageProjectionBrowserSession['measureNodeRect'];
    measureTurnstileRootRects?: PageProjectionBrowserSession['measureTurnstileRootRects'];
    haltClocks?: () => Promise<unknown>;
    resumeClocks?: () => Promise<unknown>;
  };

  const virtualNested: RectLevelSample[] = [];
  try {
    await session.haltClocks?.();
    if (typeof session.measureNodeRect === 'function') {
      const widget = await session.measureNodeRect(nestedContextId, widgetNodeId);
      virtualNested.push(
        virtualToLevel(
          widget.ok
            ? {
                name: 'nested_widget_div',
                ok: true,
                tagName: widget.tagName ?? null,
                rect: widget.rect ?? null,
                offsetWidth: widget.offsetWidth ?? null,
                offsetHeight: widget.offsetHeight ?? null,
                display: widget.display ?? null,
                visibility: widget.visibility ?? null,
              }
            : { name: 'nested_widget_div', ok: false, reason: widget.reason ?? 'measure_failed', rect: null },
          1,
        ),
      );
      const html = await session.measureNodeRect(nestedContextId, NESTED_HTML_NODE_ID);
      virtualNested.push(
        virtualToLevel(
          html.ok
            ? {
                name: 'nested_documentElement',
                ok: true,
                tagName: html.tagName ?? null,
                rect: html.rect ?? null,
                offsetWidth: html.offsetWidth ?? null,
                offsetHeight: html.offsetHeight ?? null,
                display: html.display ?? null,
                visibility: html.visibility ?? null,
              }
            : {
                name: 'nested_documentElement',
                ok: false,
                reason: html.reason ?? 'measure_failed',
                rect: null,
              },
          2,
        ),
      );
    }
  } finally {
    await session.resumeClocks?.();
  }

  let virtualRoot: RectLevelSample[] = [];
  if (typeof session.measureTurnstileRootRects === 'function') {
    const root = await session.measureTurnstileRootRects();
    virtualRoot = parseVirtualRootLevels(root);
  }

  let projected: RectLevelSample[] = [];
  if (opts.getClientRectLadder) {
    const ladder = await opts.getClientRectLadder(nestedContextId, widgetNodeId);
    projected = ladder?.levels ?? [];
  }

  const virtualAll = [...virtualNested, ...virtualRoot];
  const firstDivergence = findFirstDivergence(virtualAll, projected);
  const diagnostic: TurnstileRectLadderDiagnostic = {
    capturedAt: new Date().toISOString(),
    nestedContextId,
    widgetNodeId,
    virtual: { nested: virtualNested, root: virtualRoot },
    projected,
    firstDivergence,
    hypothesis: [],
  };
  diagnostic.hypothesis = buildHypothesis(diagnostic);
  return diagnostic;
}

export function foldTurnstileRectLadder(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { turnstileRectLadder?: TurnstileRectLadderDiagnostic })
    .turnstileRectLadder;
  if (!diag) {
    return [{ id: 'turnstile.rectLadder.probe', status: 'fail', reason: 'probe did not run' }];
  }
  const verdicts: LabVerdict[] = [
    { id: 'turnstile.rectLadder.probe', status: 'pass', reason: diag.capturedAt },
  ];
  if (diag.projected.length === 0) {
    verdicts.push({
      id: 'turnstile.rectLadder.projected',
      status: 'fail',
      reason: 'no projected ladder',
    });
    return verdicts;
  }
  if (diag.firstDivergence) {
    verdicts.push({
      id: 'turnstile.rectLadder.divergence',
      status: 'fail',
      reason: diag.hypothesis[0] ?? `level ${diag.firstDivergence.level}`,
    });
  } else {
    verdicts.push({
      id: 'turnstile.rectLadder.divergence',
      status: 'pass',
      reason: 'all levels match within tolerance',
    });
  }
  return verdicts;
}

export { TURNSTILE_NESTED_REGISTRY_PROBE_IDS };
