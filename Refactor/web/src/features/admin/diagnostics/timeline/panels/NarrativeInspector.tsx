import type { NarrativeSelection } from '../hooks/useNarrativeSelection'
import { ChapterInspector } from './ChapterInspector'
import { BeatInspector, LaneInspector } from './BeatInspector'

interface NarrativeInspectorProps {
  selection: NarrativeSelection
  onClose: () => void
  onJumpToMs?: (ms: number) => void
}

/** Selection brief under the rail — natural height, page scrolls (no nested dock). */
export function NarrativeInspector({ selection, onClose, onJumpToMs }: NarrativeInspectorProps) {
  if (!selection) return null

  if (selection.kind === 'chapter') {
    return <ChapterInspector chapter={selection.chapter} onClose={onClose} onJumpToMs={onJumpToMs} />
  }
  if (selection.kind === 'beat') {
    return (
      <div className="rounded-xl border border-border bg-card">
        <BeatInspector beat={selection.beat} onClose={onClose} />
      </div>
    )
  }
  if (selection.kind === 'cluster') {
    return (
      <div className="rounded-xl border border-border bg-card">
        <BeatInspector cluster={selection.cluster} onClose={onClose} />
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card">
      <LaneInspector lane={selection.lane} onClose={onClose} />
    </div>
  )
}
