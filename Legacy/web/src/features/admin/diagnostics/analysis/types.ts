import type {
  DiagnosticsEventRecord,
  DiagnosticsOverview,
  DiagnosticsRuntimeSnapshot,
  TelemetrySampleRecord,
  MotorSessionDiagnosticsSnapshot,
} from '@/lib/diagnosticsApi'
import type { Narrative, NarrativeChapter } from '../timeline/model/narrativeTypes'

export type AnalysisDepth = 'overview' | 'standard' | 'deep'
export type AnalysisStudyProfile =
  | 'operational'
  | 'post-incident'
  | 'capacity'
  | 'evidence-completeness'

export type AnalysisScope =
  | { kind: 'platform' }
  | { kind: 'sessions'; connectionIds: string[] }
  | { kind: 'system' }

export type FindingSeverity = 'info' | 'notable' | 'attention' | 'critical'

export interface AnalysisMandate {
  fromMs: number
  toMs: number
  scope: AnalysisScope
  depth: AnalysisDepth
  profile: AnalysisStudyProfile
  includeEvents: boolean
  includeTelemetry: boolean
  includeRuntime: boolean
  includeSnapshots: boolean
}

export interface EvidenceBag {
  mandate: AnalysisMandate
  events: DiagnosticsEventRecord[]
  narrative: Narrative | null
  telemetry: TelemetrySampleRecord[]
  overview: DiagnosticsOverview | null
  runtime: DiagnosticsRuntimeSnapshot | null
  snapshots: MotorSessionDiagnosticsSnapshot[]
  gaps: string[]
  catalogNames: string[]
}

export interface Finding {
  id: string
  severity: FindingSeverity
  analyzer: string
  title: string
  body: string
  evidenceRefs: string[]
  relatedFindingIds: string[]
  sectionHints: ReportSectionId[]
}

export type ReportSectionId =
  | 'cover'
  | 'portrait'
  | 'proseTimeline'
  | 'cast'
  | 'chapters'
  | 'signals'
  | 'crossings'
  | 'governance'
  | 'attention'
  | 'glossary'
  | 'appendix'

export interface ReportSection {
  id: ReportSectionId
  title: string
  paragraphs: string[]
  findings: Finding[]
}

export interface ReportDocument {
  generatedAt: string
  mandate: AnalysisMandate
  title: string
  sections: ReportSection[]
  findings: Finding[]
  glossary: { term: string; definition: string }[]
}

export type AnalysisPhase = 'idle' | 'collect' | 'correlate' | 'narrate' | 'render' | 'done' | 'error'

export interface Analyzer {
  id: string
  /** Return null/empty when preconditions fail — orchestrator skips quietly. */
  run: (bag: EvidenceBag) => Finding[]
}

export type { NarrativeChapter }
