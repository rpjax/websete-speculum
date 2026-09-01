import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldApplyAttrs } from './applyAttrs';
import type { IsoJournal } from './iso';

/** PP-PROP-1 — same snap+iso as apply-attrs; form property mismatch fails when a DOM client is present. */
export function foldFormsState(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldApplyAttrs(chassis);
  if (!chassis.hasClientRelay) return verdicts;

  const iso = chassis.journal.iso as IsoJournal | undefined;
  const nameV = iso?.formProps?.virtual?.find((c) => c.key === 'name');
  const nameC = iso?.formProps?.client?.find((c) => c.key === 'name');
  if (nameV?.value && nameC?.value != null && nameV.value !== nameC.value) {
    verdicts.push({
      id: 'iso.formProps.name',
      status: 'fail',
      reason: `Virtual #name=${nameV.value} Projected #name=${nameC.value}`,
    });
  }
  return verdicts;
}
