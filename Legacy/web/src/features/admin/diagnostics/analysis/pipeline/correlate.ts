import type { Analyzer, EvidenceBag, Finding } from '../types'
import { volumePortraitAnalyzer } from '../analyzers/volumePortrait'
import { chapterInventoryAnalyzer } from '../analyzers/chapterInventory'
import { spanHealthAnalyzer } from '../analyzers/spanHealth'
import { navigationStoryAnalyzer } from '../analyzers/navigationStory'
import { sessionLifecycleAnalyzer } from '../analyzers/sessionLifecycle'
import { probeStoryAnalyzer } from '../analyzers/probeStory'
import { exportDrainAnalyzer } from '../analyzers/exportDrain'
import { governanceWindowAnalyzer } from '../analyzers/governanceWindow'
import { telemetrySignalsAnalyzer } from '../analyzers/telemetrySignals'
import { crossCorrelateAnalyzer } from '../analyzers/crossCorrelate'
import { evidenceCompletenessAnalyzer } from '../analyzers/evidenceCompleteness'

const ALL_ANALYZERS: Analyzer[] = [
  volumePortraitAnalyzer,
  chapterInventoryAnalyzer,
  spanHealthAnalyzer,
  navigationStoryAnalyzer,
  sessionLifecycleAnalyzer,
  probeStoryAnalyzer,
  exportDrainAnalyzer,
  governanceWindowAnalyzer,
  telemetrySignalsAnalyzer,
  crossCorrelateAnalyzer,
  evidenceCompletenessAnalyzer,
]

export function runAnalyzers(bag: EvidenceBag): Finding[] {
  const findings: Finding[] = []
  for (const analyzer of ALL_ANALYZERS) {
    try {
      const result = analyzer.run(bag)
      findings.push(...result)
    } catch {
      findings.push({
        id: `${analyzer.id}-error`,
        severity: 'attention',
        analyzer: analyzer.id,
        title: `Analyzer ${analyzer.id} failed`,
        body: 'This analyzer threw while interpreting evidence. Other sections remain valid.',
        evidenceRefs: [],
        relatedFindingIds: [],
        sectionHints: ['appendix'],
      })
    }
  }
  return findings
}
