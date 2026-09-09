/** parity/report.json schema v1 — docs/imago/spec/parity.md */

export const PARITY_SCHEMA = 1

export interface ParityGap {
  layer: 'network' | 'fixture' | 'asset' | 'visual' | 'blocked'
  summary: string
  url?: string
  note?: string
}

export interface O4Result {
  pass: boolean
  missing: number
  missingAsset: number
  blocked: number
  fixture: number
  /** Telemetry, browser extensions, GTM /metrics proxy — excluded from pass (parity.md §4). */
  ignored: number
  gaps: ParityGap[]
}

export interface GraphqlMissing {
  pq?: string
  operationName?: string
  note?: string
}

export interface O4bResult {
  pass: boolean
  graphqlMissing: GraphqlMissing[]
}

export interface O1Result {
  pass: boolean
  skipped: boolean
  differPct?: number
  diffPixels?: number
  totalPixels?: number
  maxRegion?: { w: number; h: number }
  reason?: string
}

export interface ParityReport {
  schema: number
  sessionId: string
  runId: string
  at: string
  entrySnapId: string
  viewport: { width: number; height: number; dpr: number }
  pass: boolean
  /** Tape rows excluded as telemetry / extensions / local metrics proxy. */
  ignored?: number
  oracles: {
    O4: O4Result
    O4b: O4bResult
    O1: O1Result
  }
  gaps: ParityGap[]
}

export interface OracleMeta {
  url: string
  viewport: { width: number; height: number; dpr: number }
  locale?: string
  timezone?: string
  userAgent?: string
  capturedAt: string
}
