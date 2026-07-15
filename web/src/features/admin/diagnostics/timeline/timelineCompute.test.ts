import { describe, it, expect } from 'vitest'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import {
  parseTimeRange,
  parseBucketSize,
  computeBucketCount,
  computeBuckets,
  computeDomainBuckets,
  computeCumulative,
} from './timelineCompute'

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0)

function evt(
  offsetMs: number,
  domain = 'MotorLive',
  severity = 'Info',
): DiagnosticsEventRecord {
  const utc = new Date(BASE + offsetMs).toISOString()
  return {
    diagnosticsSchemaVersion: 1,
    id: `${domain}-${offsetMs}`,
    utc,
    domain,
    name: `${domain}.Something`,
    severity,
    payload: null,
    redaction: 'None',
  }
}

describe('parseTimeRange', () => {
  it('maps known ranges', () => {
    expect(parseTimeRange('15m')).toBe(15 * 60_000)
    expect(parseTimeRange('1h')).toBe(3_600_000)
    expect(parseTimeRange('6h')).toBe(6 * 3_600_000)
    expect(parseTimeRange('24h')).toBe(86_400_000)
  })

  it('falls back to 1h for ranges without a fixed window (all)', () => {
    expect(parseTimeRange('all')).toBe(3_600_000)
  })
})

describe('parseBucketSize', () => {
  it('maps fixed bucket sizes', () => {
    expect(parseBucketSize('1m')).toBe(60_000)
    expect(parseBucketSize('5m')).toBe(300_000)
    expect(parseBucketSize('15m')).toBe(900_000)
    expect(parseBucketSize('1h')).toBe(3_600_000)
  })

  it('falls back to 5m for auto', () => {
    expect(parseBucketSize('auto')).toBe(300_000)
  })
})

describe('computeBucketCount', () => {
  it('clamps auto to the 15..60 band', () => {
    expect(computeBucketCount([], 'auto')).toBe(15)
    const many = Array.from({ length: 600 }, (_, i) => evt(i * 1000))
    expect(computeBucketCount(many, 'auto')).toBe(60)
  })

  it('returns a default of 20 for fixed sizes with fewer than two events', () => {
    expect(computeBucketCount([evt(0)], '5m')).toBe(20)
  })
})

describe('computeBuckets', () => {
  it('returns an empty result for no events', () => {
    const out = computeBuckets([], 5)
    expect(out.buckets).toHaveLength(0)
    expect(out.max).toBe(0)
  })

  it('distributes every event across buckets and tallies severities', () => {
    const events = [
      evt(0),
      evt(60_000, 'MotorLive', 'Error'),
      evt(120_000, 'MotorLive', 'Warning'),
      evt(180_000),
      evt(240_000),
      evt(300_000), // exactly at maxTime → clamped into the last bucket
    ]
    const out = computeBuckets(events, 3)

    expect(out.buckets).toHaveLength(3)
    expect(out.minTime).toBe(BASE)
    expect(out.maxTime).toBe(BASE + 300_000)
    expect(out.buckets.reduce((s, b) => s + b.count, 0)).toBe(events.length)
    expect(out.buckets.reduce((s, b) => s + b.errors, 0)).toBe(1)
    expect(out.buckets.reduce((s, b) => s + b.warnings, 0)).toBe(1)
    expect(out.max).toBe(Math.max(...out.buckets.map((b) => b.count)))
  })
})

describe('computeDomainBuckets', () => {
  it('returns an empty result for no events', () => {
    const out = computeDomainBuckets([], 4)
    expect(out.domains).toHaveLength(0)
    expect(out.maxStacked).toBe(0)
  })

  it('splits counts per domain with aligned bucket arrays', () => {
    const events = [
      evt(0, 'MotorLive'),
      evt(60_000, 'SidecarBrowser'),
      evt(120_000, 'MotorLive'),
      evt(180_000, 'SidecarBrowser'),
    ]
    const out = computeDomainBuckets(events, 3)

    expect(out.domains.map((d) => d.domain).sort()).toEqual(['MotorLive', 'SidecarBrowser'])
    for (const d of out.domains) expect(d.counts).toHaveLength(3)
    expect(out.bucketStarts).toHaveLength(3)
    expect(out.bucketEnds).toHaveLength(3)

    const total = out.domains.reduce((s, d) => s + d.counts.reduce((a, b) => a + b, 0), 0)
    expect(total).toBe(events.length)

    const perBucketStacks = out.bucketStarts.map((_, i) =>
      out.domains.reduce((sum, d) => sum + d.counts[i], 0),
    )
    expect(out.maxStacked).toBe(Math.max(...perBucketStacks, 1))
  })
})

describe('computeCumulative', () => {
  it('returns an empty result for no events', () => {
    expect(computeCumulative([], 5)).toEqual({ times: [], totals: [] })
  })

  it('produces a monotonic curve ending at the total count', () => {
    const events = [evt(0), evt(50_000), evt(120_000), evt(200_000), evt(260_000)]
    const out = computeCumulative(events, 5)

    expect(out.times).toHaveLength(5)
    expect(out.totals).toHaveLength(5)
    for (let i = 1; i < out.totals.length; i++) {
      expect(out.totals[i]).toBeGreaterThanOrEqual(out.totals[i - 1])
    }
    expect(out.totals[out.totals.length - 1]).toBe(events.length)
  })
})
