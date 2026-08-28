import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldApplyAttrs } from './applyAttrs';
import type { IsoJournal } from './iso';

/** PP-F-SVG-1 — same snap+iso as apply-attrs; ns_mismatch is an explicit fail. */
export function foldSvgNs(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldApplyAttrs(chassis);
  const iso = chassis.journal.iso as IsoJournal | undefined;
  const kinds = iso?.structuralDiff?.divergences?.map((d) => d.kind) ?? [];
  if (kinds.includes('ns_mismatch')) {
    verdicts.push({ id: 'iso.ns', status: 'fail', reason: 'ns_mismatch' });
  }
  return verdicts;
}
