import type { Analyzer } from '../types'
import { formatDuration } from '@/lib/diagnosticsConstants'

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

export const spanHealthAnalyzer: Analyzer = {
  id: 'spanHealth',
  run(bag) {
    const spans = bag.narrative?.chapters.flatMap((c) => c.spans) ?? []
    if (spans.length === 0) return []

    const byKey = new Map<string, typeof spans>()
    for (const s of spans) {
      const key = s.spanKey ?? 'unknown'
      const list = byKey.get(key) ?? []
      list.push(s)
      byKey.set(key, list)
    }

    const lines: string[] = []
    for (const [key, list] of byKey) {
      const durations = list.map((s) => s.durationMs).filter((d): d is number => d != null).sort((a, b) => a - b)
      const abandoned = list.filter((s) => s.status === 'abandoned').length
      const open = list.filter((s) => s.status === 'open').length
      lines.push(
        `${key}: n=${list.length}, open=${open}, abandoned=${abandoned}` +
          (durations.length
            ? `, p50=${formatDuration(percentile(durations, 50))}, p95=${formatDuration(percentile(durations, 95))}`
            : ''),
      )
    }

    const abandonedTotal = spans.filter((s) => s.status === 'abandoned').length

    return [
      {
        id: 'span-health',
        severity: abandonedTotal > 0 ? 'notable' : 'info',
        analyzer: 'spanHealth',
        title: 'Span health by key',
        body:
          `Reconstructed ${spans.length} span(s). Per-key summary — ${lines.join(' · ')}. ` +
          (abandonedTotal > 0
            ? `${abandonedTotal} span(s) were abandoned (timeout, disconnect, or boot recovery). Abandonment is itself a catalogued Diagnostics.SpanAbandoned close.`
            : 'No abandoned spans in this window — open/close pairing completed cleanly where closes were present.'),
        evidenceRefs: spans.filter((s) => s.status === 'abandoned').slice(0, 5).map((s) => s.spanId),
        relatedFindingIds: [],
        sectionHints: ['chapters', abandonedTotal > 0 ? 'attention' : 'portrait'],
      },
    ]
  },
}
