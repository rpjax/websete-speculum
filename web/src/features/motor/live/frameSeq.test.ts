import { describe, it, expect } from 'vitest'
import { extractJpegBytes, shouldAcceptFrameSeq } from './frameSeq'

describe('shouldAcceptFrameSeq', () => {
  it('accepts equal or newer sequences', () => {
    expect(shouldAcceptFrameSeq(5, 5)).toBe(true)
    expect(shouldAcceptFrameSeq(6, 5)).toBe(true)
  })

  it('rejects stale sequences', () => {
    expect(shouldAcceptFrameSeq(4, 5)).toBe(false)
  })
})

describe('extractJpegBytes', () => {
  it('prefers camelCase jpeg', () => {
    const jpeg = new Uint8Array([1, 2])
    expect(extractJpegBytes({ jpeg, Jpeg: new Uint8Array([9]) })).toBe(jpeg)
  })

  it('falls back to PascalCase Jpeg', () => {
    const Jpeg = new Uint8Array([3, 4])
    expect(extractJpegBytes({ Jpeg })).toBe(Jpeg)
  })
})
