import type { DiagnosticsEventRecord } from '@/lib/diagnosticsApi'

export type SpanStatus = 'open' | 'closed' | 'abandoned'
export type LaneKind = 'session' | 'system'
export type NarrativeGranularity = 'chapters' | 'chapters+spans' | 'full'
export type NarrativeScope =
  | { kind: 'platform' }
  | { kind: 'session'; connectionId: string }

export type NarrativePeriodPreset = '15m' | '1h' | '6h' | '24h' | 'all' | 'custom'

export interface NarrativePeriod {
  preset: NarrativePeriodPreset
  /** Inclusive start (ms). Null when preset resolves relative-to-now. */
  fromMs: number | null
  /** Inclusive end (ms). Null means "now". */
  toMs: number | null
}

export interface NarrativeLayers {
  systemLane: boolean
  beatRibbon: boolean
  governanceBands: boolean
  signalOverlay: boolean
  liveTail: boolean
}

export const DEFAULT_LAYERS: NarrativeLayers = {
  systemLane: true,
  beatRibbon: true,
  governanceBands: false,
  signalOverlay: false,
  liveTail: false,
}

export interface NarrativeSpan {
  spanId: string
  spanKey: string | null
  open: DiagnosticsEventRecord
  close: DiagnosticsEventRecord | null
  startMs: number
  endMs: number | null
  durationMs: number | null
  status: SpanStatus
  ok: boolean
  connectionId: string | null
  correlationId: string | null
  depth: number
}

export interface NarrativeBeat {
  event: DiagnosticsEventRecord
  ms: number
  clusterKey: string | null
}

export type ChapterOutcome = 'ok' | 'warning' | 'failed' | 'open' | 'unknown'

export interface NarrativeChapter {
  key: string
  correlationId: string | null
  connectionId: string | null
  beats: NarrativeBeat[]
  spans: NarrativeSpan[]
  startMs: number
  endMs: number
  durationMs: number
  errorCount: number
  outcome: ChapterOutcome
  proseHint: string
}

export interface NarrativeLane {
  kind: LaneKind
  id: string
  label: string
  chapters: NarrativeChapter[]
  beats: NarrativeBeat[]
}

export interface BeatCluster {
  key: string
  ms: number
  beats: NarrativeBeat[]
}

export interface Narrative {
  scope: NarrativeScope
  period: NarrativePeriod
  lanes: NarrativeLane[]
  chapters: NarrativeChapter[]
  clusters: BeatCluster[]
  startMs: number
  endMs: number
  eventCount: number
  completeness: {
    filteredUntilClient: boolean
    note: string | null
  }
}

export interface ReadingFilters {
  domains: string[]
  severities: string[]
  search: string
}
