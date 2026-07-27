import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEWPORT_POLICY,
  deviceProfilesEqual,
  isTouchPrimaryProfile,
  normalizeSessionViewport,
  validateResizeViewport,
} from './deviceProfile'

describe('normalizeSessionViewport', () => {
  it('defaults non-positive to policy default', () => {
    expect(normalizeSessionViewport(0, 0, DEFAULT_VIEWPORT_POLICY)).toEqual({ w: 1280, h: 720 })
    expect(normalizeSessionViewport(-1, 800, DEFAULT_VIEWPORT_POLICY)).toEqual({ w: 1280, h: 800 })
  })

  it('clamps to policy maximum so coords match remote', () => {
    expect(normalizeSessionViewport(9000, 5000, DEFAULT_VIEWPORT_POLICY)).toEqual({
      w: DEFAULT_VIEWPORT_POLICY.maxWidth,
      h: DEFAULT_VIEWPORT_POLICY.maxHeight,
    })
  })

  it('passes through normal sizes', () => {
    expect(normalizeSessionViewport(1440, 900, DEFAULT_VIEWPORT_POLICY)).toEqual({
      w: 1440,
      h: 900,
    })
  })

  it('uses configured policy, not a hardcoded constant', () => {
    const tight = {
      minWidth: 200,
      minHeight: 200,
      maxWidth: 1600,
      maxHeight: 900,
      defaultWidth: 800,
      defaultHeight: 600,
    }
    expect(normalizeSessionViewport(0, 0, tight)).toEqual({ w: 800, h: 600 })
    expect(normalizeSessionViewport(2000, 1000, tight)).toEqual({ w: 1600, h: 900 })
  })
})

describe('validateResizeViewport', () => {
  it('rejects below minimum without snapping', () => {
    expect(validateResizeViewport(50, 50, DEFAULT_VIEWPORT_POLICY).ok).toBe(false)
  })

  it('accepts exact odd geometry', () => {
    expect(validateResizeViewport(757, 715, DEFAULT_VIEWPORT_POLICY)).toEqual({
      ok: true,
      w: 757,
      h: 715,
    })
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

describe('isTouchPrimaryProfile', () => {
  it('is false for hybrid desktop with touch capability', () => {
    expect(isTouchPrimaryProfile({ mobile: false })).toBe(false)
  })

  it('is true only for mobile profiles', () => {
    expect(isTouchPrimaryProfile({ mobile: true })).toBe(true)
  })
})
