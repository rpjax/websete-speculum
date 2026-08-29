import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldIsoJournal, type IsoJournal } from './iso';
import { foldCssomMatrixNested as foldMatrixProbe } from '../../probes/cssomMatrixDiagnostic';

type SnapResult = {
  ok?: boolean;
  reason?: string;
  cssomO2?: { identical: boolean; divergenceCount: number } | null;
  contexts?: Record<
    number,
    { cssomO2?: { identical: boolean; divergenceCount: number } | null; ok?: boolean }
  >;
};

function snapCssomVerdict(id: string, snap: SnapResult | undefined): LabVerdict {
  if (!snap || snap.ok === false) {
    return { id, status: 'fail', reason: snap?.reason ?? 'snap missing' };
  }
  if (!snap.cssomO2?.identical) {
    return {
      id,
      status: 'fail',
      reason: `cssomO2 divergences=${snap.cssomO2?.divergenceCount ?? '?'}`,
    };
  }
  return { id, status: 'pass', reason: 'cssomO2 identical' };
}

export function foldCssomMatrixNested(chassis: LabChassis): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (iso) verdicts.push(...foldIsoJournal(iso));

  const settle = chassis.journal.snaps.find((s) => s.id === 'settle')?.result as SnapResult | undefined;
  verdicts.push(snapCssomVerdict('cssom.matrix.iso.root', settle));

  const isoCtx2 = (chassis.journal.iso as { contexts?: Record<number, { cssomO2?: { identical: boolean; divergenceCount: number } }> } | undefined)?.contexts?.[2];
  if (isoCtx2?.cssomO2) {
    verdicts.push(
      isoCtx2.cssomO2.identical
        ? { id: 'cssom.matrix.iso.context2', status: 'pass', reason: 'nested cssomO2 identical' }
        : {
            id: 'cssom.matrix.iso.context2',
            status: 'fail',
            reason: `nested cssomO2 divergences=${isoCtx2.cssomO2.divergenceCount ?? '?'}`,
          },
    );
  } else {
    verdicts.push({ id: 'cssom.matrix.iso.context2', status: 'fail', reason: 'nested iso context missing' });
  }

  verdicts.push(...foldMatrixProbe(chassis));
  return verdicts;
}
