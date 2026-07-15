import { describe, it, expect } from 'vitest'
import {
  bucketResourceSamples,
  filterByTimeRange,
  scaleSeries,
  analyzePoint,
  nearestIndex,
  type ResourceSample,
} from './resourceChartCompute'

function sample(ts: number, cpu: number, mem: number): ResourceSample {
  return { utc: new Date(ts).toISOString(), timestamp: ts, cpu, memoryMb: mem, threads: 20 }
}

describe('filterByTimeRange', () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0)
  const samples = [sample(base, 10, 400), sample(base + 30_000, 20, 450), sample(base + 90_000, 30, 500)]

  it('filters by preset window', () => {
    const out = filterByTimeRange(samples, '5m', null, null, base + 120_000)
    expect(out).toHaveLength(3)
    // Narrow window (last ~50s) keeps only the most recent sample.
    const narrow = filterByTimeRange(samples, 'custom', base + 70_000, base + 120_000, base + 120_000)
    expect(narrow).toHaveLength(1)
  })

  it('filters by custom range', () => {
    const out = filterByTimeRange(samples, 'custom', base + 20_000, base + 60_000, base)
    expect(out).toHaveLength(1)
    expect(out[0].cpu).toBe(20)
  })
})

describe('bucketResourceSamples', () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0)
  const samples = Array.from({ length: 6 }, (_, i) => sample(base + i * 60_000, 10 + i, 400 + i * 10))

  it('returns raw samples unchanged', () => {
    expect(bucketResourceSamples(samples, 'raw', 'avg')).toHaveLength(6)
  })

  it('aggregates into buckets', () => {
    const out = bucketResourceSamples(samples, '5m', 'avg')
    expect(out.length).toBeLessThan(samples.length)
    expect(out[0].cpu).toBeGreaterThan(0)
  })
})

describe('scaleSeries', () => {
  it('normalizes to 0-100', () => {
    const { values, min, max } = scaleSeries([10, 20, 30], 'normalized')
    expect(min).toBe(0)
    expect(max).toBe(100)
    expect(values[0]).toBe(0)
    expect(values[2]).toBe(100)
  })

  it('indexes from first value', () => {
    const { values } = scaleSeries([100, 110, 90], 'indexed')
    expect(values[0]).toBe(0)
    expect(values[1]).toBe(10)
    expect(values[2]).toBe(-10)
  })
})

describe('analyzePoint', () => {
  it('detects CPU/memory divergence', () => {
    const samples = [sample(1, 30, 500), sample(2, 10, 520)]
    const insight = analyzePoint(samples, 1)
    expect(insight?.divergences.length).toBeGreaterThan(0)
  })
})

describe('nearestIndex', () => {
  it('finds closest timestamp', () => {
    // ratio 0.55 → t=55, nearest of [0,50,100] is 50 (index 1)
    expect(nearestIndex([0, 50, 100], 0.55)).toBe(1)
    // ratio 0.8 → t=80, nearest is 100 (index 2)
    expect(nearestIndex([0, 50, 100], 0.8)).toBe(2)
  })
})
