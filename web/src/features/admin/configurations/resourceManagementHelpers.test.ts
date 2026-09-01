import { describe, expect, it } from 'vitest'
import {
  CAPACITY_PRESETS,
  applyCapacityPreset,
  bytesToGibInput,
  describeTimeSpan,
  formatDotNetTimeSpan,
  gibInputToBytes,
  isUnlimitedTimeSpan,
  parseDotNetTimeSpan,
  retentionPresetId,
  sessionDurationPresetId,
  summarizeResourceManagement,
  timeSpanFromDays,
  timeSpanFromHours,
} from './resourceManagementHelpers'

describe('resourceManagementHelpers', () => {
  it('converts GiB to bytes and back', () => {
    expect(gibInputToBytes('2')).toBe(2 * 1024 ** 3)
    expect(bytesToGibInput(5 * 1024 ** 3)).toBe('5')
    expect(gibInputToBytes('')).toBe(0)
  })

  it('parses and formats .NET TimeSpan strings', () => {
    expect(parseDotNetTimeSpan('04:00:00')?.totalSeconds).toBe(4 * 3600)
    expect(parseDotNetTimeSpan('1.00:00:00')?.days).toBe(1)
    expect(formatDotNetTimeSpan(30, 0, 0)).toBe('30.00:00:00')
    expect(timeSpanFromHours(8)).toBe('08:00:00')
    expect(timeSpanFromDays(7)).toBe('7.00:00:00')
  })

  it('describes unlimited and human durations', () => {
    expect(isUnlimitedTimeSpan('')).toBe(true)
    expect(isUnlimitedTimeSpan('00:00:00')).toBe(true)
    expect(describeTimeSpan('04:00:00')).toBe('4 hours')
    expect(describeTimeSpan('30.00:00:00')).toBe('30 days')
    expect(describeTimeSpan('00:00:03')).toBe('3s')
    expect(describeTimeSpan('00:05:00')).toBe('5 min')
    expect(sessionDurationPresetId('08:00:00')).toBe('8h')
    expect(sessionDurationPresetId('02:30:00')).toBe('custom')
    expect(retentionPresetId('14.00:00:00')).toBe('14')
    expect(retentionPresetId('14.01:00:00')).toBe('custom')
  })

  it('applies capacity presets without wiping other nests', () => {
    const next = applyCapacityPreset(
      {
        sessions: { maxConcurrentSessions: 0 },
        profiles: { inactiveRetentionPeriod: '30.00:00:00' },
        diagnostics: { maxConcurrentProbesPerSession: 2 },
        storage: { journalFactRetention: '30.00:00:00' },
      },
      CAPACITY_PRESETS[0]!,
    )
    expect(next.sessions).toMatchObject(CAPACITY_PRESETS[0]!.sessions)
    expect(next.storage).toMatchObject({
      journalFactRetention: '30.00:00:00',
      budgetBytes: CAPACITY_PRESETS[0]!.storage.budgetBytes,
    })
    expect(next.profiles).toEqual({ inactiveRetentionPeriod: '30.00:00:00' })
    expect(next.diagnostics).toEqual({ maxConcurrentProbesPerSession: 2 })
  })

  it('summarizes completeness from max concurrent sessions', () => {
    const incomplete = summarizeResourceManagement({ sessions: { maxConcurrentSessions: 0 } })
    expect(incomplete.complete).toBe(false)
    const ready = summarizeResourceManagement({
      sessions: { maxConcurrentSessions: 4, maxConcurrentSessionsPerProfile: 0 },
      storage: { budgetBytes: 2 * 1024 ** 3 },
    })
    expect(ready.complete).toBe(true)
    expect(ready.slotsLabel).toBe('4 slots')
    expect(ready.perProfileLabel).toBe('Unlimited / profile')
  })
})
