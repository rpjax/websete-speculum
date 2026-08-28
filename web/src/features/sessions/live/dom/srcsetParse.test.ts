import { describe, expect, it } from 'vitest'
import { mapSrcset, parseSrcset } from './srcsetParse'

describe('parseSrcset (WHATWG image candidates)', () => {
  it('keeps Cloudinary transform commas inside the URL', () => {
    const raw =
      'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, ' +
      'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w'
    const parsed = parseSrcset(raw)
    expect(parsed).toEqual([
      {
        url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg',
        descriptor: '1920w',
      },
      {
        url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg',
        descriptor: '800w',
      },
    ])
  })

  it('maps candidate URLs without truncating at f_avif', () => {
    const raw =
      'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_400/icon.png 1x, ' +
      'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/icon.png 2x'
    const out = mapSrcset(raw, (u) => `/w7s/virtual-assets/${encodeURIComponent(u)}`)
    expect(out).toContain('f_avif%2Cq_auto%2Cw_400')
    expect(out).toContain('f_avif%2Cq_auto%2Cw_800')
    expect(out).toContain(' 1x, ')
    expect(out.endsWith(' 2x')).toBe(true)
  })

  it('handles density descriptors and trailing URL-only candidates', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual([
      { url: 'a.jpg', descriptor: '1x' },
      { url: 'b.jpg', descriptor: '2x' },
    ])
    expect(parseSrcset('solo.png,')).toEqual([{ url: 'solo.png', descriptor: '' }])
  })
})
