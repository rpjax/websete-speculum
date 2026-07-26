import { collectEvidence } from './collect'
import { runAnalyzers } from './correlate'
import { narrateReport } from './narrate'
import type { AnalysisMandate, AnalysisPhase, ReportDocument } from '../types'

export type ProgressCallback = (phase: AnalysisPhase, detail?: string) => void

export async function runAnalysis(
  mandate: AnalysisMandate,
  onProgress?: ProgressCallback,
): Promise<ReportDocument> {
  onProgress?.('collect', 'Collecting events, telemetry, and runtime…')
  const bag = await collectEvidence(mandate)

  onProgress?.('correlate', 'Running analyzers…')
  const findings = runAnalyzers(bag)

  onProgress?.('narrate', 'Composing didactic report…')
  const report = narrateReport(bag, findings)

  onProgress?.('render', 'Ready')
  onProgress?.('done')
  return report
}
