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
  diffToggle(changes, 'API process · GC', current.telemetry.apiProcess.includeGc, pending.telemetry.apiProcess.includeGc)
  diffToggle(changes, 'API process · thread pool', current.telemetry.apiProcess.includeThreadPool, pending.telemetry.apiProcess.includeThreadPool)
  diffToggle(changes, 'Telemetry · Motor', current.telemetry.motor.enabled, pending.telemetry.motor.enabled)
  diffToggle(changes, 'Telemetry · Sidecar', current.telemetry.sidecar.enabled, pending.telemetry.sidecar.enabled)
  diffToggle(changes, 'Telemetry · Persistence', current.telemetry.persistence.enabled, pending.telemetry.persistence.enabled)
  diffToggle(changes, 'Telemetry · Pipeline', current.telemetry.pipeline.enabled, pending.telemetry.pipeline.enabled)
  diffToggle(changes, 'Motor · session IDs', current.telemetry.motor.includeSessionIds, pending.telemetry.motor.includeSessionIds)
  diffToggle(changes, 'Motor · per-session', current.telemetry.motor.includePerSession, pending.telemetry.motor.includePerSession)
  diffToggle(changes, 'Motor · URL host', current.telemetry.motor.includeUrlHost, pending.telemetry.motor.includeUrlHost)
  diffToggle(changes, 'Sidecar · faulted IDs', current.telemetry.sidecar.includeFaultedIds, pending.telemetry.sidecar.includeFaultedIds)
  diffToggle(changes, 'Persistence · store bytes', current.telemetry.persistence.includeBytes, pending.telemetry.persistence.includeBytes)
  diffToggle(
    changes,
    'Pipeline · breaker pressure',
    current.telemetry.pipeline.includeBreakerPressure,
    pending.telemetry.pipeline.includeBreakerPressure,
  )

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
