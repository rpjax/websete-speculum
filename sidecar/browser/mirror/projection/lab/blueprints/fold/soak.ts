import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldIsoJournal, type IsoJournal } from './iso';

export function foldSoak(
  chassis: LabChassis,
  overrides?: { cpu?: boolean; iso?: boolean; invariants?: boolean },
): LabVerdict[] {
  const verdicts: LabVerdict[] = [];
  const o = overrides ?? {};

  if (o.cpu !== true) {
    verdicts.push({ id: 'cpu', status: 'skipped', reason: 'cpu not requested' });
  } else if ((chassis.journal as unknown as { cpuSummary?: { totalSamples: number } }).cpuSummary) {
    const s = (chassis.journal as unknown as { cpuSummary: { totalSamples: number } }).cpuSummary;
    verdicts.push({ id: 'cpu', status: 'pass', reason: `samples=${s.totalSamples}` });
  } else {
    verdicts.push({ id: 'cpu', status: 'skipped', reason: 'no cpu summary' });
  }

  if (o.invariants === false) {
    verdicts.push({ id: 'invariant', status: 'skipped', reason: 'invariants not requested' });
  } else {
    for (const check of chassis.invariantMonitor.getSummary()) {
      verdicts.push({
        id: `invariant.${check.id}`,
        status: check.failCount === 0 ? 'pass' : 'fail',
        reason:
          check.failCount === 0
            ? `${check.passCount} passes`
            : `${check.failCount} fails (${check.failures[0]?.details ?? check.description})`,
      });
    }
  }

  const iso = chassis.journal.iso as IsoJournal | null | undefined;
  if (iso) {
    verdicts.push(...foldIsoJournal(iso, { requireDomTree: chassis.hasClientRelay }));
  } else if (o.iso === true) {
    verdicts.push({ id: 'iso.dom', status: 'fail', reason: 'iso journal missing' });
    verdicts.push({ id: 'probe.nodeNewConnected', status: 'fail', reason: 'iso journal missing' });
  } else {
    verdicts.push({ id: 'iso.dom', status: 'skipped', reason: 'iso not requested' });
    verdicts.push({ id: 'probe.nodeNewConnected', status: 'fail', reason: 'iso journal missing' });
  }

  return verdicts;
}
