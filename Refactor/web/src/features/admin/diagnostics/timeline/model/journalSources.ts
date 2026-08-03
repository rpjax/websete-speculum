import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

/**
 * Real Journal type families in the refactor (first segment / typePrefix).
 * Not legacy MotorLive / SidecarBrowser / BrowserQuery.
 */
export const JOURNAL_SOURCES = [
  {
    value: 'Sessions',
    label: 'Lifecycle',
    hint: 'Sessions.* — start, stop, navigate, browser',
  },
  {
    value: 'Profiles',
    label: 'Profiles',
    hint: 'Profiles.* — create, reuse, delete',
  },
  {
    value: 'Telemetry.Sessions',
    label: 'Session signals',
    hint: 'Telemetry.Sessions.* — input, sidecar, capacity, persist',
  },
  {
    value: 'Telemetry.Sampling',
    label: 'Samples',
    hint: 'Telemetry.Sampling.* — periodic platform / session samples',
  },
] as const

export type JournalSourceId = (typeof JOURNAL_SOURCES)[number]['value']

/** Default: story + instrumentation; samples opt-in (noisy). */
export const DEFAULT_JOURNAL_SOURCE_FILTERS: JournalSourceId[] = [
  'Sessions',
  'Profiles',
  'Telemetry.Sessions',
]

export function matchesJournalSource(event: DiagnosticsEventRecord, source: string): boolean {
  const name = event.name
  switch (source) {
    case 'Sessions':
      return name.startsWith('Sessions.') || event.domain === 'Sessions'
    case 'Profiles':
      return name.startsWith('Profiles.') || event.domain === 'Profiles'
    case 'Telemetry.Sessions':
      return name.startsWith('Telemetry.Sessions.')
    case 'Telemetry.Sampling':
      return name.startsWith('Telemetry.Sampling.')
    case 'Telemetry':
      // Legacy single-bucket: any Telemetry.* fact
      return name.startsWith('Telemetry.') || event.domain === 'Telemetry'
    default:
      return event.domain === source || name.startsWith(`${source}.`)
  }
}

export function eventMatchesAnyJournalSource(
  event: DiagnosticsEventRecord,
  sources: string[],
): boolean {
  if (sources.length === 0) return true
  return sources.some((s) => matchesJournalSource(event, s))
}
