import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTurnstileDiagnostic } from '../../probes/turnstileDiagnostic';
import { foldNestedApplyFailure } from '../../probes/nestedApplyFailureDiagnostic';
import { foldTurnstileRectLadder } from '../../probes/turnstileRectLadder';
import { foldTurnstilePaint } from '../../probes/turnstilePaintDiagnostic';
import { foldIsoJournal, type IsoJournal } from './iso';
import type { CssomSheetDumpResult } from '../../probes/cssomSheetDump';

export function foldTurnstile(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldTurnstileDiagnostic(chassis);
  verdicts.push(...foldNestedApplyFailure(chassis));
  verdicts.push(...foldTurnstileRectLadder(chassis));
  verdicts.push(...foldTurnstilePaint(chassis));

  const sheetPayload = (chassis.journal as { cssomSheetDump?: { virtual?: CssomSheetDumpResult } })
    .cssomSheetDump;
  if (sheetPayload?.virtual?.ok) {
    verdicts.push({
      id: 'turnstile.sheetDump',
      status: 'pass',
      reason: `virtual sheets=${sheetPayload.virtual.styleSheetCount} rules=${sheetPayload.virtual.totalRules}`,
    });
  } else if (sheetPayload) {
    verdicts.push({
      id: 'turnstile.sheetDump',
      status: 'skipped',
      reason: 'sheet dump captured but virtual incomplete',
    });
  }

  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (iso) {
    verdicts.push(...foldIsoJournal(iso, { requireDomTree: chassis.hasClientRelay }));
  }
  return verdicts;
}
