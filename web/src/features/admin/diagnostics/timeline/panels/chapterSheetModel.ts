import type { NarrativeBeat, NarrativeChapter } from '../model/narrativeTypes'

/** Prefer explicit labels when the leaf name alone is ambiguous (e.g. Connection*). */
const EVENT_LABELS: Record<string, string> = {
  'Sessions.ConnectionStarted': 'Browser Connection Started',
  'Sessions.ConnectionClosed': 'Browser Connection Closed',
  'Sessions.ConnectionStartFailed': 'Browser Connection Start Failed',
  'Sessions.CloseConnectionFailed': 'Close Browser Connection Failed',
}

/** Last segment of a dotted catalog name, spaced for scan. */
export function shortEventLabel(name: string): string {
  const mapped = EVENT_LABELS[name]
  if (mapped) return mapped
  const leaf = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return leaf.replace(/([a-z\d])([A-Z])/g, '$1 $2')
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatGap(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms quiet`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s quiet`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s quiet` : `${m}m quiet`
}

/** Show a gap rail between runs when silence exceeds this. */
export const GAP_DISPLAY_MS = 15_000
/** Start a new run when silence between same-name beats exceeds this. */
export const RUN_SPLIT_MS = 120_000

export interface BeatRun {
  key: string
  name: string
  domain: string
  severity: string
  beats: NarrativeBeat[]
  startMs: number
  endMs: number
}

/** Collapse consecutive identical name+severity beats into runs.
 * A quiet gap ≥ RUN_SPLIT_MS starts a new run even for the same event.
 */
export function groupBeatRuns(beats: NarrativeBeat[]): BeatRun[] {
  const runs: BeatRun[] = []
  for (const beat of beats) {
    const prev = runs[runs.length - 1]
    const same =
      prev &&
      prev.name === beat.event.name &&
      prev.severity === beat.event.severity &&
      beat.ms - prev.endMs < RUN_SPLIT_MS
    if (same && prev) {
      prev.beats.push(beat)
      prev.endMs = beat.ms
      continue
    }
    runs.push({
      key: `${beat.event.id}`,
      name: beat.event.name,
      domain: beat.event.domain,
      severity: beat.event.severity,
      beats: [beat],
      startMs: beat.ms,
      endMs: beat.ms,
    })
  }
  return runs
}

/** Median interval between consecutive beats in a run (null if &lt;2 beats). */
export function runCadenceMs(run: BeatRun): number | null {
  if (run.beats.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < run.beats.length; i++) {
    gaps.push(run.beats[i].ms - run.beats[i - 1].ms)
  }
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 0 ? Math.round((gaps[mid - 1] + gaps[mid]) / 2) : gaps[mid]
}

export function formatCadence(ms: number): string {
  if (ms < 1000) return `~${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`
  return `~${Math.round(ms / 60_000)}m`
}

export interface EventComposition {
  name: string
  count: number
  severity: string
  domain: string
}

/** Aggregate by event name for the chapter composition strip. */
export function composeEventCounts(beats: NarrativeBeat[]): EventComposition[] {
  const map = new Map<string, EventComposition>()
  for (const b of beats) {
    const cur = map.get(b.event.name)
    if (cur) {
      cur.count += 1
      continue
    }
    map.set(b.event.name, {
      name: b.event.name,
      count: 1,
      severity: b.event.severity,
      domain: b.event.domain,
    })
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Bucket beat counts across the chapter window for a mini density sparkline. */
export function chapterDensityBuckets(chapter: NarrativeChapter, bucketCount = 32): number[] {
  const buckets = new Array<number>(bucketCount).fill(0)
  const span = Math.max(1, chapter.endMs - chapter.startMs)
  for (const b of chapter.beats) {
    const t = (b.ms - chapter.startMs) / span
    const i = Math.min(bucketCount - 1, Math.max(0, Math.floor(t * bucketCount)))
    buckets[i] += 1
  }
  return buckets
}