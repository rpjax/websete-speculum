import type { Analyzer, Finding, ReportSectionId } from '../types'

export const crossCorrelateAnalyzer: Analyzer = {
  id: 'crossCorrelate',
  run(bag) {
    const findings: Finding[] = []
    const refused = bag.events.filter((e) => e.name === 'Motor.SessionRefused').length
    const lastCap = bag.telemetry
      .map((s) => s.payload.motor?.capacityUsedPct)
      .filter((n): n is number => typeof n === 'number')
      .at(-1)

    if (refused > 0 && lastCap != null && lastCap >= 85) {
      findings.push({
        id: 'cross-refuse-capacity',
        severity: 'attention',
        analyzer: 'crossCorrelate',
        title: 'Session refusals align with high capacity use',
        body:
          `${refused} SessionRefused beat(s) coincide with telemetry capacityUsedPct≈${lastCap.toFixed(1)}%. ` +
          `This is a coherent capacity story: the gate refused new sessions while the platform was near maxSessions.`,
        evidenceRefs: bag.events.filter((e) => e.name === 'Motor.SessionRefused').slice(0, 5).map((e) => e.id),
        relatedFindingIds: ['session-lifecycle', 'telemetry-capacity'],
        sectionHints: ['crossings', 'attention'],
      })
    }

    const degraded = bag.events.some((e) => e.name === 'Diagnostics.Degraded')
    const probeFriction = bag.events.filter((e) =>
      e.name === 'Sidecar.DiagProbeTimedOut' || e.name === 'Sidecar.DiagProbeRejected' || e.name === 'Sidecar.DiagProbeBusy',
    ).length
    if (degraded && probeFriction > 0) {
      findings.push({
        id: 'cross-degraded-probes',
        severity: 'notable',
        analyzer: 'crossCorrelate',
        title: 'Probe friction inside a degraded window',
        body:
          `Diagnostics.Degraded appears in the period alongside ${probeFriction} probe timeout/reject/busy beat(s). ` +
          `Under Degraded, non-Metric capabilities are capped — BrowserQuery probes may return probe_level_insufficient. ` +
          `Treat probe failures here as governance-linked until Recovered/elevate clears the cap.`,
        evidenceRefs: [],
        relatedFindingIds: ['governance-window', 'probe-story'],
        sectionHints: ['crossings', 'governance'],
      })
    }

    const faults = bag.events.filter((e) => e.name === 'Motor.SidecarFaulted').length
    const abandon = bag.events.filter((e) => e.name === 'Diagnostics.SpanAbandoned').length
    if (faults > 0 && abandon > 0) {
      findings.push({
        id: 'cross-sidecar-abandon',
        severity: 'attention',
        analyzer: 'crossCorrelate',
        title: 'Sidecar faults with abandoned spans',
        body:
          `${faults} SidecarFaulted and ${abandon} SpanAbandoned beat(s) share this window. ` +
          `Teardown/timeout abandon closes are expected when a sidecar dies mid-span; inspect export/navigate spans for incomplete work.`,
        evidenceRefs: [],
        relatedFindingIds: ['span-health'],
        sectionHints: ['crossings', 'attention'],
      })
    }

    if (findings.length === 0 && bag.events.length > 0) {
      findings.push({
        id: 'cross-none-strong',
        severity: 'info',
        analyzer: 'crossCorrelate',
        title: 'No strong cross-signal incident pattern',
        body:
          'Heuristic cross-correlations (refusals×capacity, degraded×probe friction, sidecar fault×span abandon) did not fire. ' +
          'That is a positive completeness note for this period — routine operation without those classic multi-signal fingerprints.',
        evidenceRefs: [],
        relatedFindingIds: [],
        sectionHints: ['crossings', 'portrait'] satisfies ReportSectionId[],
      })
    }

    return findings
  },
}
