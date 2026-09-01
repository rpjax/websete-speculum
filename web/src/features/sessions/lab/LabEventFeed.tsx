import { FrontDebugFeed } from '@/features/sessions/debug/FrontDebugFeed'
import type { FrontDebugLogEntry } from '@/features/sessions/debug/frontDebugLog'

/** Lab Activity tab — shared FrontDebugFeed. */
export function LabEventFeed({
  entries,
  observationEnabled = true,
}: {
  entries: FrontDebugLogEntry[]
  observationEnabled?: boolean
}) {
  return (
    <FrontDebugFeed
      entries={entries}
      observationEnabled={observationEnabled}
      emptyHint="No wire events yet. Start a session to see hub, Dom Diff/Input, and error traffic."
    />
  )
}
