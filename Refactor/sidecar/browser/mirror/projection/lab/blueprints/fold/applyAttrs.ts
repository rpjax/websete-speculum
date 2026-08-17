import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldIsoJournal, type IsoJournal } from './iso';

type SnapResult = {
  ok?: boolean;
  reason?: string;
  o2?: { identical: boolean; divergenceCount: number } | null;
  cssomO2?: { identical: boolean; divergenceCount: number } | null;
};

function formatOracle(label: string, o: { identical: boolean; divergenceCount: number } | null | undefined): string {
  if (!o) return `${label}=missing`;
  if (o.identical) return `${label}=identical`;
  return `${label} divergences=${o.divergenceCount}`;
}

export function foldApplyAttrs(chassis: LabChassis): LabVerdict[] {
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
    verdicts.push({ id: `snap.${s.id}`, status: 'pass', reason: formatOracle('o2', result.o2) });
  }
  if (chassis.journal.iso) {
    verdicts.push(...foldIsoJournal(chassis.journal.iso as IsoJournal, { requireDomTree: chassis.hasClientRelay }));
  }
  return verdicts;
}
