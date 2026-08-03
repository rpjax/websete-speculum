import { describe, expect, it } from 'vitest'
import {
  chapterDensityBuckets,
  composeEventCounts,
  formatGap,
  groupBeatRuns,
  shortEventLabel,
} from './chapterSheetModel'
import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'
import type { NarrativeBeat, NarrativeChapter } from '../model/narrativeTypes'

function beat(partial: {
  id: string
  name: string
  ms: number
  severity?: string
  domain?: string
  seq?: number
}): NarrativeBeat {
  const event: DiagnosticsEventRecord = {
    diagnosticsSchemaVersion: 2,
    id: partial.id,
    name: partial.name,
    domain: partial.domain ?? 'Telemetry',
    severity: partial.severity ?? 'Metric',
    utc: new Date(partial.ms).toISOString(),
    seq: partial.seq ?? null,
    payload: null,
    redaction: 'none',
  }
  return { ms: partial.ms, clusterKey: null, event }
}

describe('chapterSheetModel', () => {
  it('shortens dotted catalog names', () => {
    expect(shortEventLabel('Telemetry.Sampling.SampleCollected')).toBe('Sample Collected')
  })

  it('groups consecutive identical name+severity', () => {
    const runs = groupBeatRuns([
      beat({ id: '1', name: 'A.Sample', ms: 1000, seq: 1 }),
      beat({ id: '2', name: 'A.Sample', ms: 2000, seq: 2 }),
      beat({ id: '3', name: 'B.Other', ms: 3000, seq: 3 }),
      beat({ id: '4', name: 'A.Sample', ms: 4000, seq: 4 }),
    ])
    expect(runs).toHaveLength(3)
    expect(runs[0].beats).toHaveLength(2)
    expect(runs[1].name).toBe('B.Other')
    expect(runs[2].beats).toHaveLength(1)
  })

  it('splits runs across quiet gaps even for the same event', () => {
    const runs = groupBeatRuns([
      beat({ id: '1', name: 'A.Sample', ms: 1000, seq: 1 }),
      beat({ id: '2', name: 'A.Sample', ms: 2000, seq: 2 }),
      beat({ id: '3', name: 'A.Sample', ms: 200_000, seq: 3 }),
    ])
    expect(runs).toHaveLength(2)
    expect(runs[0].beats).toHaveLength(2)
    expect(runs[1].beats).toHaveLength(1)
  })

  it('keeps periodic samples in one run under the split threshold', () => {
    const runs = groupBeatRuns([
      beat({ id: '1', name: 'A.Sample', ms: 0, seq: 1 }),
      beat({ id: '2', name: 'A.Sample', ms: 35_000, seq: 2 }),
      beat({ id: '3', name: 'A.Sample', ms: 70_000, seq: 3 }),
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0].beats).toHaveLength(3)
  })

  it('composes counts sorted by frequency', () => {
    const comps = composeEventCounts([
      beat({ id: '1', name: 'A', ms: 1 }),
      beat({ id: '2', name: 'B', ms: 2 }),
      beat({ id: '3', name: 'A', ms: 3 }),
      beat({ id: '4', name: 'A', ms: 4 }),
    ])
    expect(comps[0]).toMatchObject({ name: 'A', count: 3 })
    expect(comps[1]).toMatchObject({ name: 'B', count: 1 })
  })

  it('formats quiet gaps', () => {
    expect(formatGap(2500)).toBe('2.5s quiet')
    expect(formatGap(90_000)).toBe('1m 30s quiet')
  })

  it('buckets density across the chapter window', () => {
    const chapter = {
      startMs: 0,
      endMs: 100,
      beats: [beat({ id: '1', name: 'A', ms: 0 }), beat({ id: '2', name: 'A', ms: 99 })],
    } as NarrativeChapter
    const buckets = chapterDensityBuckets(chapter, 10)
    expect(buckets).toHaveLength(10)
    expect(buckets[0]).toBe(1)
    expect(buckets[9]).toBe(1)
  })
})