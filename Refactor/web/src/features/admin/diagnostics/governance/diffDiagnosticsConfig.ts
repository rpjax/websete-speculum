import type { DiagnosticsOptions } from '@/lib/diagnosticsApi'
import { formatBytes } from '@/lib/diagnosticsConstants'

export type ConfigChangeImpact = 'up' | 'down' | 'neutral'

export interface ConfigChange {
  label: string
  from: string
  to: string
  impact: ConfigChangeImpact
}

function diffToggle(changes: ConfigChange[], label: string, from: boolean, to: boolean) {
  if (from !== to) {
    changes.push({
      label,
      from: from ? 'On' : 'Off',
      to: to ? 'On' : 'Off',
      impact: to ? 'up' : 'down',
    })
  }
}

function diffNumber(
  changes: ConfigChange[],
  label: string,
  from: number,
  to: number,
  format: (v: number) => string = String,
  impact: ConfigChangeImpact = 'neutral',
) {
  if (from !== to) {
    const resolved =
      impact !== 'neutral' ? impact : to > from ? 'up' : to < from ? 'down' : 'neutral'
    changes.push({ label, from: format(from), to: format(to), impact: resolved })
  }
}

function diffString(changes: ConfigChange[], label: string, from: string, to: string) {
  if (from !== to) {
    changes.push({ label, from, to, impact: 'neutral' })
  }
}

/** Full pending-change list for every editable Diagnostics config field. */
export function diffDiagnosticsConfig(current: DiagnosticsOptions, pending: DiagnosticsOptions): ConfigChange[] {
  const changes: ConfigChange[] = []

  if (current.profile !== pending.profile) {
    changes.push({ label: 'Profile', from: current.profile, to: pending.profile, impact: 'neutral' })
  }
  if (current.enabled !== pending.enabled) {
    changes.push({
      label: 'Pipeline',
      from: current.enabled ? 'Enabled' : 'Disabled',
      to: pending.enabled ? 'Enabled' : 'Disabled',
      impact: pending.enabled ? 'up' : 'down',
    })
  }

  diffToggle(changes, 'Motor · Metrics', current.domains.motor.metrics, pending.domains.motor.metrics)
  diffToggle(changes, 'Motor · Events', current.domains.motor.events, pending.domains.motor.events)
  diffToggle(changes, 'Motor · Snapshots', current.domains.motor.snapshots, pending.domains.motor.snapshots)
  diffToggle(changes, 'Sidecar · Metrics', current.domains.sidecar.metrics, pending.domains.sidecar.metrics)
  diffToggle(changes, 'Sidecar · Events', current.domains.sidecar.events, pending.domains.sidecar.events)
  diffToggle(changes, 'Browser Query · Probe', current.domains.browserQuery.probe, pending.domains.browserQuery.probe)
  diffToggle(changes, 'Persisted · Snapshots', current.domains.persisted.snapshots, pending.domains.persisted.snapshots)

  diffToggle(changes, 'Telemetry', current.telemetry.enabled, pending.telemetry.enabled)
  diffNumber(
    changes,
    'Telemetry interval',
    current.telemetry.intervalSeconds,
    pending.telemetry.intervalSeconds,
    (v) => `${v}s`,
  )
  diffToggle(changes, 'Telemetry · Machine', current.telemetry.host.enabled, pending.telemetry.host.enabled)
  diffString(changes, 'Machine · proc path', current.telemetry.host.procPath, pending.telemetry.host.procPath)
  if (current.telemetry.host.diskPath !== pending.telemetry.host.diskPath) {
    changes.push({
      label: 'Machine · disk path',
      from: current.telemetry.host.diskPath ?? 'Default',
      to: pending.telemetry.host.diskPath ?? 'Default',
      impact: 'neutral',
    })
  }
  diffNumber(changes, 'Machine · sample interval', current.telemetry.host.sampleIntervalMs, pending.telemetry.host.sampleIntervalMs, (v) => `${v}ms`)
  diffToggle(changes, 'Machine · load average', current.telemetry.host.includeLoadAverage, pending.telemetry.host.includeLoadAverage)
  diffToggle(changes, 'Machine · swap', current.telemetry.host.includeSwap, pending.telemetry.host.includeSwap)
  diffToggle(changes, 'Machine · disk I/O', current.telemetry.host.includeDiskIo, pending.telemetry.host.includeDiskIo)
  diffToggle(changes, 'Machine · network', current.telemetry.host.includeNetwork, pending.telemetry.host.includeNetwork)
  diffToggle(changes, 'Telemetry · API process', current.telemetry.apiProcess.enabled, pending.telemetry.apiProcess.enabled)
  diffNumber(changes, 'API process · sample interval', current.telemetry.apiProcess.sampleIntervalMs, pending.telemetry.apiProcess.sampleIntervalMs, (v) => `${v}ms`)
  diffToggle(changes, 'API process · private memory', current.telemetry.apiProcess.includePrivateMemory, pending.telemetry.apiProcess.includePrivateMemory)
  diffToggle(changes, 'API process · GC', current.telemetry.apiProcess.includeGarbageCollection, pending.telemetry.apiProcess.includeGarbageCollection)
  diffToggle(changes, 'API process · thread pool', current.telemetry.apiProcess.includeThreadPool, pending.telemetry.apiProcess.includeThreadPool)
  diffToggle(changes, 'Telemetry · Sessions', current.telemetry.sessions.enabled, pending.telemetry.sessions.enabled)
  diffToggle(changes, 'Telemetry · Sidecar', current.telemetry.sidecar.enabled, pending.telemetry.sidecar.enabled)
  diffToggle(changes, 'Telemetry · Profiles', current.telemetry.profiles.enabled, pending.telemetry.profiles.enabled)
  diffToggle(changes, 'Telemetry · Journal', current.telemetry.journal.enabled, pending.telemetry.journal.enabled)
  diffToggle(changes, 'Telemetry · Docker', current.telemetry.docker.enabled, pending.telemetry.docker.enabled)
  diffToggle(changes, 'Sessions · session IDs', current.telemetry.sessions.includeSessionIds, pending.telemetry.sessions.includeSessionIds)
  diffToggle(changes, 'Sessions · per-session', current.telemetry.sessions.includePerSession, pending.telemetry.sessions.includePerSession)
  diffToggle(changes, 'Sessions · URL host', current.telemetry.sessions.includeUrlHost, pending.telemetry.sessions.includeUrlHost)
  diffToggle(changes, 'Sidecar · process', current.telemetry.sidecar.includeProcess, pending.telemetry.sidecar.includeProcess)
  diffToggle(changes, 'Sidecar · event loop', current.telemetry.sidecar.includeEventLoop, pending.telemetry.sidecar.includeEventLoop)
  diffToggle(changes, 'Sidecar · chrome', current.telemetry.sidecar.includeChrome, pending.telemetry.sidecar.includeChrome)
  diffToggle(changes, 'Sidecar · queues', current.telemetry.sidecar.includeQueues, pending.telemetry.sidecar.includeQueues)
  diffToggle(changes, 'Sidecar · sessions summary', current.telemetry.sidecar.includeSessionsSummary, pending.telemetry.sidecar.includeSessionsSummary)
  diffToggle(changes, 'Sidecar · faulted IDs', current.telemetry.sidecar.includeFaultedIds, pending.telemetry.sidecar.includeFaultedIds)
  diffNumber(changes, 'Sidecar timeout', current.telemetry.sidecar.timeoutMs, pending.telemetry.sidecar.timeoutMs, (v) => `${v}ms`)
  diffToggle(changes, 'Profiles · storage bytes', current.telemetry.profiles.includeStorageBytes, pending.telemetry.profiles.includeStorageBytes)
  diffToggle(changes, 'Journal · pressure detail', current.telemetry.journal.includePressure, pending.telemetry.journal.includePressure)
  diffString(changes, 'Docker endpoint', current.telemetry.docker.endpoint, pending.telemetry.docker.endpoint)
  diffToggle(changes, 'Docker · runtime', current.telemetry.docker.includeRuntime, pending.telemetry.docker.includeRuntime)
  diffToggle(changes, 'Docker · containers', current.telemetry.docker.includeContainers, pending.telemetry.docker.includeContainers)
  diffNumber(changes, 'Docker timeout', current.telemetry.docker.timeoutMs, pending.telemetry.docker.timeoutMs, (v) => `${v}ms`)

  diffNumber(changes, 'Storage limit', current.storage.maxBytes, pending.storage.maxBytes, formatBytes)
  diffNumber(changes, 'Events per session', current.storage.maxEventsPerSession, pending.storage.maxEventsPerSession)
  diffNumber(changes, 'TTL', current.storage.ttlHours, pending.storage.ttlHours, (v) => `${v}h`)
  diffString(changes, 'Overflow policy', current.storage.overflow, pending.storage.overflow)

  diffNumber(changes, 'Status mirror ratio', current.sampling.statusMirrorRatio, pending.sampling.statusMirrorRatio)
  diffNumber(changes, 'Expensive event ratio', current.sampling.expensiveEventRatio, pending.sampling.expensiveEventRatio)

  diffNumber(changes, 'Probe timeout', current.probe.diagTimeoutMs, pending.probe.diagTimeoutMs, (v) => `${v}ms`)
  diffNumber(changes, 'Max concurrent probes', current.probe.maxConcurrentProbesPerSession, pending.probe.maxConcurrentProbesPerSession)
  diffNumber(changes, 'Max probe response', current.probe.maxProbeResponseBytes, pending.probe.maxProbeResponseBytes, formatBytes)
  diffNumber(
    changes,
    'Elevate max minutes',
    current.elevate.browserQueryMaxMinutes,
    pending.elevate.browserQueryMaxMinutes,
    (v) => `${v}m`,
  )

  return changes
}
