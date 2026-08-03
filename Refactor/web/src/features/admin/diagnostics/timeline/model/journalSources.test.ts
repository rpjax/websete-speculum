import { describe, expect, it } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import { applyReadingFilters } from './buildNarrative'
import {
  DEFAULT_JOURNAL_SOURCE_FILTERS,
  eventMatchesAnyJournalSource,
  matchesJournalSource,
} from './journalSources'

function ev(
  partial: Partial<DiagnosticsEventRecord> & Pick<DiagnosticsEventRecord, 'id' | 'name' | 'domain'>,
): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 2,
    severity: 'Info',
    utc: '2026-08-03T01:00:00.000Z',
    connectionId: null,
    correlationId: null,
    spanId: null,
    spanKey: null,
    spanRole: null,
    causationId: null,
    seq: null,
    payload: null,
    redaction: 'none',
    ...partial,
  }
}

describe('journalSources', () => {
  it('splits Telemetry into Sessions signals vs Sampling', () => {
    const lifecycle = ev({ id: '1', name: 'Sessions.SessionStarted', domain: 'Sessions' })
    const signal = ev({
      id: '2',
      name: 'Telemetry.Sessions.Input.Applied',
      domain: 'Telemetry',
    })
    const sample = ev({
      id: '3',
      name: 'Telemetry.Sampling.SampleCollected',
      domain: 'Telemetry',
      severity: 'Metric',
    })
    const profile = ev({ id: '4', name: 'Profiles.ProfileCreated', domain: 'Profiles' })

    expect(matchesJournalSource(lifecycle, 'Sessions')).toBe(true)
    expect(matchesJournalSource(signal, 'Telemetry.Sessions')).toBe(true)
    expect(matchesJournalSource(signal, 'Telemetry.Sampling')).toBe(false)
    expect(matchesJournalSource(sample, 'Telemetry.Sampling')).toBe(true)
    expect(matchesJournalSource(sample, 'Telemetry.Sessions')).toBe(false)
    expect(matchesJournalSource(profile, 'Profiles')).toBe(true)

    expect(eventMatchesAnyJournalSource(signal, DEFAULT_JOURNAL_SOURCE_FILTERS)).toBe(true)
    expect(eventMatchesAnyJournalSource(sample, DEFAULT_JOURNAL_SOURCE_FILTERS)).toBe(false)
  })

  it('applyReadingFilters uses source families, not bare domain equality', () => {
    const events = [
      ev({ id: '1', name: 'Sessions.SessionStarted', domain: 'Sessions' }),
      ev({ id: '2', name: 'Telemetry.Sessions.Sidecar.SessionAllocated', domain: 'Telemetry' }),
      ev({ id: '3', name: 'Telemetry.Sampling.SampleCollected', domain: 'Telemetry', severity: 'Metric' }),
    ]
    const filtered = applyReadingFilters(events, {
      domains: ['Sessions', 'Telemetry.Sessions'],
      severities: [],
      search: '',
    })
    expect(filtered.map((e) => e.id)).toEqual(['1', '2'])
  })
})
