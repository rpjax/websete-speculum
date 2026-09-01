import { useCallback, useState } from 'react'
import type { BeatCluster, NarrativeBeat, NarrativeChapter, NarrativeLane } from '../model/narrativeTypes'

export type NarrativeSelection =
  | { kind: 'chapter'; chapter: NarrativeChapter }
  | { kind: 'beat'; beat: NarrativeBeat }
  | { kind: 'cluster'; cluster: BeatCluster }
  | { kind: 'lane'; lane: NarrativeLane }
  | null

export function useNarrativeSelection() {
  const [selection, setSelection] = useState<NarrativeSelection>(null)
  const [highlightChapterKey, setHighlightChapterKey] = useState<string | null>(null)
  const [highlightSpanIds, setHighlightSpanIds] = useState<Set<string>>(new Set())

  const clear = useCallback(() => {
    setSelection(null)
    setHighlightChapterKey(null)
    setHighlightSpanIds(new Set())
  }, [])

  const selectChapter = useCallback((chapter: NarrativeChapter) => {
    setSelection({ kind: 'chapter', chapter })
    setHighlightChapterKey(chapter.key)
    setHighlightSpanIds(new Set(chapter.spans.map((s) => s.spanId)))
  }, [])

  const selectBeat = useCallback((beat: NarrativeBeat, chapter?: NarrativeChapter | null) => {
    setSelection({ kind: 'beat', beat })
    if (chapter) {
      setHighlightChapterKey(chapter.key)
      const spanIds = new Set<string>()
      if (beat.event.spanId) spanIds.add(beat.event.spanId)
      if (beat.event.causationId) spanIds.add(beat.event.causationId)
      for (const s of chapter.spans) spanIds.add(s.spanId)
      setHighlightSpanIds(spanIds)
    } else {
      setHighlightChapterKey(null)
      setHighlightSpanIds(new Set(beat.event.spanId ? [beat.event.spanId] : []))
    }
  }, [])

  const selectCluster = useCallback((cluster: BeatCluster) => {
    setSelection({ kind: 'cluster', cluster })
  }, [])

  const selectLane = useCallback((lane: NarrativeLane) => {
    setSelection({ kind: 'lane', lane })
  }, [])

  const hoverChapter = useCallback((chapterKey: string | null, spanIds: string[] = []) => {
    if (selection) return
    setHighlightChapterKey(chapterKey)
    setHighlightSpanIds(new Set(spanIds))
  }, [selection])

  return {
    selection,
    highlightChapterKey,
    highlightSpanIds,
    clear,
    selectChapter,
    selectBeat,
    selectCluster,
    selectLane,
    hoverChapter,
  }
}
