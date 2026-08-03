import { describe, expect, it } from 'vitest'
import {
  eventRoleLabel,
  eventTone,
  inferJournalSeverity,
  isFaultEvent,
  isNaturalLifecycleClose,
} from './eventSemantics'

describe('eventSemantics', () => {
  it('treats SessionTimedOut as natural lifecycle, not fault', () => {
    expect(isNaturalLifecycleClose('Sessions.SessionTimedOut')).toBe(true)
    expect(isFaultEvent({ name: 'Sessions.SessionTimedOut', severity: 'Error' })).toBe(false)
    expect(eventTone({ name: 'Sessions.SessionTimedOut', severity: 'Error' })).toBe('lifecycle')
    expect(eventRoleLabel({ name: 'Sessions.SessionTimedOut', severity: 'Error', domain: 'Sessions' })).toBe(
      'Lifecycle close',
    )
    expect(inferJournalSeverity('Sessions.SessionTimedOut', 'Error')).toBe('Info')
  })

  it('keeps real faults and probe timeouts as faults', () => {
    expect(isFaultEvent({ name: 'Sessions.SessionFailed', severity: 'Error' })).toBe(true)
    expect(isFaultEvent({ name: 'Sidecar.DiagProbeTimedOut', severity: 'Error' })).toBe(true)
    expect(inferJournalSeverity('Sidecar.DiagProbeTimedOut', null)).toBe('Error')
  })

  it('classifies telemetry samples as metric', () => {
    expect(eventTone({ name: 'Telemetry.Sampling.SampleCollected', severity: 'Metric' })).toBe('metric')
  })
})
