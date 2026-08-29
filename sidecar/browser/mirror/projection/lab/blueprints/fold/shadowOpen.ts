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

/** PP-F-4 — closed shadow: tree iso must enter closed `.shadow`; light-only is a fail. */
export function foldShadowClosed(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldApplyAttrs(chassis);
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (!chassis.hasClientRelay) {
    verdicts.push({
      id: 'iso.shadow.closed',
      status: 'fail',
      reason: 'no DOM client — closed shadow apply unproven',
    });
    return verdicts;
  }

  const virtualHosts = iso?.shadow?.virtualHosts ?? 0;
  const clientHosts = iso?.shadow?.clientHosts ?? 0;
  if (virtualHosts === 0) {
    verdicts.push({
      id: 'iso.shadow.closed',
      status: 'fail',
      reason: 'virtual tree has no shadow (light-only snapshot)',
    });
  } else if (clientHosts === 0) {
    verdicts.push({
      id: 'iso.shadow.closed',
      status: 'fail',
      reason: 'Projected host has no ShadowRoot interior in tree',
    });
  } else {
    verdicts.push({
      id: 'iso.shadow.closed',
      status: 'pass',
      reason: `virtualHosts=${virtualHosts} clientHosts=${clientHosts}`,
    });
  }
  return verdicts;
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
