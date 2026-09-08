/**
 * The settle decision, as a pure function (atoms.md §4).
 *
 * Pure on purpose: it is the piece that decides whether anything is captured at
 * all, so it has to be testable without a browser. A live site that never stops
 * moving must still yield snapshots, and it must say why it is not settling —
 * silence is what makes an operator stare at "snapshots 0" with no idea why.
 */

export type StallReason = 'loading' | 'mutating' | 'fonts' | 'inflight'

export interface SettleInput {
  readyState: string
  /** ms since the last DOM mutation */
  quietMs: number
  settleMs: number
  fontsPending: boolean
  /** in-flight requests younger than the stall threshold — these block settle */
  freshInflight: number
  /** in-flight longer than the threshold: streams, polls, beacons — these do not (A-11) */
  longLived: number
  msSinceLastSnapshot: number
  /** safety-net cadence for a page that never settles (A-12) */
  intervalMs: number
}

export type SettleDecision =
  | { take: false; reason: StallReason }
  | { take: true; trigger: 'settle' }
  | { take: true; trigger: 'interval'; reason: StallReason }

export function decideSettle(input: SettleInput): SettleDecision {
  const reason = stallReason(input)
  if (reason === null) return { take: true, trigger: 'settle' }
  // A-12 — a page that never settles (ticker, carousel, poller) still gets
  // snapshots, flagged unsettled, so the session is never empty.
  if (reason !== 'loading' && input.msSinceLastSnapshot >= input.intervalMs) {
    return { take: true, trigger: 'interval', reason }
  }
  return { take: false, reason }
}

function stallReason(input: SettleInput): StallReason | null {
  if (input.readyState !== 'complete') return 'loading'
  if (input.freshInflight > 0) return 'inflight'
  if (input.fontsPending) return 'fonts'
  if (input.quietMs < input.settleMs) return 'mutating'
  return null
}

export function explainStall(reason: StallReason, input: SettleInput): string {
  switch (reason) {
    case 'loading': return `document ${input.readyState}`
    case 'inflight': return `${input.freshInflight} request(s) in flight` +
      (input.longLived ? ` (+${input.longLived} long-lived, ignored)` : '')
    case 'fonts': return 'web fonts still loading'
    case 'mutating': return `DOM mutated ${input.quietMs}ms ago, needs ${input.settleMs}ms quiet`
  }
}
