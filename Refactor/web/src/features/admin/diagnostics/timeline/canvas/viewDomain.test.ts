import { describe, expect, it } from 'vitest'
import { clampBar, clampView, jumpView, panView, zoomView } from './viewDomain'

describe('viewDomain', () => {
  const data = { from: 0, to: 100_000 }

  it('clampView keeps span inside data bounds', () => {
    const v = clampView({ fromMs: -50_000, toMs: 200_000 }, data.from, data.to)
    expect(v.fromMs).toBeGreaterThanOrEqual(data.from)
    expect(v.toMs).toBeLessThanOrEqual(data.to)
    expect(v.toMs - v.fromMs).toBe(data.to - data.from)
  })

  it('zoomView shrinks around anchor', () => {
    const prev = { fromMs: 0, toMs: 100_000 }
    const next = zoomView(prev, 2, data.from, data.to, 50_000)
    expect(next.toMs - next.fromMs).toBe(50_000)
    expect(next.fromMs).toBeCloseTo(25_000, 0)
    expect(next.toMs).toBeCloseTo(75_000, 0)
  })

  it('panView shifts without changing span', () => {
    const prev = { fromMs: 10_000, toMs: 40_000 }
    const next = panView(prev, 5_000, data.from, data.to)
    expect(next.toMs - next.fromMs).toBe(30_000)
    expect(next.fromMs).toBe(15_000)
  })

  it('jumpView recenters on ms', () => {
    const prev = { fromMs: 0, toMs: 20_000 }
    const next = jumpView(prev, 50_000, data.from, data.to)
    expect(next.toMs - next.fromMs).toBe(20_000)
    expect((next.fromMs + next.toMs) / 2).toBeCloseTo(50_000, 0)
  })

  it('clampBar never exceeds track', () => {
    expect(clampBar(-20, 50, 100)).toEqual({ left: 0, width: 50 })
    expect(clampBar(80, 50, 100)).toEqual({ left: 50, width: 50 })
    expect(clampBar(0, 200, 100)).toEqual({ left: 0, width: 100 })
  })
})
