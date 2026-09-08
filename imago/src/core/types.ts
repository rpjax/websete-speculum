// Session, timeline and IR shapes. Spec: docs/imago/spec/flow.md §1, ir.md.

export type SessionStatus = 'recording' | 'closing' | 'closed' | 'failed'

export interface SessionConfig {
  /** Chrome channel (default 'chrome' — system browser, no download). */
  channel?: string
  /** Explicit browser binary; overrides channel. */
  executablePath?: string
  viewport?: { width: number; height: number } | null
  userAgent?: string
  locale?: string
  timezoneId?: string
  /** Hosts never recorded (C-5). Substring match on hostname. */
  captureFilters?: string[]
  /** Settle window in ms (atoms.md §4). */
  settleMs?: number
  /** RAM guard: stop buffering bodies above this many bytes in flight (S-5). */
  maxBodyBytes?: number
  /** Upper bound on references the resolver fetches at close (C-4). */
  maxResolveAtClose?: number
}

export interface SessionMeta {
  /** Bumped whenever the session's shape changes. Mismatched sessions are wiped. */
  schema: number
  id: string
  name: string
  status: SessionStatus
  origins: string[]
  openedAt: string
  closedAt?: string
  config: SessionConfig
  versions: { imago: string; node: string; browser?: string }
  stats: {
    snapshots: number
    requests: number
    bytes: number
    atoms: number
    errors: number
  }
}

/** Trigger for a snapshot — always recorded with its reason (A-1). */
export type SnapshotTrigger = 'settle' | 'mark' | 'interval'

export interface SnapshotRecord {
  id: string
  trigger: SnapshotTrigger
  at: string
  url: string
  title: string
  viewport: { width: number; height: number; dpr: number }
  /** hash of the canonical tree (trees/<hash>.json) */
  tree: string
  /** hashes of collected stylesheets, in cascade order (styles/<hash>.css) */
  styles: string[]
  /** asset URLs referenced by tree + styles, for the closure check (C-4) */
  refs: string[]
  /** relative path under oracles/<snapId>/ when reference screenshot exists */
  oracleRef?: string
  /** operator-supplied name when trigger === 'mark' */
  mark?: string
  /** settle predicate was not satisfied at capture time */
  unsettled?: boolean
}

export interface NetworkRecord {
  reqId: string
  at: string
  method: string
  url: string
  host: string
  resourceType: string
  status?: number
  requestHeaders: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBodyHash?: string
  /** Apollo persisted-query hash, when the POST body uses one. */
  persistedQueryHash?: string
  responseBodyHash?: string
  bytes?: number
  /** api | asset | telemetry | thirdparty | challenge — classified, never filtered (N-1) */
  kind: string
  /** fetched by the resolver at close, not by the page (C-4) */
  resolvedAtClose?: boolean
  error?: string
}

export type TimelineEvent =
  | { t: 'session.open'; at: string; session: string }
  | { t: 'navigation'; at: string; url: string; kind: 'hard' | 'soft' }
  | { t: 'request'; at: string; reqId: string }
  | { t: 'snapshot'; at: string; snapId: string; trigger: SnapshotTrigger; dedupeOf?: string }
  | { t: 'mark'; at: string; name: string }
  | { t: 'stall'; at: string; reason: string; detail: string }
  | { t: 'resolve'; at: string; done: number; total: number; failed: number; label?: string }
  | { t: 'error'; at: string; code: string; detail: string }
  | { t: 'session.close'; at: string }

export interface ImagoError {
  code: string
  detail: string
  at: string
}
