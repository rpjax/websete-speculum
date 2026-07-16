import { describe, expect, it } from 'vitest'
import { deviceProfilesEqual, normalizeSessionViewport, SESSION_VIEWPORT } from './deviceProfile'

describe('normalizeSessionViewport', () => {
  it('defaults non-positive to 1280×720', () => {
    expect(normalizeSessionViewport(0, 0)).toEqual({ w: 1280, h: 720 })
    expect(normalizeSessionViewport(-1, 800)).toEqual({ w: 1280, h: 800 })
  })

  it('clamps to API/Xvfb ceiling so coords match remote', () => {
    expect(normalizeSessionViewport(9000, 5000)).toEqual({
      w: SESSION_VIEWPORT.maxWidth,
      h: SESSION_VIEWPORT.maxHeight,
    })
  })

  it('passes through normal sizes', () => {
    expect(normalizeSessionViewport(1440, 900)).toEqual({ w: 1440, h: 900 })
  })
})

describe('deviceProfilesEqual', () => {
  it('detects orientation-only drift', () => {
    const a = {
      mobile: true,
      touch: true,
      deviceScaleFactor: 2,
      maxTouchPoints: 5,
      userAgentProfile: 'mobile',
      screenOrientation: 'portrait-primary',
    }
    const b = { ...a, screenOrientation: 'landscape-primary' }
    expect(deviceProfilesEqual(a, a)).toBe(true)
    expect(deviceProfilesEqual(a, b)).toBe(false)
  })
})
