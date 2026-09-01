import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import type { LaunchTelemetryDiagnostic } from '../../probes/launchTelemetryProbe';

export type DocumentChurnJournal = {
  established?: boolean;
  launchTelemetry?: LaunchTelemetryDiagnostic;
  installTelemetry?: LaunchTelemetryDiagnostic['installTelemetry'];
  bootOutcome?: LaunchTelemetryDiagnostic['bootOutcome'];
  /** Expected minimum installs from blueprint (nav churn n=3 → 4 documents). */
  expectedMinInstalls?: number;
};

const DEFAULT_MIN_INSTALLS = 4;

export function foldDocumentChurn(chassis: LabChassis): LabVerdict[] {
  const journal = chassis.journal as DocumentChurnJournal;
  const telProbe = journal.launchTelemetry;
  const tel = journal.installTelemetry ?? telProbe?.installTelemetry ?? null;
  const bootOutcome = journal.bootOutcome ?? telProbe?.bootOutcome ?? null;
  const gate = telProbe?.gateTiming;
  const minInstalls = journal.expectedMinInstalls ?? DEFAULT_MIN_INSTALLS;
  const verdicts: LabVerdict[] = [];

  if (journal.established === true) {
    verdicts.push({ id: 'launch.churn.established', status: 'pass', reason: 'data plane established' });
  } else {
    verdicts.push({
      id: 'launch.churn.established',
      status: 'fail',
      reason: bootOutcome?.reason ?? 'not established',
    });
  }

  if (gate?.configGateMs != null) {
    verdicts.push({
      id: 'launch.churn.configGateMs',
      status: 'pass',
      reason: `configGateMs=${gate.configGateMs} attempts=${gate.configGateAttempts ?? '?'}`,
    });
  } else {
    verdicts.push({
      id: 'launch.churn.configGateMs',
      status: 'skipped',
      reason: 'config gate timing not captured (no boot outcome)',
    });
  }

  if (tel && tel.installCount >= minInstalls) {
    verdicts.push({
      id: 'launch.churn.installCount',
      status: 'pass',
      reason: `installCount=${tel.installCount} min=${minInstalls} lastGen=${tel.lastGeneration ?? '?'}`,
    });
  } else {
    verdicts.push({
      id: 'launch.churn.installCount',
      status: 'fail',
      reason: `installCount=${tel?.installCount ?? 0} expected>=${minInstalls}`,
    });
  }

  if (tel && tel.events.length >= 1 && tel.events.every((e) => typeof e.t === 'string')) {
    const spacingNote =
      tel.installSpacingMs && tel.installSpacingMs.length > 0
        ? ` spacingMs=[${tel.installSpacingMs.join(',')}] max=${tel.maxSpacingMs ?? '?'}`
        : '';
    verdicts.push({
      id: 'launch.churn.timeline',
      status: tel.installSpacingMs && tel.installSpacingMs.length > 0 ? 'pass' : 'skipped',
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
