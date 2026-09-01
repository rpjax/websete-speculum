import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

/**
 * Journal event semantics for diagnostics/debug.
 * Lifecycle closes (e.g. Sessions.SessionTimedOut) are natural collection —
 * not faults. Probe timeouts and Failed/Rejected remain faults.
 */

export type EventTone = 'fault' | 'warning' | 'lifecycle' | 'metric' | 'info'

/** Detached/idle session timeout — normal end of collection, not an operator fault. */
export function isNaturalLifecycleClose(name: string): boolean {
  return /SessionTimedOut$/i.test(name)
}

export function isFaultEventName(name: string): boolean {
  if (isNaturalLifecycleClose(name)) return false
  if (/DiagProbeTimedOut|ProbeTimedOut/i.test(name)) return true
  return /Failed|Rejected|Refused|Blocked|Faulted/i.test(name)
}

export function eventTone(event: Pick<DiagnosticsEventRecord, 'name' | 'severity'>): EventTone {
  if (isNaturalLifecycleClose(event.name)) return 'lifecycle'
  if (event.severity === 'Metric' || /SampleCollected/i.test(event.name)) return 'metric'
  if (isFaultEventName(event.name) || event.severity === 'Error') return 'fault'
  if (event.severity === 'Warning') return 'warning'
  if (/Starting|Started|Stopping|Stopped|Launched|Closed|Restored|Persisted|Connected|Promoted/i.test(event.name)) {
    return 'lifecycle'
  }
  return 'info'
}

export function isFaultEvent(event: Pick<DiagnosticsEventRecord, 'name' | 'severity'>): boolean {
  return eventTone(event) === 'fault'
}

/** Operator-facing role of this fact in a session story. */
export function eventRoleLabel(event: Pick<DiagnosticsEventRecord, 'name' | 'severity' | 'domain'>): string {
  const tone = eventTone(event)
  if (tone === 'fault') return 'Fault'
  if (tone === 'warning') return 'Warning'
  if (isNaturalLifecycleClose(event.name)) return 'Lifecycle close'
  if (tone === 'lifecycle') return 'Lifecycle'
  if (tone === 'metric') return 'Sample'
  if (event.domain === 'Telemetry') return 'Telemetry'
  if (event.domain === 'Diagnostics') return 'Diagnostics'
  return 'Fact'
}

export function inferJournalSeverity(type: string, payloadSeverity: string | null): string {
  if (payloadSeverity && !isNaturalLifecycleClose(type)) return payloadSeverity
  if (isNaturalLifecycleClose(type)) return 'Info'
  if (isFaultEventName(type)) return 'Error'
  if (/Warning|Degraded|Abandoned/i.test(type)) return 'Warning'
  if (/SampleCollected|Metric|Gauge|Counter/i.test(type)) return 'Metric'
  return 'Info'
}
