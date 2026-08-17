import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';

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

function verdictFromSnap(id: string, result: SnapResult): LabVerdict {
  if (result.ok === false) return { id: `snap.${id}`, status: 'fail', reason: result.reason ?? 'snapshot failed' };
  if (!result.o2?.identical) return { id: `snap.${id}`, status: 'fail', reason: formatOracle('o2', result.o2) };
  if (!result.cssomO2?.identical) {
    return { id: `snap.${id}`, status: 'fail', reason: formatOracle('cssomO2', result.cssomO2) };
  }
  return { id: `snap.${id}`, status: 'pass', reason: formatOracle('cssomO2', result.cssomO2) };
}

export function foldCssomHeavy(chassis: LabChassis): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  for (const a of chassis.journal.acts) {
    if (!a.ok) verdicts.push({ id: `action.act.${a.name}`, status: 'fail', reason: a.error ?? 'evaluate failed' });
  }
  for (const s of chassis.journal.snaps) {
    verdicts.push(verdictFromSnap(s.id, s.result as SnapResult));
  }
  const theme = chassis.journal.opWindows['theme'];
  if (theme) {
    if (theme.sheetDrop > 0) {
      verdicts.push({
        id: 'ops.theme',
        status: 'fail',
        reason: `SHEET_DROP=${theme.sheetDrop} on in-place theme`,
      });
    } else {
      verdicts.push({
        id: 'ops.theme',
        status: 'pass',
        reason: `sheetDrop=0 ruleSet=${theme.ruleSet} ruleNew=${theme.ruleNew}`,
      });
    }
  }
  if (chassis.desyncs.length > 0) {
    verdicts.push({ id: 'wire.desync', status: 'fail', reason: `desynced events=${chassis.desyncs.length}` });
  } else {
    verdicts.push({ id: 'wire.desync', status: 'pass', reason: 'none' });
  }
  if (chassis.nodeTable.lastApplyError) {
    verdicts.push({ id: 'apply.nodeTable', status: 'fail', reason: chassis.nodeTable.lastApplyError });
  } else {
    verdicts.push({ id: 'apply.nodeTable', status: 'pass', reason: 'phase-1 apply ok' });
  }
  return verdicts;
}
