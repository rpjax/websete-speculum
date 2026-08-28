import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldCssomPaintBoundary, foldIsoJournal, type IsoJournal } from './iso';

type SnapResult = {
  ok?: boolean;
  reason?: string;
  o2?: { identical: boolean; divergenceCount: number } | null;
  cssomO2?: { identical: boolean; divergenceCount: number } | null;
  cascade?: {
    authorColor: string;
    adoptedColor: string;
    adoptedCount: number;
    styleSheetCount: number;
    styleElCount: number;
    doublePaint: boolean;
  } | null;
};

function formatOracle(label: string, o: { identical: boolean; divergenceCount: number } | null | undefined): string {
  if (!o) return `${label}=missing`;
  if (o.identical) return `${label}=identical`;
  return `${label} divergences=${o.divergenceCount}`;
}

export function foldCssomDouble(chassis: LabChassis): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  for (const a of chassis.journal.acts) {
    if (!a.ok) verdicts.push({ id: `action.act.${a.name}`, status: 'fail', reason: a.error ?? 'evaluate failed' });
  }
  for (const s of chassis.journal.snaps) {
    const result = s.result as SnapResult;
    if (result.ok === false) {
      verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: result.reason ?? 'snapshot failed' });
      continue;
    }
    if (!result.o2?.identical) {
      verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: formatOracle('o2', result.o2) });
      continue;
    }
    if (!result.cssomO2?.identical) {
      verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: formatOracle('cssomO2', result.cssomO2) });
      continue;
    }
    verdicts.push({
      id: `snap.${s.id}`,
      status: 'pass',
      reason: `${formatOracle('o2', result.o2)}; ${formatOracle('cssomO2', result.cssomO2)}`,
    });
  }

  const iso = chassis.journal.iso as IsoJournal | null | undefined;
  if (iso) {
    verdicts.push(...foldIsoJournal(iso, { requireDomTree: chassis.hasClientRelay }));
    verdicts.push(
      ...foldCssomPaintBoundary(iso.cascade, { requireProjected: chassis.hasClientRelay }),
    );
  } else {
    const settle = chassis.journal.snaps.find((s) => s.id === 'settle');
    const cascade = settle ? (settle.result as SnapResult).cascade : null;
    verdicts.push(
      ...foldCssomPaintBoundary(
        { virtual: cascade ?? null, client: null },
        { requireProjected: chassis.hasClientRelay },
      ),
    );
    verdicts.push({ id: 'iso', status: 'fail', reason: 'iso journal missing' });
  }
  return verdicts;
}
