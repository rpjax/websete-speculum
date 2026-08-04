import { describe, expect, it } from 'vitest'
import { computeScreencastEncodeSize } from './screencastEncode'

describe('computeScreencastEncodeSize', () => {
  it('honors MaxEncodeScale 1 as CSS-only', () => {
    const r = computeScreencastEncodeSize({
      cssWidth: 1280,
      cssHeight: 720,
      deviceScaleFactor: 2,
      displayWidth: 4096,
      displayHeight: 2160,
      maxEncodeScale: 1,
    })
    expect(r).toEqual({ width: 1280, height: 720, scale: 1 })
  })

  it('encodes at DPR when MaxEncodeScale allows', () => {
    const r = computeScreencastEncodeSize({
      cssWidth: 1280,
      cssHeight: 720,
      deviceScaleFactor: 2,
      displayWidth: 4096,
      displayHeight: 2160,
      maxEncodeScale: 2,
    })
    expect(r).toEqual({ width: 2560, height: 1440, scale: 2 })
  })

  it('caps DPR above MaxEncodeScale', () => {
    const r = computeScreencastEncodeSize({
      cssWidth: 1280,
      cssHeight: 720,
      deviceScaleFactor: 3,
      displayWidth: 4096,
      displayHeight: 2160,
      maxEncodeScale: 2,
    })
    expect(r.scale).toBe(2)
    expect(r.width).toBe(2560)
  })

  it('never exceeds display (Xvfb) bounds', () => {
    const r = computeScreencastEncodeSize({
      cssWidth: 1920,
      cssHeight: 1080,
      deviceScaleFactor: 2,
      displayWidth: 2560,
      displayHeight: 1440,
      maxEncodeScale: 2,
    })
    expect(r.scale).toBeLessThan(2)
    expect(r.width).toBe(2560)
    expect(r.height).toBe(1440)
  })
})
