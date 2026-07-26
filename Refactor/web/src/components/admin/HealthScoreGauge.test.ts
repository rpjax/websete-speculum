import { describe, it, expect } from 'vitest'
import { computeHealthScore } from './HealthScoreGauge'

const HEALTHY_BASELINE = {
  degraded: false,
  eventsDropped: 0,
  overflowCount: 0,
  liveSessions: 5,
  storagePercent: 30,
  capabilitiesOff: 0,
  totalCapabilities: 10,
}

describe('computeHealthScore', () => {
  it('returns 100 for a perfectly healthy system', () => {
    expect(computeHealthScore(HEALTHY_BASELINE)).toBe(100)
  })

  it('subtracts 40 when degraded', () => {
    expect(computeHealthScore({ ...HEALTHY_BASELINE, degraded: true })).toBe(60)
  })

  it('penalizes dropped events (capped at 20)', () => {
    expect(computeHealthScore({ ...HEALTHY_BASELINE, eventsDropped: 3 })).toBe(94)
    expect(computeHealthScore({ ...HEALTHY_BASELINE, eventsDropped: 100 })).toBe(80)
  })

  it('penalizes overflow count (capped at 15)', () => {
    expect(computeHealthScore({ ...HEALTHY_BASELINE, overflowCount: 1 })).toBe(95)
    expect(computeHealthScore({ ...HEALTHY_BASELINE, overflowCount: 10 })).toBe(85)
  })

  it('penalizes high storage (>90% = -15, >70% = -5)', () => {
    expect(computeHealthScore({ ...HEALTHY_BASELINE, storagePercent: 95 })).toBe(85)
    expect(computeHealthScore({ ...HEALTHY_BASELINE, storagePercent: 75 })).toBe(95)
    expect(computeHealthScore({ ...HEALTHY_BASELINE, storagePercent: 50 })).toBe(100)
  })

  it('penalizes capabilities off (-3 per capability)', () => {
    expect(computeHealthScore({ ...HEALTHY_BASELINE, capabilitiesOff: 2 })).toBe(94)
  })

  it('compounds multiple penalties', () => {
    const score = computeHealthScore({
      degraded: true,
      eventsDropped: 5,
      overflowCount: 2,
      liveSessions: 0,
      storagePercent: 95,
      capabilitiesOff: 1,
      totalCapabilities: 10,
    })
    expect(score).toBeLessThan(40)
  })

  it('never goes below 0', () => {
    const score = computeHealthScore({
      degraded: true,
      eventsDropped: 100,
      overflowCount: 100,
      liveSessions: 0,
      storagePercent: 100,
      capabilitiesOff: 10,
      totalCapabilities: 10,
    })
    expect(score).toBe(0)
  })

  it('never exceeds 100', () => {
    expect(computeHealthScore(HEALTHY_BASELINE)).toBeLessThanOrEqual(100)
  })
})
