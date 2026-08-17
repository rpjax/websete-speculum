/**
 * Lab dossier schema (lab-design.md §7) — types + pointer shape.
 */

export type LabSessionMode = 'browse' | 'run';

export type LabSessionStatus =
  | 'booting'
  | 'live'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'faulted';

export type LabSessionRecord = {
  sessionId: string;
  mode: LabSessionMode;
  createdAt: string;
  url: string | null;
  frameRateHz: number;
  headed: boolean;
  telemetry: Record<string, unknown>;
  cpuProfiling: boolean;
  blueprintId: string | null;
  dossierDir: string;
  status: LabSessionStatus;
  fault?: { message: string; at: string };
};

export type LabVerdictStatus = 'pass' | 'fail' | 'skipped';

export type LabVerdict = {
  id: string;
  status: LabVerdictStatus;
  reason: string;
};

export type ManifestEntry = {
  kind: string;
  path: string;
  bytes?: number;
  contentType?: string;
};

export type LabManifest = {
  schema: 'lab-dossier/v1';
  sessionId: string;
  artifacts: ManifestEntry[];
};

export type LabDossierPointer = {
  schema: 'lab-dossier/v1';
  session: 'session.json';
  manifest: 'manifest.json';
  verdicts: 'verdicts.json';
};

export type LabMeta = {
  wallMs: number;
  url: string | null;
  blueprintId: string | null;
  frameRateHz: number;
  options: Record<string, unknown>;
};

/** NDJSON rotate threshold (L6). */
export const LAB_NDJSON_ROTATE_BYTES = 32 * 1024 * 1024;

export const LAB_DOSSIER_POINTER: LabDossierPointer = {
  schema: 'lab-dossier/v1',
  session: 'session.json',
  manifest: 'manifest.json',
  verdicts: 'verdicts.json',
};

export function reportExitCode(verdicts: readonly LabVerdict[]): number {
  return verdicts.some((v) => v.status === 'fail') ? 1 : 0;
}
