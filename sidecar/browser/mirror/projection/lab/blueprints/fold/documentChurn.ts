import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';

export type DocumentChurnJournal = {
  established?: boolean;
  installTelemetry?: {
    installCount: number;
    lastInstallUrl: string | null;
    lastGeneration: number | null;
    events: Array<{ generation: number; url: string; installKind: string; t: string; installedAtMs?: number }>;
    installSpacingMs?: number[];
    maxSpacingMs?: number | null;
  };
  bootOutcome?: { ok: boolean; reason: string; href?: string } | null;
};

export function foldDocumentChurn(chassis: LabChassis): LabVerdict[] {
  const journal = chassis.journal as DocumentChurnJournal;
  const verdicts: LabVerdict[] = [];

  if (journal.established === true) {
    verdicts.push({ id: 'launch.churn.established', status: 'pass', reason: 'data plane established' });
  } else {
    verdicts.push({
      id: 'launch.churn.established',
      status: 'fail',
      reason: journal.bootOutcome?.reason ?? 'not established',
    });
  }

  const tel = journal.installTelemetry;
  if (tel && tel.installCount >= 1) {
    verdicts.push({
      id: 'launch.churn.installCount',
      status: 'pass',
      reason: `installCount=${tel.installCount} lastGen=${tel.lastGeneration ?? '?'}`,
    });
  } else {
    verdicts.push({
      id: 'launch.churn.installCount',
      status: 'fail',
      reason: 'no document.install telemetry',
    });
  }

  if (tel && tel.events.length >= 1 && tel.events.every((e) => typeof e.t === 'string')) {
    const spacingNote =
      tel.installSpacingMs && tel.installSpacingMs.length > 0
        ? ` spacingMs=[${tel.installSpacingMs.join(',')}] max=${tel.maxSpacingMs ?? '?'}`
        : '';
    verdicts.push({
      id: 'launch.churn.timeline',
      status: 'pass',
      reason: `timeline events=${tel.events.length}${spacingNote}`,
    });
  } else {
    verdicts.push({
      id: 'launch.churn.timeline',
      status: 'fail',
      reason: 'install timeline missing or incomplete',
    });
  }

  return verdicts;
}
