/**
 * Lab runs index + detail — reads sharded dossiers from lab-runs/.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type LabManifest,
  type LabMeta,
  type LabSessionRecord,
  type LabVerdict,
  type ManifestEntry,
  reportExitCode,
} from './types';
import { defaultLabRunsDir as runsDirFn } from './write';

export { defaultLabRunsDir } from './write';

export type RunVerdictSummary = {
  pass: number;
  fail: number;
  skipped: number;
};

export type RunSummary = {
  id: string;
  dir: string;
  createdAt: string;
  mode: 'browse' | 'run';
  status: string;
  blueprintId: string | null;
  url: string | null;
  wallMs: number | null;
  headed: boolean;
  verdicts: RunVerdictSummary;
  exitCode: number;
};

export type TimelineEntry = {
  actionId: string;
  queue: string;
  startedAt: string;
  endedAt: string;
  status: string;
  detail?: string;
};

export type ActEntry = {
  name: string;
  ok: boolean;
  error?: string;
};

export type LabRunDetail = {
  id: string;
  dir: string;
  session: LabSessionRecord;
  meta: LabMeta | null;
  verdicts: LabVerdict[];
  manifest: LabManifest | null;
  timeline: TimelineEntry[];
  acts: ActEntry[];
  blueprint: Record<string, unknown> | null;
  probes: {
    metrics: Record<string, unknown> | null;
    inputPipeline: Record<string, unknown> | null;
    iso: Record<string, unknown> | null;
    isoBrowse: Record<string, unknown> | null;
  };
  crash: Record<string, unknown> | null;
  telemetryCounts: Record<string, unknown> | null;
};

function readJsonFile<T>(fullPath: string): T | null {
  try {
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function summarizeVerdicts(verdicts: readonly LabVerdict[]): RunVerdictSummary {
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  for (const v of verdicts) {
    if (v.status === 'pass') pass += 1;
    else if (v.status === 'fail') fail += 1;
    else skipped += 1;
  }
  return { pass, fail, skipped };
}

function resolveRunsRoot(baseDir?: string): string {
  return baseDir ?? runsDirFn();
}

export function resolveRunDir(runId: string, baseDir?: string): string | null {
  const root = resolveRunsRoot(baseDir);
  const decoded = decodeURIComponent(runId);
  const full = path.normalize(path.join(root, decoded));
  if (!full.startsWith(path.normalize(root))) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return null;
  return full;
}

export function resolveRunArtifactPath(
  runId: string,
  relPath: string,
  baseDir?: string,
): string | null {
  const runDir = resolveRunDir(runId, baseDir);
  if (!runDir) return null;
  const decoded = decodeURIComponent(relPath.replace(/^\/+/, ''));
  const full = path.normalize(path.join(runDir, decoded));
  if (!full.startsWith(path.normalize(runDir))) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function summaryFromDir(dir: string, id: string): RunSummary | null {
  const session = readJsonFile<LabSessionRecord>(path.join(dir, 'session.json'));
  if (!session) return null;
  const meta = readJsonFile<LabMeta>(path.join(dir, 'meta.json'));
  const verdicts = readJsonFile<LabVerdict[]>(path.join(dir, 'verdicts.json')) ?? [];
  const vSum = summarizeVerdicts(verdicts);
  return {
    id,
    dir,
    createdAt: session.createdAt,
    mode: session.mode,
    status: session.status,
    blueprintId: session.blueprintId ?? meta?.blueprintId ?? null,
    url: session.url ?? meta?.url ?? null,
    wallMs: meta?.wallMs ?? null,
    headed: session.headed,
    verdicts: vSum,
    exitCode: reportExitCode(verdicts),
  };
}

export async function listLabRuns(baseDir?: string): Promise<RunSummary[]> {
  const root = resolveRunsRoot(baseDir);
  if (!fs.existsSync(root)) return [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const runs: RunSummary[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const summary = summaryFromDir(path.join(root, ent.name), ent.name);
    if (summary) runs.push(summary);
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return runs;
}

export async function loadLabRunDetail(runId: string, baseDir?: string): Promise<LabRunDetail | null> {
  const dir = resolveRunDir(runId, baseDir);
  if (!dir) return null;
  const session = readJsonFile<LabSessionRecord>(path.join(dir, 'session.json'));
  if (!session) return null;

  return {
    id: runId,
    dir,
    session,
    meta: readJsonFile<LabMeta>(path.join(dir, 'meta.json')),
    verdicts: readJsonFile<LabVerdict[]>(path.join(dir, 'verdicts.json')) ?? [],
    manifest: readJsonFile<LabManifest>(path.join(dir, 'manifest.json')),
    timeline: readJsonFile<TimelineEntry[]>(path.join(dir, 'journal/timeline.json')) ?? [],
    acts: readJsonFile<ActEntry[]>(path.join(dir, 'journal/acts.json')) ?? [],
    blueprint: readJsonFile<Record<string, unknown>>(path.join(dir, 'blueprint.json')),
    probes: {
      metrics: readJsonFile<Record<string, unknown>>(path.join(dir, 'probes/metrics.json')),
      inputPipeline: readJsonFile<Record<string, unknown>>(path.join(dir, 'probes/input-pipeline.json')),
      iso: readJsonFile<Record<string, unknown>>(path.join(dir, 'probes/iso.json')),
      isoBrowse: readJsonFile<Record<string, unknown>>(path.join(dir, 'probes/iso-browse.json')),
    },
    crash: readJsonFile<Record<string, unknown>>(path.join(dir, 'crash.json')),
    telemetryCounts: readJsonFile<Record<string, unknown>>(path.join(dir, 'telemetry/counts.json')),
  };
}

export function listManifestArtifacts(manifest: LabManifest | null): ManifestEntry[] {
  if (!manifest?.artifacts?.length) return [];
  return [...manifest.artifacts].sort((a, b) => a.path.localeCompare(b.path));
}

export async function deleteLabRun(runId: string, baseDir?: string): Promise<boolean> {
  const dir = resolveRunDir(runId, baseDir);
  if (!dir) return false;
  await fs.promises.rm(dir, { recursive: true, force: true });
  return true;
}

export type DeleteLabRunsResult = {
  deleted: string[];
  failed: string[];
};

export async function deleteLabRuns(runIds: readonly string[], baseDir?: string): Promise<DeleteLabRunsResult> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of runIds) {
    if (await deleteLabRun(id, baseDir)) deleted.push(id);
    else failed.push(id);
  }
  return { deleted, failed };
}
