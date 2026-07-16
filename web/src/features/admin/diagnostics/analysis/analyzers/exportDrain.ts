import type { Analyzer } from '../types'

export const exportDrainAnalyzer: Analyzer = {
  id: 'exportDrain',
  run(bag) {
    const exports = bag.events.filter((e) => e.name.startsWith('Motor.StateExport') || e.name.startsWith('Motor.Drain'))
    if (exports.length === 0) return []

    const exportOk = exports.filter((e) => e.name === 'Motor.StateExportCompleted').length
    const exportFail = exports.filter((e) => e.name === 'Motor.StateExportFailed').length
    const drainDone = exports.filter((e) => e.name === 'Motor.DrainCompleted').length

    return [
      {
        id: 'export-drain',
        severity: exportFail > 0 ? 'attention' : 'info',
        analyzer: 'exportDrain',
        title: 'State export and drain',
        body:
          `Export/drain beats: ${exports.length}. StateExportCompleted=${exportOk}, Failed=${exportFail}, DrainCompleted=${drainDone}. ` +
          `Exports persist browser state for later restore; failures carry errorCode+phase and close the motor.export span. ` +
          (exportFail === 0
            ? 'No export failures observed in this period.'
            : 'Export failures deserve follow-up against persisted session detail and sidecar health.'),
        evidenceRefs: exports.slice(0, 8).map((e) => e.id),
        relatedFindingIds: [],
        sectionHints: ['chapters', exportFail > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
