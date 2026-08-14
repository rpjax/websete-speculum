/**
 * Lab run suite — duration wait, optional CPU / invariants / iso, write dossier.
 * Used by LabSession (UI) and lab/runCli.ts (agent).
 */

import type { BrowserSession } from '../../../BrowserSession';
import type { CpuProfile, CpuProfileSummary } from './cpuProfile';
import { summarizeProfile } from './cpuProfile';
import { FrameInvariantMonitor } from './frameInvariantMonitor';
import { runIsomorphism, type ClientStateSnapshot } from './isomorphism';
import { MetricsAggregator } from './metricsAggregator';
import {
  defaultLabRunsDir,
  writeRunReport,
  type BenchmarkReport,
  type LabRunConfig,
  type LabVerdict,
  type WrittenRunReport,
} from './runReport';
import type { ProjectionTelemetryMessage } from '../models/telemetry';

export type LabRunHooks = {
  session: BrowserSession;
  observeFrameBytes: (buf: Uint8Array) => void;
  observeTelemetry: (msg: ProjectionTelemetryMessage) => void;
  requestClientSnapshot?: () => Promise<ClientStateSnapshot | null> | ClientStateSnapshot | null;
};

export type LabRunRequest = LabRunConfig;

export type LabRunResult = {
  report: BenchmarkReport;
  written: WrittenRunReport;
};

export function createRunCollectors(): {
  metrics: MetricsAggregator;
  invariantMonitor: FrameInvariantMonitor;
  eventCounts: Record<string, number>;
  desyncs: unknown[];
  observeFrameBytes: (buf: Uint8Array) => void;
  observeTelemetry: (msg: ProjectionTelemetryMessage) => void;
} {
  const metrics = new MetricsAggregator();
  const invariantMonitor = new FrameInvariantMonitor();
  const eventCounts: Record<string, number> = {};
  const desyncs: unknown[] = [];
  return {
    metrics,
    invariantMonitor,
    eventCounts,
    desyncs,
    observeFrameBytes(buf) {
      metrics.observeWireBytes(buf.length);
      invariantMonitor.observeFrameBytes(buf);
    },
    observeTelemetry(msg) {
      metrics.observeTelemetry(msg);
      invariantMonitor.observeTelemetry(msg);
      eventCounts[msg.kind] = (eventCounts[msg.kind] ?? 0) + 1;
      if (msg.kind === 'desynced') desyncs.push(msg);
    },
  };
}

export async function executeLabRun(
  hooks: LabRunHooks,
  req: LabRunRequest,
  collectors: ReturnType<typeof createRunCollectors>,
): Promise<LabRunResult> {
  const startedAt = Date.now();
  const verdicts: LabVerdict[] = [];
  let cpuRaw: CpuProfile | null = null;
  let cpuSummary: CpuProfileSummary | null = null;

  let cpuStarted = false;
  if (req.cpuProfile) {
    const start = await hooks.session.startCpuProfile?.();
    if (!start?.ok) {
      verdicts.push({
        id: 'cpu',
        status: 'skipped',
        reason: start?.reason ?? 'startCpuProfile not available',
      });
    } else {
      cpuStarted = true;
    }
  } else {
    verdicts.push({ id: 'cpu', status: 'skipped', reason: 'cpuProfile not requested' });
  }

  await new Promise<void>((resolve) => setTimeout(resolve, req.durationMs));
  const wallMs = Date.now() - startedAt;

  if (cpuStarted && hooks.session.stopCpuProfile) {
    const stop = await hooks.session.stopCpuProfile();
    if (stop.ok && stop.profileBytes) {
      cpuRaw = JSON.parse(new TextDecoder().decode(stop.profileBytes)) as CpuProfile;
      cpuSummary = summarizeProfile(cpuRaw, 20);
      verdicts.push({ id: 'cpu', status: 'pass', reason: `samples=${cpuSummary.totalSamples}` });
    } else if (!verdicts.some((v) => v.id === 'cpu')) {
      verdicts.push({ id: 'cpu', status: 'skipped', reason: stop.reason ?? 'stopCpuProfile failed' });
    }
  }

  let structuralDiff: BenchmarkReport['structuralDiff'] = null;
  if (!req.structuralDiff) {
    verdicts.push({ id: 'structuralDiff', status: 'skipped', reason: 'structuralDiff not requested' });
  } else if (req.isomorphism) {
    verdicts.push({
      id: 'structuralDiff',
      status: 'skipped',
      reason: 'structuralDiff deferred to isomorphism probe at sequence S',
    });
  } else if (!hooks.requestClientSnapshot) {
    structuralDiff = { status: 'unavailable', reason: 'structuralDiff unavailable: no lab client apply surface' };
    verdicts.push({ id: 'structuralDiff', status: 'skipped', reason: structuralDiff.reason });
  } else {
    const isoOnly = await runIsomorphism({
      session: hooks.session,
      getClientSnapshot: hooks.requestClientSnapshot,
    });
    if (isoOnly.structuralDiff) {
      structuralDiff = { status: 'ok', result: isoOnly.structuralDiff };
      verdicts.push({
        id: 'structuralDiff',
        status: isoOnly.structuralDiff.identical ? 'pass' : 'fail',
        reason: isoOnly.structuralDiff.identical
          ? 'identical'
          : `${isoOnly.structuralDiff.divergenceCount} divergences`,
      });
    } else {
      const skip = isoOnly.skipped.find((s) => s.id === 'structuralDiff');
      structuralDiff = { status: 'unavailable', reason: skip?.reason ?? 'structuralDiff unavailable' };
      verdicts.push({ id: 'structuralDiff', status: 'skipped', reason: structuralDiff.reason });
    }
  }

  let isomorphism: BenchmarkReport['isomorphism'] = null;
  if (!req.isomorphism) {
    verdicts.push({ id: 'isomorphism', status: 'skipped', reason: 'isomorphism not requested' });
  } else {
    const iso = await runIsomorphism({
      session: hooks.session,
      getClientSnapshot: hooks.requestClientSnapshot,
    });
    isomorphism = {
      sequence: iso.sequence,
      generation: iso.generation,
      o2: iso.o2,
      table: iso.table,
      structuralDiff: iso.structuralDiff,
    };
    if (iso.o2) {
      verdicts.push({
        id: 'o2',
        status: iso.o2.identical ? 'pass' : 'fail',
        reason: iso.o2.identical ? `identical at sequence ${iso.sequence}` : `${iso.o2.divergenceCount} O2 divergences`,
      });
    }
    if (iso.table.identical === true) {
      verdicts.push({
        id: 'table',
        status: 'pass',
        reason: `rowCount=${iso.table.virtual?.rowCount} hash match at sequence ${iso.sequence}`,
      });
    } else if (iso.table.identical === false) {
      verdicts.push({
        id: 'table',
        status: 'fail',
        reason:
          iso.tableFailReason ??
          `virtual rows=${iso.table.virtual?.rowCount} client rows=${iso.table.client?.rowCount} hash mismatch`,
      });
    }
    for (const s of iso.skipped) {
      verdicts.push({ id: s.id, status: 'skipped', reason: s.reason });
    }
    if (iso.structuralDiff) {
      verdicts.push({
        id: 'isomorphism.structuralDiff',
        status: iso.structuralDiff.identical ? 'pass' : 'fail',
        reason: iso.structuralDiff.identical ? 'identical' : `${iso.structuralDiff.divergenceCount} divergences`,
      });
    }
  }

  const invariants = req.invariants ? collectors.invariantMonitor.getSummary() : null;
  if (!req.invariants) {
    verdicts.push({ id: 'invariants', status: 'skipped', reason: 'invariants not requested' });
  } else if (invariants) {
    for (const check of invariants) {
      verdicts.push({
        id: `invariant.${check.id}`,
        status: check.failCount === 0 ? 'pass' : 'fail',
        reason:
          check.failCount === 0
            ? `${check.passCount} passes`
            : `${check.failCount} fails (${check.failures[0]?.details ?? check.description})`,
      });
    }
  }

  const metrics = collectors.metrics.getSummary(wallMs);
  if (metrics.applyMs.count === 0) {
    verdicts.push({
      id: 'applyMs',
      status: 'skipped',
      reason: 'applyMs skipped: no DOM apply surface',
    });
  }

  const report: BenchmarkReport = {
    meta: {
      timestamp: new Date(startedAt).toISOString(),
      url: req.url,
      requestedDurationMs: req.durationMs,
      frameRateHz: req.frameRateHz,
      options: {
        cpuProfile: req.cpuProfile,
        invariants: req.invariants,
        structuralDiff: req.structuralDiff,
        isomorphism: req.isomorphism,
      },
    },
    config: req,
    verdicts,
    metrics,
    cpuProfile: cpuSummary ? { summary: cpuSummary, profileFile: 'profile.cpuprofile' } : null,
    invariants,
    structuralDiff,
    isomorphism,
    events: { counts: collectors.eventCounts, desyncs: collectors.desyncs },
  };

  const written = await writeRunReport(req.outDir ?? defaultLabRunsDir(), report, cpuRaw);
  return { report, written };
}
