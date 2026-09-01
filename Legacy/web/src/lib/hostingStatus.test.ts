import { describe, expect, it } from 'vitest'
import { profileBadge, SECTION_HELP } from './hostingStatus'

describe('profileBadge', () => {
  it('marks apex mode when mirroring is off', () => {
    const b = profileBadge({
      domain: 'example.com',
      subdomainMirroringEnabled: false,
      mirroringOperational: false,
      missing: [],
    })
    expect(b.tone).toBe('muted')
    expect(b.label).toMatch(/apex/i)
  })

  it('marks mirroring OK when operational', () => {
    const b = profileBadge({
      domain: 'example.com',
      subdomainMirroringEnabled: true,
      mirroringOperational: true,
      missing: [],
    })
    expect(b.tone).toBe('success')
  })
})

describe('SECTION_HELP', () => {
  it('maps MaxSessions to capacity route', () => {
    expect(SECTION_HELP.MaxSessions.href).toBe('/admin/capacity')
  })
})
