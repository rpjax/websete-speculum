/**
 * Generic paint diff probe — Virtual + Projected clip capture and PNG compare.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { DossierHandle } from '../dossier/write';
import { writeBinaryArtifact } from '../dossier/write';
import { captureClipPair } from './paintCapture';
import { diffPngBase64 } from './pixelDiff';

export type PaintDiffDiagnostic = {
  capturedAt: string;
  contextId: number;
  clip: { x: number; y: number; width: number; height: number };
  virtual: { ok: boolean; path?: string; byteLength?: number; reason?: string };
  projected: { ok: boolean; path?: string; byteLength?: number; reason?: string };
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

export async function runPaintDiffProbe(opts: {
  chassis: LabChassis;
  session: BrowserSession;
  dossier?: DossierHandle | null;
  contextId?: number;
  clip: { x: number; y: number; width: number; height: number };
  artifactPrefix?: string;
  projectedCdpUrl?: string | null;
  labOrigin?: string;
}): Promise<PaintDiffDiagnostic> {
  const contextId = opts.contextId ?? 1;
  const prefix = opts.artifactPrefix ?? 'paint-diff';
  const pair = await captureClipPair({
    session: opts.session,
    clip: opts.clip,
    projectedCdpUrl: opts.projectedCdpUrl,
    labOrigin: opts.labOrigin,
  });

  let virtualPath: string | undefined;
  let projectedPath: string | undefined;
  if (pair.virtual.ok && pair.virtual.base64 && opts.dossier) {
    virtualPath = `probes/${prefix}-virtual-clip.png`;
    await writeBinaryArtifact(
      opts.dossier,
      virtualPath,
      Buffer.from(pair.virtual.base64, 'base64'),
      `probes.${prefix}.virtualClip`,
      'image/png',
    );
  }
  if (pair.projected.ok && pair.projected.base64 && opts.dossier) {
    projectedPath = `probes/${prefix}-projected-clip.png`;
    await writeBinaryArtifact(
      opts.dossier,
      projectedPath,
      Buffer.from(pair.projected.base64, 'base64'),
      `probes.${prefix}.projectedClip`,
      'image/png',
    );
  }

  let pixelDiff: PaintDiffDiagnostic['pixelDiff'] = {
    ok: false,
    identical: false,
    reason: 'missing_clips',
  };
  if (pair.virtual.base64 && pair.projected.base64) {
    const diff = await diffPngBase64(pair.virtual.base64, pair.projected.base64, {
      tolerance: 0,
      emitDiffImage: true,
    });
    let diffPath: string | undefined;
    if (diff.diffPngBase64 && opts.dossier) {
      diffPath = `probes/${prefix}-pixel-diff.png`;
      await writeBinaryArtifact(
        opts.dossier,
        diffPath,
        Buffer.from(diff.diffPngBase64, 'base64'),
        `probes.${prefix}.pixelDiff`,
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

  const hypothesis: string[] = [];
  if (pixelDiff.ok && !pixelDiff.identical) {
    hypothesis.push(
      `pixel diff: ${pixelDiff.diffPixels}/${pixelDiff.totalPixels} (${((pixelDiff.diffRatio ?? 0) * 100).toFixed(1)}%)`,
    );
  } else if (pixelDiff.identical) {
    hypothesis.push('pixel diff identical');
  } else {
    hypothesis.push(String(pixelDiff.reason ?? 'clip capture failed'));
  }

  return {
    capturedAt: new Date().toISOString(),
    contextId,
    clip: opts.clip,
    virtual: {
      ok: pair.virtual.ok === true,
      path: virtualPath,
      byteLength: pair.virtual.byteLength,
      reason: pair.virtual.ok ? undefined : pair.virtual.reason,
    },
    projected: {
      ok: pair.projected.ok === true,
      path: projectedPath,
      byteLength: pair.projected.byteLength,
      reason: pair.projected.ok ? undefined : pair.projected.reason,
    },
    pixelDiff,
    hypothesis,
  };
}

export function foldPaintDiff(
  chassis: LabChassis,
  journalKey: string,
  verdictId: string,
): LabVerdict[] {
  const diag = (chassis.journal as unknown as Record<string, PaintDiffDiagnostic | undefined>)[journalKey];
  if (!diag) {
    return [{ id: `${verdictId}.probe`, status: 'fail', reason: 'probe did not run' }];
  }
  return [
    { id: `${verdictId}.probe`, status: 'pass', reason: diag.capturedAt },
    {
      id: `${verdictId}.pixelDiff`,
      status: diag.pixelDiff.ok && diag.pixelDiff.identical ? 'pass' : 'fail',
      reason: diag.hypothesis[0] ?? String(diag.pixelDiff.reason ?? 'pixel diff'),
    },
  ];
}
