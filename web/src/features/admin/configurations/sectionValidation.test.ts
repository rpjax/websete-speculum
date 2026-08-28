import { describe, expect, it } from 'vitest'
import { sectionCanSave } from './sectionValidation'
import { applySessionsGuidedPreset, SESSIONS_GUIDED_PRESETS } from './sessionsHelpers'
import { applyCapacityPreset, CAPACITY_PRESETS } from './resourceManagementHelpers'

describe('sectionCanSave', () => {
  it('blocks Scripting (no save on this route)', () => {
    expect(sectionCanSave('Scripting', {})).toBe(false)
  })

  it('requires bare Navigation host', () => {
    expect(sectionCanSave('Navigation', {})).toBe(false)
    expect(sectionCanSave('Navigation', { defaultTargetHost: 'https://x.com' })).toBe(false)
    expect(sectionCanSave('Navigation', { defaultTargetHost: 'example.com' })).toBe(true)
  })

  it('allows empty Hosting domains but rejects blank host rows', () => {
    expect(sectionCanSave('Hosting', { domains: [] })).toBe(true)
    expect(
      sectionCanSave('Hosting', {
        domains: [{ domain: '', certificateEmail: null }],
      }),
    ).toBe(false)
    expect(
      sectionCanSave('Hosting', {
        domains: [{ domain: 'example.com', certificateEmail: null }],
      }),
    ).toBe(true)
  })

  it('requires complete Sessions posture', () => {
    expect(sectionCanSave('Sessions', {})).toBe(false)
    const lab = SESSIONS_GUIDED_PRESETS.find((p) => p.id === 'lab')!
    const ready = applySessionsGuidedPreset({}, lab)
    expect(sectionCanSave('Sessions', ready)).toBe(true)
  })

  it('requires ResourceManagement slots and positive budget', () => {
    expect(sectionCanSave('ResourceManagement', { sessions: { maxConcurrentSessions: 0 } })).toBe(false)
    const small = CAPACITY_PRESETS.find((p) => p.id === 'small-prod') ?? CAPACITY_PRESETS[0]
    const ready = applyCapacityPreset({}, small)
    expect(sectionCanSave('ResourceManagement', ready)).toBe(true)
    expect(
      sectionCanSave('ResourceManagement', {
        ...ready,
        storage: { ...((ready.storage as object) ?? {}), budgetBytes: 0 },
      }),
    ).toBe(false)
  })
})
