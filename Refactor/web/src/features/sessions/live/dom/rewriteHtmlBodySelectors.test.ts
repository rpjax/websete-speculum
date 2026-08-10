import { describe, expect, it } from 'vitest'
import {
  DOM_BODY_SELECTOR,
  DOM_SURFACE_SELECTOR,
  inferRootFontSizePx,
  rewriteHtmlBodySelectors,
  rewriteRemToPx,
} from './rewriteHtmlBodySelectors'

describe('rewriteHtmlBodySelectors', () => {
  it('rewrites body and html type selectors', () => {
    const out = rewriteHtmlBodySelectors(
      'html{font-size:62.5%}body{background:#4618ac;color:#fff}div{margin:0}',
    )
    expect(out).toContain(`${DOM_SURFACE_SELECTOR}{font-size:62.5%}`)
    expect(out).toContain(`${DOM_BODY_SELECTOR}{background:#4618ac;color:#fff}`)
    expect(out).toContain('div{margin:0}')
  })

  it('rewrites compound lists without touching class names', () => {
    const out = rewriteHtmlBodySelectors('html, body, .somebody, body.dark { margin: 0 }')
    expect(out).toContain(DOM_SURFACE_SELECTOR)
    expect(out).toContain(DOM_BODY_SELECTOR)
    expect(out).toContain('.somebody')
    expect(out).toContain(`${DOM_BODY_SELECTOR}.dark`)
  })

  it('rewrites :root to the projection surface', () => {
    const out = rewriteHtmlBodySelectors(':root{--accent:#f00}html,:root{color:#fff}')
    expect(out).toContain(`${DOM_SURFACE_SELECTOR}{--accent:#f00}`)
    expect(out).toContain(`${DOM_SURFACE_SELECTOR},${DOM_SURFACE_SELECTOR}{color:#fff}`)
  })
})

describe('rewriteRemToPx', () => {
  it('converts rem using projected root size', () => {
    expect(inferRootFontSizePx('html{font-size:62.5%}')).toBe(10)
    expect(rewriteRemToPx('body{font:1.6rem/1.5 sans-serif;padding:2rem}', 10)).toBe(
      'body{font:16px/1.5 sans-serif;padding:20px}',
    )
  })
})

describe('rewriteViewportUnits', () => {
  it('maps vw/vh to container query units', async () => {
    const { rewriteViewportUnits } = await import('./rewriteHtmlBodySelectors')
    expect(rewriteViewportUnits('div{width:100vw;height:50vh;min-width:10vmin}')).toBe(
      'div{width:100cqw;height:50cqh;min-width:10cqmin}',
    )
  })
})
