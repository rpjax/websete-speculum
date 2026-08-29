import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTurnstileDiagnostic } from '../../probes/turnstileDiagnostic';
import { foldNestedApplyFailure } from '../../probes/nestedApplyFailureDiagnostic';
import { foldTurnstileRectLadder } from '../../probes/turnstileRectLadder';
import { foldTurnstilePaint } from '../../probes/turnstilePaintDiagnostic';
import { foldIsoJournal, type IsoJournal } from './iso';

export function foldTurnstile(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldTurnstileDiagnostic(chassis);
  verdicts.push(...foldNestedApplyFailure(chassis));
  verdicts.push(...foldTurnstileRectLadder(chassis));
  verdicts.push(...foldTurnstilePaint(chassis));
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (iso) {
    verdicts.push(...foldIsoJournal(iso, { requireDomTree: chassis.hasClientRelay }));
  }
  return verdicts;
}
