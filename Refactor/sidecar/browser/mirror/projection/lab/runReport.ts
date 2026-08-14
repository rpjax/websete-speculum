/**
 * Benchmark run report — the "export detailed results to a local folder" half of the
 * consolidation (per-run `report.json` + raw `.cpuprofile`), so a run can be diagnosed offline
 * without re-running it just to generate more Cursor-side tokens of ad-hoc script output.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CpuProfile, CpuProfileSummary } from './cpuProfile';
import type { InvariantCheckSummary } from './frameInvariantMonitor';
import type { MetricsSummary } from './metricsAggregator';
import type { StructuralDiffResult } from './structuralDiff';

export type StructuralDiffOutcome =
  | { status: 'ok'; result: StructuralDiffResult }
  | { status: 'unavailable'; reason: string };

export type BenchmarkReportMeta = {
  timestamp: string;
  url: string;
  requestedDurationMs: number;
  frameRateHz: number;
  options: { cpuProfile: boolean; invariants: boolean; structuralDiff: boolean };
};

export type BenchmarkReport = {
  meta: BenchmarkReportMeta;
  metrics: MetricsSummary;
  cpuProfile: { summary: CpuProfileSummary; profileFile: string } | null;
  invariants: InvariantCheckSummary[] | null;
  structuralDiff: StructuralDiffOutcome | null;
};

export type WrittenRunReport = { reportDir: string; reportPath: string; cpuProfilePath: string | null };

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Filesystem-safe slug from a run's target URL, for the report directory name. */
export function urlSlug(url: string): string {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    // not a full URL (e.g. a bare fixture name) — fall through to the raw string
  }
  const slug = host.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'run';
}

export function defaultLabRunsDir(): string {
  return path.join(process.cwd(), 'lab-runs');
}

export async function writeRunReport(
  baseDir: string,
  report: BenchmarkReport,
  rawCpuProfile: CpuProfile | null,
): Promise<WrittenRunReport> {
  const timestamp = report.meta.timestamp.replace(/[:.]/g, '-');
  const reportDir = path.join(baseDir, `${timestamp}-${urlSlug(report.meta.url)}`);
  await fs.promises.mkdir(reportDir, { recursive: true });

  let cpuProfilePath: string | null = null;
  const finalReport: BenchmarkReport = report;
  if (rawCpuProfile !== null && report.cpuProfile !== null) {
    cpuProfilePath = path.join(reportDir, report.cpuProfile.profileFile);
    await fs.promises.writeFile(cpuProfilePath, JSON.stringify(rawCpuProfile), 'utf8');
  }

  const reportPath = path.join(reportDir, 'report.json');
  await fs.promises.writeFile(reportPath, JSON.stringify(finalReport, jsonSafeReplacer, 2), 'utf8');

  return { reportDir, reportPath, cpuProfilePath };
}
