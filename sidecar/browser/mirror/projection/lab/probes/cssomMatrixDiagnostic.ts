/**
 * CSSOM matrix nested diagnostic — sheet dump + paint clip diff (lab regression).
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { PageProjectionBrowserSession } from '../../session/PageProjectionBrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { DossierHandle } from '../dossier/write';
import { writeBinaryArtifact } from '../dossier/write';
import {
  CSSOM_SHEET_DUMP_EXPR,
  compareSheetDumps,
  findSheetEntryByClass,
  parseCssomSheetDump,
  verifyClass9a,
  verifyClass9b,
  type CssomSheetDumpResult,
  type SheetCompareResult,
} from './cssomSheetDump';
import { captureClipPair } from './paintCapture';
import { diffPngBase64 } from './pixelDiff';
import { evaluateVirtualProbe } from './evaluateVirtualProbe';

/** Fixed card size from cssom-matrix-nested-inner fixture. */
export const CSSOM_MATRIX_CARD_ID = 'matrix-card';
export const CSSOM_MATRIX_CARD_SIZE = { width: 280, height: 120 };

export type CssomMatrixDiagnostic = {
  capturedAt: string;
  nestedContextId: number;
  clip: { x: number; y: number; width: number; height: number } | null;
  virtual: {
    sheetDump: CssomSheetDumpResult;
    clipScreenshot: { ok: boolean; path?: string; byteLength?: number; reason?: string };
  };
  projected: {
    sheetDump: CssomSheetDumpResult | null;
    clipScreenshot: { ok: boolean; path?: string; byteLength?: number; reason?: string };
  };
  sheetCompare: SheetCompareResult;
  pixelDiff: {
    ok: boolean;
    identical: boolean;
    diffPixels?: number;
    totalPixels?: number;
    diffRatio?: number;
    reason?: string;
    diffPath?: string;
  };
  hypothesis: string[];
};

function buildHypothesis(diag: CssomMatrixDiagnostic): string[] {
  const out: string[] = [];
  if (!diag.sheetCompare.identical) {
    out.push(`sheet dump diverges: ${diag.sheetCompare.notes.join('; ')}`);
  }
  if (diag.pixelDiff.ok && !diag.pixelDiff.identical) {
    out.push(
      `pixel diff: ${diag.pixelDiff.diffPixels}/${diag.pixelDiff.totalPixels} pixels differ (${((diag.pixelDiff.diffRatio ?? 0) * 100).toFixed(1)}%)`,
    );
  }
  if (diag.sheetCompare.identical && diag.pixelDiff.identical) {
    out.push('sheet dump + pixel diff identical — CSSOM matrix pass');
  }
  return out;
}

export async function runCssomMatrixDiagnostic(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  dossier?: DossierHandle | null;
  nestedContextId?: number;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
  getClientSheetDump?: () => Promise<CssomSheetDumpResult | null>;
}): Promise<CssomMatrixDiagnostic> {
  const nestedContextId = opts.nestedContextId ?? 2;
  const session = opts.session as BrowserSession & {
    evaluateVirtualExpression?: (expr: string, contextId?: number) => Promise<unknown>;
    captureViewportClip?: PageProjectionBrowserSession['captureViewportClip'];
  };

  let virtualDump: CssomSheetDumpResult = {
    ok: false,
    reason: 'no_evaluate',
    entries: [],
    styleSheetCount: 0,
    adoptedCount: 0,
    totalRules: 0,
  };
  const dumpRaw = await evaluateVirtualProbe(session, CSSOM_SHEET_DUMP_EXPR, nestedContextId);
  virtualDump = parseCssomSheetDump(dumpRaw);

  let projectedDump: CssomSheetDumpResult | null = null;
  if (opts.getClientSheetDump) {
    projectedDump = await opts.getClientSheetDump();
  }

  const sheetCompare = compareSheetDumps(
    virtualDump,
    projectedDump ?? {
      ok: false,
      reason: 'no_projected_dump',
      entries: [],
      styleSheetCount: 0,
      adoptedCount: 0,
      totalRules: 0,
    },
  );

  const hasProjectedClient = projectedDump?.ok === true;

  let clip: CssomMatrixDiagnostic['clip'] = null;
  const rectRaw = await evaluateVirtualProbe(
    session,
    `(() => { const el = document.getElementById('${CSSOM_MATRIX_CARD_ID}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()`,
    nestedContextId,
  );
  if (typeof rectRaw === 'string') {
      try {
        const r = JSON.parse(rectRaw) as { x: number; y: number; width: number; height: number };
        if (r.width > 0 && r.height > 0) clip = r;
      } catch {
        /* ignore */
      }
    }
  if (!clip) {
    clip = { x: 8, y: 8, width: CSSOM_MATRIX_CARD_SIZE.width, height: CSSOM_MATRIX_CARD_SIZE.height };
  }

  let virtualClipPath: string | undefined;
  let projectedClipPath: string | undefined;
  const pair = await captureClipPair({
    session: opts.session,
    clip,
    projectedCdpUrl: opts.projectedCdpUrl,
    labOrigin: opts.labOrigin,
  });

  if (pair.virtual.ok && pair.virtual.base64 && opts.dossier) {
    virtualClipPath = 'probes/cssom-matrix-virtual-clip.png';
    await writeBinaryArtifact(
      opts.dossier,
      virtualClipPath,
      Buffer.from(pair.virtual.base64, 'base64'),
      'probes.cssomMatrix.virtualClip',
      'image/png',
    );
  }
  if (pair.projected.ok && pair.projected.base64 && opts.dossier) {
    projectedClipPath = 'probes/cssom-matrix-projected-clip.png';
    await writeBinaryArtifact(
      opts.dossier,
      projectedClipPath,
      Buffer.from(pair.projected.base64, 'base64'),
      'probes.cssomMatrix.projectedClip',
      'image/png',
    );
  }

  let pixelDiff: CssomMatrixDiagnostic['pixelDiff'] = {
    ok: false,
    identical: false,
    reason: hasProjectedClient ? 'missing_clips' : 'skipped_no_projected_client',
  };
  if (!hasProjectedClient) {
    /* CLI headless — pixel diff requires UI + projected CDP */
  } else if (pair.virtual.base64 && pair.projected.base64) {
    const diff = await diffPngBase64(pair.virtual.base64, pair.projected.base64, {
      tolerance: 0,
      emitDiffImage: true,
    });
    let diffPath: string | undefined;
    if (diff.diffPngBase64 && opts.dossier) {
      diffPath = 'probes/cssom-matrix-pixel-diff.png';
      await writeBinaryArtifact(
        opts.dossier,
        diffPath,
        Buffer.from(diff.diffPngBase64, 'base64'),
        'probes.cssomMatrix.pixelDiff',
        'image/png',
      );
    }
    pixelDiff = {
      ok: diff.ok,
      identical: diff.identical,
      diffPixels: diff.diffPixels,
      totalPixels: diff.totalPixels,
      diffRatio: diff.diffRatio,
      reason: diff.reason,
      diffPath,
    };
  }

  const diagnostic: CssomMatrixDiagnostic = {
    capturedAt: new Date().toISOString(),
    nestedContextId,
    clip,
    virtual: {
      sheetDump: virtualDump,
      clipScreenshot: {
        ok: pair.virtual.ok === true,
        path: virtualClipPath,
        byteLength: pair.virtual.byteLength,
        reason: pair.virtual.ok ? undefined : pair.virtual.reason,
      },
    },
    projected: {
      sheetDump: projectedDump,
      clipScreenshot: {
        ok: pair.projected.ok === true,
        path: projectedClipPath,
        byteLength: pair.projected.byteLength,
        reason: pair.projected.ok ? undefined : pair.projected.reason,
      },
    },
    sheetCompare,
    pixelDiff,
    hypothesis: [],
  };
  diagnostic.hypothesis = buildHypothesis(diagnostic);
  return diagnostic;
}

export function foldCssomMatrixNested(chassis: LabChassis): LabVerdict[] {
  const diag = (chassis.journal as { cssomMatrix?: CssomMatrixDiagnostic }).cssomMatrix;
  if (!diag) {
    return [{ id: 'cssom.matrix.probe', status: 'fail', reason: 'probe did not run' }];
  }
  const hasProjectedClient = diag.projected.sheetDump?.ok === true;
  const class9aVirtual = verifyClass9a(findSheetEntryByClass(diag.virtual.sheetDump.entries, '9a'));
  const class9bVirtual = verifyClass9b(findSheetEntryByClass(diag.virtual.sheetDump.entries, '9b'));

  const verdicts: LabVerdict[] = [
    { id: 'cssom.matrix.probe', status: 'pass', reason: diag.capturedAt },
    {
      id: 'cssom.matrix.class9a.noCors',
      status: class9aVirtual.ok ? 'pass' : 'fail',
      reason: class9aVirtual.note,
    },
    {
      id: 'cssom.matrix.class9b.cors',
      status: class9bVirtual.ok ? 'pass' : 'fail',
      reason: class9bVirtual.note,
    },
  ];

  if (hasProjectedClient) {
    verdicts.push({
      id: 'cssom.matrix.sheetDump',
      status: diag.sheetCompare.identical ? 'pass' : 'fail',
      reason: diag.sheetCompare.notes[0] ?? (diag.sheetCompare.identical ? 'identical' : 'diverged'),
    });
    verdicts.push({
      id: 'cssom.matrix.pixelDiff',
      status: diag.pixelDiff.ok && diag.pixelDiff.identical ? 'pass' : 'fail',
      reason: diag.hypothesis[0] ?? String(diag.pixelDiff.reason ?? 'pixel diff'),
    });
  } else {
    verdicts.push({
      id: 'cssom.matrix.sheetDump',
      status: 'skipped',
      reason: 'no projected client (CLI headless)',
    });
    verdicts.push({
      id: 'cssom.matrix.pixelDiff',
      status: 'skipped',
      reason: 'no projected client (CLI headless)',
    });
  }
  return verdicts;
}
