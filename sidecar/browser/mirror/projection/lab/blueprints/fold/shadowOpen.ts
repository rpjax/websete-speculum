import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldApplyAttrs } from './applyAttrs';
import type { IsoJournal } from './iso';

/** PP-F-3 — open named shadow: tree iso must enter `.shadow`; light-only is a fail. */
export function foldShadowOpen(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldApplyAttrs(chassis);
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (!chassis.hasClientRelay) return verdicts;

  const virtualHosts = iso?.shadow?.virtualHosts ?? 0;
  const clientHosts = iso?.shadow?.clientHosts ?? 0;
  if (virtualHosts === 0) {
    verdicts.push({
      id: 'iso.shadow',
      status: 'fail',
      reason: 'virtual tree has no shadow (light-only snapshot)',
    });
  } else if (clientHosts === 0) {
    verdicts.push({
      id: 'iso.shadow',
      status: 'fail',
      reason: 'Projected host has no ShadowRoot',
    });
  } else {
    verdicts.push({
      id: 'iso.shadow',
      status: 'pass',
      reason: `virtualHosts=${virtualHosts} clientHosts=${clientHosts}`,
    });
  }
  return verdicts;
}

/** PP-F-4 — closed shadow is NIT; never soft-skip. */
export function foldShadowClosed(_chassis: LabChassis): LabVerdict[] {
  return [
    {
      id: 'unsupported.shadow.closed',
      status: 'fail',
      reason: 'closed shadow is NIT (PP-F-4)',
    },
  ];
}

/** Manual slotAssignment is NIT; never soft-skip. */
export function foldShadowManual(_chassis: LabChassis): LabVerdict[] {
  return [
    {
      id: 'unsupported.shadow.manual',
      status: 'fail',
      reason: 'slotAssignment=manual is NIT',
    },
  ];
}
