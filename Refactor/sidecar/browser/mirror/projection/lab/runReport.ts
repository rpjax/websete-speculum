/**
 * Benchmark / lab-run report — always start diagnosis at report.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CpuProfile, CpuProfileSummary } from './cpuProfile';
import type { InvariantCheckSummary } from './frameInvariantMonitor';
import type { MetricsSummary } from './metricsAggregator';
import type { StructuralDiffResult } from './structuralDiff';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { ProjectionTelemetryConfig } from '../models/telemetry';

export type StructuralDiffOutcome =
  | { status: 'ok'; result: StructuralDiffResult }
  | { status: 'unavailable'; reason: string };

export type VerdictStatus = 'pass' | 'fail' | 'skipped';

export type LabVerdict = {
  id: string;
  status: VerdictStatus;
  reason: string;
};

export type BenchmarkReportMeta = {
  timestamp: string;
  url: string;
  requestedDurationMs: number;
  frameRateHz: number;
  options: {
    cpuProfile: boolean;
    invariants: boolean;
    structuralDiff: boolean;
    isomorphism?: boolean;
  };
};

export type LabRunConfig = {
  url: string;
  durationMs: number;
  frameRateHz: number;
  telemetry: Partial<ProjectionTelemetryConfig>;
  cpuProfile: boolean;
  invariants: boolean;
  structuralDiff: boolean;
  isomorphism: boolean;
  outDir?: string;
};

export type EventKindCounts = Record<string, number>;

export type BenchmarkReport = {
  meta: BenchmarkReportMeta;
  config?: LabRunConfig;
  verdicts?: LabVerdict[];
  metrics: MetricsSummary;
  cpuProfile: { summary: CpuProfileSummary; profileFile: string } | null;
  invariants: InvariantCheckSummary[] | null;
  structuralDiff: StructuralDiffOutcome | null;
  isomorphism?: {
    sequence: number | null;
    generation: number | null;
    o2: TableLiveOracleResult | null;
    table?: {
      virtual: { rowCount: number; tableHash: string } | null;
      client: { rowCount: number; tableHash: string } | null;
      identical: boolean | null;
    };
    structuralDiff: StructuralDiffResult | null;
  } | null;
  events?: { counts: EventKindCounts; desyncs: unknown[] };
  artifacts?: { kind: string; path: string }[];
};

export type WrittenRunReport = { reportDir: string; reportPath: string; cpuProfilePath: string | null };

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function urlSlug(url: string): string {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    // not a full URL
  }
  const slug = host.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'run';
}

export function defaultLabRunsDir(): string {
  return path.join(process.cwd(), 'lab-runs');
}

export function reportExitCode(report: BenchmarkReport): number {
  const verdicts = report.verdicts ?? [];
  return verdicts.some((v) => v.status === 'fail') ? 1 : 0;
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
  const artifacts = [...(report.artifacts ?? [])];
  if (rawCpuProfile !== null && report.cpuProfile !== null) {
    cpuProfilePath = path.join(reportDir, report.cpuProfile.profileFile);
    await fs.promises.writeFile(cpuProfilePath, JSON.stringify(rawCpuProfile), 'utf8');
    artifacts.push({ kind: 'cpuProfile', path: report.cpuProfile.profileFile });
  }

  const finalReport: BenchmarkReport = { ...report, artifacts };
  const reportPath = path.join(reportDir, 'report.json');
  await fs.promises.writeFile(reportPath, JSON.stringify(finalReport, jsonSafeReplacer, 2), 'utf8');

  return { reportDir, reportPath, cpuProfilePath };
}
