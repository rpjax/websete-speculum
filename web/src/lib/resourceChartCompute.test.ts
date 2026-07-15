import { describe, it, expect } from 'vitest'
import {
  bucketResourceSamples,
  filterByTimeRange,
  scaleSeries,
  analyzePoint,
  nearestIndex,
  telemetryToResourceSamples,
  computeStats,
  computeAutoBucketMs,
  parseGranularityMs,
  toDatetimeLocalValue,
  parseDatetimeLocalValue,
  METRICS,
  type ResourceSample,
} from './resourceChartCompute'
import type { DiagnosticsEventRecord } from './diagnosticsApi'

function sample(ts: number, cpu: number, mem: number): ResourceSample {
  return { utc: new Date(ts).toISOString(), timestamp: ts, cpu, memoryMb: mem, threads: 20 }
}

function telemetryEvent(
  utc: string,
  name: string,
  payload: unknown,
): DiagnosticsEventRecord {
  return {
    diagnosticsSchemaVersion: 1,
    id: utc,
    utc,
    domain: 'Telemetry',
    name,
    severity: 'Info',
    payload,
    redaction: 'None',
  }
}

function hostSample(utc: string, host: Record<string, unknown>): DiagnosticsEventRecord {
  return telemetryEvent(utc, 'Telemetry.SampleCollected', { host })
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

describe('telemetryToResourceSamples', () => {
  const t1 = '2026-01-01T12:00:00.000Z'
  const t2 = '2026-01-01T12:00:30.000Z'

  it('projects the host section: bytes→MB, cpu rounded to .1, threads passthrough', () => {
    const out = telemetryToResourceSamples([
      hostSample(t1, { cpuUsage: 42.37, memoryUsed: 128 * 1024 * 1024, threadCount: 33 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ utc: t1, cpu: 42.4, memoryMb: 128, threads: 33 })
    expect(out[0].timestamp).toBe(new Date(t1).getTime())
  })

  it('drops samples that carry no host section', () => {
    const out = telemetryToResourceSamples([
      telemetryEvent(t1, 'Telemetry.SampleCollected', { motor: { activeSessions: 2 } }),
      telemetryEvent(t2, 'Telemetry.SampleCollected', null),
    ])
    expect(out).toHaveLength(0)
  })

  it('ignores events that are not Telemetry.SampleCollected', () => {
    const out = telemetryToResourceSamples([
      telemetryEvent(t1, 'Telemetry.Other', { host: { cpuUsage: 10 } }),
      hostSample(t2, { cpuUsage: 5, memoryUsed: 64 * 1024 * 1024, threadCount: 10 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].utc).toBe(t2)
  })

  it('defaults non-numeric host fields (cpu→0, memMb→0, threads→null)', () => {
    const out = telemetryToResourceSamples([
      hostSample(t1, { cpuUsage: 'n/a', memoryUsed: null }),
    ])
    expect(out[0]).toMatchObject({ cpu: 0, memoryMb: 0, threads: null })
  })

  it('returns samples sorted ascending by timestamp', () => {
    const out = telemetryToResourceSamples([
      hostSample(t2, { cpuUsage: 20, memoryUsed: 0, threadCount: 2 }),
      hostSample(t1, { cpuUsage: 10, memoryUsed: 0, threadCount: 1 }),
    ])
    expect(out.map((s) => s.utc)).toEqual([t1, t2])
  })
})

describe('METRICS', () => {
  const s: ResourceSample = { utc: '', timestamp: 0, cpu: 12.5, memoryMb: 256, threads: null }

  it('exposes cpu/memory/threads extractors keyed correctly', () => {
    expect(METRICS.map((m) => m.key)).toEqual(['cpu', 'memory', 'threads'])
  })

  it('extracts the matching field, mapping null threads to 0', () => {
    const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m.extract(s)]))
    expect(byKey).toEqual({ cpu: 12.5, memory: 256, threads: 0 })
  })
})

describe('computeStats', () => {
  it('returns zeros for an empty series', () => {
    expect(computeStats([])).toEqual({ min: 0, max: 0, avg: 0, p95: 0, p99: 0 })
  })

  it('computes min/max/avg and percentile picks', () => {
    // sorted length 5 → p95 index floor(4.75)=4, p99 index floor(4.95)=4 → both = 50
    expect(computeStats([30, 10, 50, 20, 40])).toEqual({ min: 10, max: 50, avg: 30, p95: 50, p99: 50 })
  })
})

describe('computeAutoBucketMs', () => {
  it('falls back to 60s for fewer than two samples', () => {
    expect(computeAutoBucketMs([])).toBe(60_000)
    expect(computeAutoBucketMs([sample(0, 1, 1)])).toBe(60_000)
  })

  it('never buckets below the 30s floor', () => {
    const tight = [sample(0, 1, 1), sample(100, 2, 2)]
    expect(computeAutoBucketMs(tight)).toBe(30_000)
  })

  it('targets ~12 buckets over the spread, clamped to a minimum of 12', () => {
    // 24 samples, 1h apart → targetBuckets = clamp(round(24/2)=12) = 12; range/12
    const spread = Array.from({ length: 24 }, (_, i) => sample(i * 3_600_000, 10, 10))
    expect(computeAutoBucketMs(spread)).toBe(6_900_000)
  })
})

describe('parseGranularityMs', () => {
  const samples = Array.from({ length: 24 }, (_, i) => sample(i * 3_600_000, 10, 10))

  it('maps raw to 0 and auto to the auto bucket', () => {
    expect(parseGranularityMs('raw', samples)).toBe(0)
    expect(parseGranularityMs('auto', samples)).toBe(computeAutoBucketMs(samples))
  })

  it('maps fixed granularities to their millisecond size', () => {
    expect(parseGranularityMs('1m', samples)).toBe(60_000)
    expect(parseGranularityMs('5m', samples)).toBe(300_000)
    expect(parseGranularityMs('15m', samples)).toBe(900_000)
    expect(parseGranularityMs('1h', samples)).toBe(3_600_000)
  })
})

describe('datetime-local conversion', () => {
  it('round-trips a minute-aligned local timestamp', () => {
    const ts = new Date(2026, 0, 15, 10, 30, 0, 0).getTime()
    const local = toDatetimeLocalValue(ts)
    expect(local).toBe('2026-01-15T10:30')
    expect(parseDatetimeLocalValue(local)).toBe(ts)
  })

  it('returns null for empty or invalid input', () => {
    expect(parseDatetimeLocalValue('')).toBeNull()
    expect(parseDatetimeLocalValue('not-a-date')).toBeNull()
  })
})
