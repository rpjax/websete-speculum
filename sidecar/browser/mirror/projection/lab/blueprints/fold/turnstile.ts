import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTurnstileDiagnostic } from '../../probes/turnstileDiagnostic';
import { foldIsoJournal, type IsoJournal } from './iso';

export function foldTurnstile(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldTurnstileDiagnostic(chassis);
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (iso) {
    verdicts.push(...foldIsoJournal(iso, { requireDomTree: chassis.hasClientRelay }));
  }
  return verdicts;
}
