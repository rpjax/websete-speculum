import type { DiagnosticsTelemetryOptions } from '@/lib/diagnosticsApi'

type ToggleSection = { enabled?: boolean; isEnabled?: boolean }

function readEnabled(section: ToggleSection | undefined, fallback: boolean): boolean {
  return section?.enabled ?? section?.isEnabled ?? fallback
}

/** Merge API / draft telemetry onto defaults (supports isEnabled wire + events map). */
export function normalizeTelemetrySection(
  raw: Partial<DiagnosticsTelemetryOptions> | null | undefined,
  baseline: DiagnosticsTelemetryOptions,
): DiagnosticsTelemetryOptions {
  if (!raw) {
    return baseline
  }

  const root = raw as Partial<DiagnosticsTelemetryOptions> & { isEnabled?: boolean }

  return {
    ...baseline,
    ...raw,
    enabled: raw.enabled ?? root.isEnabled ?? baseline.enabled,
    events: { ...baseline.events, ...(raw.events ?? {}) },
    host: {
      ...baseline.host,
      ...raw.host,
      enabled: readEnabled(raw.host, baseline.host.enabled),
    },
    apiProcess: {
      ...baseline.apiProcess,
      ...raw.apiProcess,
      enabled: readEnabled(raw.apiProcess, baseline.apiProcess.enabled),
    },
    sessions: {
      ...baseline.sessions,
      ...raw.sessions,
      enabled: readEnabled(raw.sessions, baseline.sessions.enabled),
    },
    sidecar: {
      ...baseline.sidecar,
      ...raw.sidecar,
      enabled: readEnabled(raw.sidecar, baseline.sidecar.enabled),
    },
    profiles: {
      ...baseline.profiles,
      ...raw.profiles,
      enabled: readEnabled(raw.profiles, baseline.profiles.enabled),
    },
    journal: {
      ...baseline.journal,
      ...raw.journal,
      enabled: readEnabled(raw.journal, baseline.journal.enabled),
    },
    docker: {
      ...baseline.docker,
      ...raw.docker,
      enabled: readEnabled(raw.docker, baseline.docker.enabled),
    },
  }
}

/** Engine Telemetry section JSON (isEnabled + nested isEnabled + events). */
export function serializeTelemetryForApi(
  telemetry: DiagnosticsTelemetryOptions,
): Record<string, unknown> {
  return {
    isEnabled: telemetry.enabled,
    intervalSeconds: telemetry.intervalSeconds,
    events: telemetry.events ?? {},
    host: {
      isEnabled: telemetry.host.enabled,
      procPath: telemetry.host.procPath,
      diskPath: telemetry.host.diskPath ?? null,
      sampleIntervalMs: telemetry.host.sampleIntervalMs,
      includeLoadAverage: telemetry.host.includeLoadAverage,
      includeSwap: telemetry.host.includeSwap,
      includeDiskIo: telemetry.host.includeDiskIo,
      includeNetwork: telemetry.host.includeNetwork,
    },
    apiProcess: {
      isEnabled: telemetry.apiProcess.enabled,
      sampleIntervalMs: telemetry.apiProcess.sampleIntervalMs,
      includePrivateMemory: telemetry.apiProcess.includePrivateMemory,
      includeGarbageCollection: telemetry.apiProcess.includeGarbageCollection,
      includeThreadPool: telemetry.apiProcess.includeThreadPool,
    },
    sessions: {
      isEnabled: telemetry.sessions.enabled,
      includeSessionIds: telemetry.sessions.includeSessionIds,
      includePerSession: telemetry.sessions.includePerSession,
      includeUrlHost: telemetry.sessions.includeUrlHost,
    },
    sidecar: {
      isEnabled: telemetry.sidecar.enabled,
      includeProcess: telemetry.sidecar.includeProcess,
      includeEventLoop: telemetry.sidecar.includeEventLoop,
      includeChrome: telemetry.sidecar.includeChrome,
      includeQueues: telemetry.sidecar.includeQueues,
      includeSessionsSummary: telemetry.sidecar.includeSessionsSummary,
      includeFaultedIds: telemetry.sidecar.includeFaultedIds,
      includeAllocationsSummary: telemetry.sidecar.includeAllocationsSummary,
      includeAllocationSessions: telemetry.sidecar.includeAllocationSessions,
      timeoutMs: telemetry.sidecar.timeoutMs,
    },
    profiles: {
      isEnabled: telemetry.profiles.enabled,
      includeStorageBytes: telemetry.profiles.includeStorageBytes,
    },
    journal: {
      isEnabled: telemetry.journal.enabled,
      includePressure: telemetry.journal.includePressure,
    },
    docker: {
      isEnabled: telemetry.docker.enabled,
      endpoint: telemetry.docker.endpoint,
      includeRuntime: telemetry.docker.includeRuntime,
      includeContainers: telemetry.docker.includeContainers,
      timeoutMs: telemetry.docker.timeoutMs,
    },
  }
}
