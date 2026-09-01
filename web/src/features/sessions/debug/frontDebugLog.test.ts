import { describe, expect, it } from 'vitest'
import {
  observationAllowsPlane,
  parseClientObservation,
} from './frontDebugLog'

describe('parseClientObservation', () => {
  it('reads pageProjectionIntent from public client-config (no Input alias)', () => {
    const cfg = parseClientObservation({
      isEnabled: true,
      pageProjectionFrame: true,
      pageProjectionIntent: true,
      pageProjectionInput: true,
    })
    expect(cfg.pageProjectionIntent).toBe(true)
    expect(observationAllowsPlane(cfg, 'pageProjectionIntent')).toBe(true)
    expect(observationAllowsPlane(cfg, 'pageProjectionFrame')).toBe(true)
  })

  it('stays off when Intent toggle is absent', () => {
    const cfg = parseClientObservation({
      isEnabled: true,
      pageProjectionInput: true,
    })
    expect(cfg.pageProjectionIntent).toBe(false)
    expect(observationAllowsPlane(cfg, 'pageProjectionIntent')).toBe(false)
  })
})
