/**
 * Turnstile paint diagnostic — computedStyle + viewport clip screenshot + pixel probe.
 * Lab artifact: `probes/turnstile-paint.json` + PNGs under `probes/`.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { PageProjectionBrowserSession } from '../../session/PageProjectionBrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { ClientStateSnapshot } from './isomorphism';
import type { DossierHandle } from '../dossier/write';
import { writeBinaryArtifact, writeJson } from '../dossier/write';
import type { TurnstilePaintSample } from './turnstilePierce';

const NESTED_WIDGET_NODE_ID = 21;

export type TurnstileWidgetPaintProbe = {
  widgetPaint: TurnstilePaintSample | null;
  widgetPaintOk: boolean;
  widgetPaintReason?: string;
};

export type TurnstilePaintDiagnostic = {
  capturedAt: string;
  nestedContextId: number;
  widgetNodeId: number;
  clip: { x: number; y: number; width: number; height: number } | null;
  virtual: {
    widgetPaint: TurnstilePaintSample | null;
    widgetPaintOk: boolean;
    widgetPaintReason?: string;
    clipScreenshot: { ok: boolean; path?: string; byteLength?: number; reason?: string };
  };
  projected: {
    widgetPaint: TurnstilePaintSample | null;
    widgetPaintOk: boolean;
    widgetPaintReason?: string;
    clipScreenshot: { ok: boolean; path?: string; byteLength?: number; reason?: string };
  };
  paintMatch: boolean | null;
  hypothesis: string[];
};

function paintsMatch(a: TurnstilePaintSample | null, b: TurnstilePaintSample | null): boolean | null {
  if (!a || !b) return null;
  const keys: (keyof TurnstilePaintSample)[] = [
    'backgroundColor',
    'color',
    'opacity',
    'visibility',
    'display',
    'borderTopWidth',
    'borderTopColor',
    'borderTopStyle',
  ];
  return keys.every((k) => a[k] === b[k]);
}

function buildHypothesis(diag: TurnstilePaintDiagnostic): string[] {
  const out: string[] = [];
  const vp = diag.virtual.widgetPaint;
  const pp = diag.projected.widgetPaint;
  if (vp && Number.parseFloat(vp.opacity) === 0) {
    out.push('Virtual widget opacity=0 — invisible by style');
  }
  if (pp && Number.parseFloat(pp.opacity) === 0) {
    out.push('Projected widget opacity=0 — invisible by style');
  }
  if (vp?.visibility === 'hidden' || pp?.visibility === 'hidden') {
    out.push(`visibility hidden — virtual=${vp?.visibility} projected=${pp?.visibility}`);
  }
  if (diag.paintMatch === false) {
    out.push('computedStyle mismatch on widget div — check CSSOM / author rules');
  } else if (diag.paintMatch === true) {
    out.push('computedStyle matches on widget div — compare CDP clip PNGs for perceptual parity');
  }
  if (diag.virtual.clipScreenshot.ok && diag.projected.clipScreenshot.ok) {
    out.push(
      'screenshots captured — compare probes/turnstile-paint-virtual-clip.png vs turnstile-paint-projected-clip.png',
    );
  } else if (diag.clip && !diag.projected.clipScreenshot.ok) {
    out.push(
      `projected CDP clip missing (${diag.projected.clipScreenshot.reason ?? 'unknown'}) — set projectedCdpUrl on run.start`,
    );
  }
  return out;
}

function clipFromRectLadder(
  chassis: LabChassis,
): { x: number; y: number; width: number; height: number } | null {
  const ladder = (
    chassis.journal as {
      turnstileRectLadder?: {
        virtual?: {
          root?: Array<{
            name?: string;
            rect?: { x: number; y: number; width: number; height: number };
          }>;
        };
      };
    }
  ).turnstileRectLadder;
  const hit = ladder?.virtual?.root?.find((l) => l.name === 'nested_host_iframe_in_root');
  const r = hit?.rect;
  if (!r || r.width <= 0 || r.height <= 0) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export async function runTurnstilePaintDiagnostic(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  dossier?: DossierHandle | null;
  nestedContextId?: number;
  widgetNodeId?: number;
  getClientPaintProbe?: (args: {
    nestedContextId: number;
    widgetNodeId: number;
  }) => Promise<TurnstileWidgetPaintProbe | null>;
  captureProjectedViewportClip?: (clip: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<{ ok: boolean; base64?: string; reason?: string; byteLength?: number }>;
}): Promise<TurnstilePaintDiagnostic> {
  const nestedContextId = opts.nestedContextId ?? 2;
  const widgetNodeId = opts.widgetNodeId ?? NESTED_WIDGET_NODE_ID;
  const session = opts.session as BrowserSession & {
    measureNodePaint?: PageProjectionBrowserSession['measureNodePaint'];
    measureTurnstileRootRects?: PageProjectionBrowserSession['measureTurnstileRootRects'];
    captureViewportClip?: PageProjectionBrowserSession['captureViewportClip'];
    haltClocks?: () => Promise<unknown>;
    resumeClocks?: () => Promise<unknown>;
  };

  let clip = clipFromRectLadder(opts.chassis);
  if (!clip && typeof session.measureTurnstileRootRects === 'function') {
    const root = await session.measureTurnstileRootRects();
    const iframe = root.levels?.find((l) => l.name === 'nested_host_iframe_in_root');
    if (iframe?.ok && iframe.rect && iframe.rect.width > 0) {
      clip = {
        x: iframe.rect.x,
        y: iframe.rect.y,
        width: iframe.rect.width,
        height: iframe.rect.height,
      };
    }
  }

  let virtualPaint: Awaited<ReturnType<PageProjectionBrowserSession['measureNodePaint']>> = {
    ok: false,
    reason: 'no_measureNodePaint',
  };
  try {
    await session.haltClocks?.();
    if (typeof session.measureNodePaint === 'function') {
      virtualPaint = await session.measureNodePaint(nestedContextId, widgetNodeId);
    }
  } finally {
    await session.resumeClocks?.();
  }

  let virtualClip: { ok: boolean; reason?: string; byteLength?: number } = {
    ok: false,
    reason: 'no_clip',
  };
  let virtualClipPath: string | undefined;
  if (clip && typeof session.captureViewportClip === 'function') {
    const shot = await session.captureViewportClip(clip);
    virtualClip = shot;
    if (shot.ok && shot.base64 && opts.dossier) {
      virtualClipPath = 'probes/turnstile-paint-virtual-clip.png';
      await writeBinaryArtifact(
        opts.dossier,
        virtualClipPath,
        Buffer.from(shot.base64, 'base64'),
        'probes.turnstilePaint.virtualClip',
        'image/png',
      );
    }
  }

  let projectedProbe: TurnstileWidgetPaintProbe | null = null;
  if (opts.getClientPaintProbe) {
    projectedProbe = await opts.getClientPaintProbe({ nestedContextId, widgetNodeId });
  }

  const virtualWidgetPaint = virtualPaint.ok ? (virtualPaint.paint ?? null) : null;
  const projectedWidgetPaint = projectedProbe?.widgetPaint ?? null;
  const paintMatch = paintsMatch(virtualWidgetPaint, projectedWidgetPaint);

  let projectedClip: { ok: boolean; reason?: string; byteLength?: number } = {
    ok: false,
    reason: 'no_clip',
  };
  let projectedClipPath: string | undefined;
  if (clip && opts.captureProjectedViewportClip) {
    const shot = await opts.captureProjectedViewportClip(clip);
    projectedClip = shot;
    if (shot.ok && shot.base64 && opts.dossier) {
      projectedClipPath = 'probes/turnstile-paint-projected-clip.png';
      await writeBinaryArtifact(
        opts.dossier,
        projectedClipPath,
        Buffer.from(shot.base64, 'base64'),
        'probes.turnstilePaint.projectedClip',
        'image/png',
      );
    }
  } else if (clip) {
    projectedClip = { ok: false, reason: 'no_projected_cdp' };
  }

  const diagnostic: TurnstilePaintDiagnostic = {
    capturedAt: new Date().toISOString(),
    nestedContextId,
    widgetNodeId,
    clip,
    virtual: {
      widgetPaint: virtualWidgetPaint,
      widgetPaintOk: virtualPaint.ok,
      widgetPaintReason: virtualPaint.ok ? undefined : virtualPaint.reason,
      clipScreenshot: {
        ok: virtualClip.ok === true,
        path: virtualClipPath,
        byteLength: virtualClip.byteLength,
        reason: virtualClip.ok ? undefined : virtualClip.reason,
      },
    },
    projected: {
      widgetPaint: projectedWidgetPaint,
      widgetPaintOk: projectedProbe?.widgetPaintOk ?? false,
      widgetPaintReason: projectedProbe?.widgetPaintReason,
      clipScreenshot: {
        ok: projectedClip.ok === true,
        path: projectedClipPath,
        byteLength: projectedClip.byteLength,
        reason: projectedClip.ok ? undefined : projectedClip.reason,
      },
    },
    paintMatch,
    hypothesis: [],
  };
  diagnostic.hypothesis = buildHypothesis(diagnostic);
  return diagnostic;
}

export function foldTurnstilePaint(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { turnstilePaint?: TurnstilePaintDiagnostic }).turnstilePaint;
  if (!diag) {
    return [{ id: 'turnstile.paint.probe', status: 'fail', reason: 'probe did not run' }];
  }
  const verdicts: LabVerdict[] = [
    { id: 'turnstile.paint.probe', status: 'pass', reason: diag.capturedAt },
  ];
  if (!diag.virtual.widgetPaintOk || !diag.projected.widgetPaintOk) {
    verdicts.push({
      id: 'turnstile.paint.sampled',
      status: 'fail',
      reason: `virtual=${diag.virtual.widgetPaintOk} projected=${diag.projected.widgetPaintOk}`,
    });
  } else {
    verdicts.push({
      id: 'turnstile.paint.sampled',
      status: 'pass',
      reason: 'computedStyle on widget div both sides',
    });
  }
  if (diag.paintMatch === false) {
    verdicts.push({
      id: 'turnstile.paint.match',
      status: 'fail',
      reason: diag.hypothesis.find((h) => h.includes('mismatch')) ?? 'paint mismatch',
    });
  } else if (diag.paintMatch === true) {
    verdicts.push({
      id: 'turnstile.paint.match',
      status: 'pass',
      reason: 'widget computedStyle identical',
    });
  } else {
    verdicts.push({ id: 'turnstile.paint.match', status: 'skipped', reason: 'missing paint sample' });
  }
  if (diag.virtual.clipScreenshot.ok && diag.projected.clipScreenshot.ok) {
    verdicts.push({
      id: 'turnstile.paint.screenshot',
      status: 'pass',
      reason: [
        diag.virtual.clipScreenshot.path ?? 'no-virtual-clip',
        diag.projected.clipScreenshot.path ?? 'no-projected-clip',
      ].join(' + '),
    });
  } else if (diag.virtual.clipScreenshot.ok || diag.projected.clipScreenshot.ok) {
    verdicts.push({
      id: 'turnstile.paint.screenshot',
      status: 'fail',
      reason: [
        diag.virtual.clipScreenshot.path ?? `virtual:${diag.virtual.clipScreenshot.reason ?? 'missing'}`,
        diag.projected.clipScreenshot.path ?? `projected:${diag.projected.clipScreenshot.reason ?? 'missing'}`,
      ].join(' + '),
    });
  } else {
    verdicts.push({
      id: 'turnstile.paint.screenshot',
      status: 'skipped',
      reason: 'no clip screenshots captured',
    });
  }
  return verdicts;
}
