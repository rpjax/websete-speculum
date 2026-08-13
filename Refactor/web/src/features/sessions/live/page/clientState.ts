/**
 * Client → server control channel — docs/page-projection/spec/engine-redesign.md §5.9.5.
 * A control message, not a diff: it MUST NOT affect `sequence`.
 */
export interface PageProjectionClientState {
  visibility: 'visible' | 'hidden'
  appliedThroughSequence: number
  queuedFrames: number
  applyP50Ms: number
  applyP95Ms: number
  /** Applies exceeding `applyBudgetMs` (E9) since the last report. */
  overrunCount: number
}

export type PageProjectionClientStateSender = (state: PageProjectionClientState) => void | Promise<void>

const DEFAULT_REPORT_INTERVAL_MS = 1000
const APPLY_SAMPLE_RING = 64

/** Builds `PageProjectionClientState` from live counters and sends it on change / at most every `clientStateMs`. */
export class ClientStateTracker {
  private visibility: 'visible' | 'hidden' = 'visible'
  private appliedThroughSequence = 0
  private queuedFrames = 0
  private overrunCount = 0
  private readonly applySamples: number[] = []
  private lastVisibility: 'visible' | 'hidden' | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly send: PageProjectionClientStateSender
  private readonly intervalMs: number

  constructor(send: PageProjectionClientStateSender, intervalMs: number = DEFAULT_REPORT_INTERVAL_MS) {
    this.send = send
    this.intervalMs = intervalMs
  }

  /** Visibility is the one field worth an out-of-band report the moment it changes. */
  setVisibility(visibility: 'visible' | 'hidden'): void {
    this.visibility = visibility
    if (this.lastVisibility !== null && this.lastVisibility !== visibility) this.reportNow()
  }

  setAppliedThroughSequence(sequence: number): void {
    this.appliedThroughSequence = sequence
  }

  setQueuedFrames(count: number): void {
    this.queuedFrames = count
  }

  /** Records one rAF apply-batch duration; `overran` marks an E9 budget breach. */
  recordApply(durationMs: number, overran: boolean): void {
    this.applySamples.push(durationMs)
    if (this.applySamples.length > APPLY_SAMPLE_RING) this.applySamples.shift()
    if (overran) this.overrunCount += 1
  }

  snapshot(): PageProjectionClientState {
    const sorted = [...this.applySamples].sort((a, b) => a - b)
    return {
      visibility: this.visibility,
      appliedThroughSequence: this.appliedThroughSequence,
      queuedFrames: this.queuedFrames,
      applyP50Ms: percentile(sorted, 0.5),
      applyP95Ms: percentile(sorted, 0.95),
      overrunCount: this.overrunCount,
    }
  }

  /** Starts the periodic report (sends immediately, then every `clientStateMs`). */
  start(): () => void {
    this.lastVisibility = this.visibility
    this.reportNow()
    this.timer = setInterval(() => this.reportNow(), this.intervalMs)
    return () => this.stop()
  }

  stop(): void {
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
  }

  private reportNow(): void {
    this.lastVisibility = this.visibility
    const state = this.snapshot()
    this.overrunCount = 0 // "since the last report" (§5.9.5)
    void Promise.resolve(this.send(state)).catch(() => {})
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[index]!
}
