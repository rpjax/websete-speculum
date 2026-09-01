import type { Analyzer } from '../types'
import { detectStoryType, STORY_TYPES, formatDuration } from '@/lib/diagnosticsConstants'

export const chapterInventoryAnalyzer: Analyzer = {
  id: 'chapterInventory',
  run(bag) {
    const chapters = bag.narrative?.chapters ?? []
    if (chapters.length === 0) return []

    const byType: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    for (const c of chapters) {
      const type = detectStoryType(c.beats.map((b) => b.event.name))
      byType[type] = (byType[type] ?? 0) + 1
      byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1
    }

    const longest = [...chapters].sort((a, b) => b.durationMs - a.durationMs)[0]
    const typeLine = Object.entries(byType)
      .map(([t, n]) => `${STORY_TYPES[t as keyof typeof STORY_TYPES]?.label ?? t}: ${n}`)
      .join('; ')

    const okCount = byOutcome.ok ?? 0
    const failedCount = byOutcome.failed ?? 0

    return [
      {
        id: 'chapter-inventory',
        severity: failedCount > okCount ? 'notable' : 'info',
        analyzer: 'chapterInventory',
        title: 'Chapter inventory',
        body:
          `${chapters.length} chapter(s) were reconstructed from correlated beats. ` +
          `Mix by story type — ${typeLine}. ` +
          `Outcomes — ${Object.entries(byOutcome).map(([k, v]) => `${k}: ${v}`).join(', ')}. ` +
          (longest
            ? `The longest chapter lasted ${formatDuration(longest.durationMs)} ` +
              `(${longest.correlationId ?? longest.connectionId ?? 'system'}) and ended “${longest.outcome}”. `
            : '') +
          `What this means: chapters are the unit you should read on Timeline; type mix shows which Motor jobs dominated the mandate. ` +
          (failedCount > 0
            ? `What to do next: open failed chapters on Timeline for the same period and read beats before changing config.`
            : `Routine successes are listed below on purpose — a quiet period with completed work is information, not an empty report.`),
        evidenceRefs: chapters.slice(0, 8).map((c) => c.key),
        relatedFindingIds: [],
        sectionHints: ['chapters', 'cast'],
      },
      ...chapters
        .filter((c) => c.outcome === 'ok')
        .slice(0, 3)
        .map((c, i) => ({
          id: `chapter-ok-${i}`,
          severity: 'info' as const,
          analyzer: 'chapterInventory',
          title: 'Successful chapter example',
          body:
            `${c.proseHint} ` +
            `What this means: this chapter completed without a failure outcome — keep it visible so the report teaches the period’s healthy shape, not only its friction.`,
          evidenceRefs: c.beats.slice(0, 3).map((b) => b.event.id),
          relatedFindingIds: ['chapter-inventory'],
          sectionHints: ['chapters', 'proseTimeline'] as Array<'chapters' | 'proseTimeline'>,
        })),
    ]
  },
}
