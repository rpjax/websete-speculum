import type { FrontDebugLogEntry } from '@/features/sessions/debug/frontDebugLog'
import type { LabConsoleLine } from './labConsole'

/**
 * Combined Activity (observation ring) + Console export for /lab — one JSON
 * file so an operator can hand over a single artifact instead of two JSONL/
 * console-copy exports. Journal facts stay out of scope: those are already
 * queryable via the admin Journal API independent of the browser tab.
 */
export interface LabFrontLogExport {
  exportedAt: string
  sessionId: string | null
  activity: FrontDebugLogEntry[]
  console: LabConsoleLine[]
}

/**
 * Build the combined export payload.
 *
 * `entries` is stored newest-first (ring push-to-front) — flip it to
 * chronological order so it reads the same direction as `console`, which is
 * already stored oldest-first (append-only).
 */
export function buildLabFrontLogExport(
  entries: FrontDebugLogEntry[],
  consoleLines: LabConsoleLine[],
  sessionId: string | null,
): LabFrontLogExport {
  return {
    exportedAt: new Date().toISOString(),
    sessionId,
    activity: entries.slice().reverse(),
    console: consoleLines.slice(),
  }
}

/** Trigger a browser download of the combined export as a formatted .json file. */
export function downloadLabFrontLogJson(payload: LabFrontLogExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `speculum-lab-frontend-logs-${Date.now()}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
