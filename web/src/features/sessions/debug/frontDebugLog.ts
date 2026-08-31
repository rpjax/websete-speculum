/**
 * Shared front observation ring — Lab and Live consume the same contract.
 * Enablement: Telemetry.ClientObservation (Admin) → public client-config.
 * Pair entries with Journal Telemetry.Sessions.* facts via plane/hop/ids.
 */

export type FrontDebugLogLevel = 'info' | 'wire' | 'warn' | 'error'

/** Planes that mirror server Journal Telemetry subdomains. */
export type FrontDebugPlane =
  | 'session'
  | 'videoStreamingInput'
  | 'pageProjectionFrame'
  | 'pageProjectionIntent'

/**
 * Client hops aligned with Journal path semantics where applicable.
 * `client_sent` / `client_recv` / `client_apply` are front-only; server hops live in Journal.
 */
export type FrontDebugHop =
  | 'client_sent'
  | 'client_recv'
  | 'client_apply'
  | 'client_drop'
  | 'client_desync'
  | 'client_resync_request'
  | 'client_resync_apply'
  | 'client_arm'
  | 'client_epoch_arm'
  | 'client_disarm'
  | 'client_surface_probe'
  | 'programmaticSuppress'
  | 'syncUrl'
  | 'wire'
  | 'lifecycle'
  | `cssom/${string}`
  | (string & {})

export interface FrontDebugLogFields {
  plane?: FrontDebugPlane
  hop?: FrontDebugHop
  /** Input / frame kind (click, mousemove, snapshot, patch, …). */
  kind?: string
  sessionId?: string | null
  generation?: number | null
  sequence?: number | null
  expectedSequence?: number | null
  anchor?: string | null
  armed?: boolean
  remount?: boolean
  dropped?: boolean
  errorCode?: string | null
  phase?: string | null
  /** Client performance.now() at hop (ms). */
  tClient?: number
  /** Opaque wire correlation id (pairs with Journal TraceId). */
  traceId?: string | null
  /** Client−sidecar lag when frame timestamp present (ms). */
  lagMs?: number | null
  /** PageProjection applier probe at SyncUrl (observe-only soft-nav). */
  pageProjectionGeneration?: number | null
  pageProjectionLastSequence?: number | null
  pageProjectionDesynced?: boolean | null
  scrollX?: number | null
  scrollY?: number | null
  scrollTop?: number | null
  scrollLeft?: number | null
  key?: string | null
  valueLen?: number | null
  /** Extra structured payload (serialized into detail). */
  extra?: Record<string, unknown>
}

export interface FrontDebugLogEntry {
  id: number
  at: number
  level: FrontDebugLogLevel
  label: string
  detail?: string
  fields?: FrontDebugLogFields
}

/** Public client-config projection of Telemetry.ClientObservation. */
export interface ClientObservationConfig {
  isEnabled: boolean
  sessionWire: boolean
  videoStreamingInput: boolean
  pageProjectionFrame: boolean
  pageProjectionIntent: boolean
}

export const EMPTY_CLIENT_OBSERVATION: ClientObservationConfig = {
  isEnabled: false,
  sessionWire: true,
  videoStreamingInput: false,
  pageProjectionFrame: false,
  pageProjectionIntent: false,
}

export function parseClientObservation(raw: unknown): ClientObservationConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_CLIENT_OBSERVATION }
  }
  const o = raw as Record<string, unknown>
  return {
    isEnabled: o.isEnabled === true,
    sessionWire: o.sessionWire !== false,
    videoStreamingInput: o.videoStreamingInput === true,
    pageProjectionFrame: o.pageProjectionFrame === true,
    pageProjectionIntent: o.pageProjectionIntent === true,
  }
}

export function describe(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  try {
    return JSON.stringify(value, (_key, raw) =>
      raw instanceof Uint8Array ? `<${raw.byteLength} bytes>` : raw,
    )
  } catch {
    return String(value)
  }
}

/** Merge fields into a serializable detail blob for the feed + export. */
export function formatFrontDebugDetail(
  fields: FrontDebugLogFields | undefined,
  detail?: unknown,
): string | undefined {
  const payload: Record<string, unknown> = {}
  if (fields) {
    const {
      plane,
      hop,
      kind,
      sessionId,
      generation,
      sequence,
      expectedSequence,
      anchor,
      armed,
      remount,
      dropped,
      errorCode,
      phase,
      tClient,
      traceId,
      lagMs,
      extra,
    } = fields
    if (plane) payload.plane = plane
    if (hop) payload.hop = hop
    if (kind) payload.kind = kind
    if (sessionId) payload.sessionId = sessionId
    if (generation != null) payload.generation = generation
    if (sequence != null) payload.sequence = sequence
    if (expectedSequence != null) payload.expectedSequence = expectedSequence
    if (anchor) payload.anchor = anchor
    if (armed != null) payload.armed = armed
    if (remount != null) payload.remount = remount
    if (dropped != null) payload.dropped = dropped
    if (errorCode) payload.errorCode = errorCode
    if (phase) payload.phase = phase
    if (tClient != null) payload.tClient = Math.round(tClient)
    if (traceId) payload.traceId = traceId
    if (lagMs != null) payload.lagMs = Math.round(lagMs)
    if (extra) Object.assign(payload, extra)
  }
  if (detail !== undefined && detail !== null) {
    if (typeof detail === 'object' && !Array.isArray(detail) && !(detail instanceof Error)) {
      Object.assign(payload, detail as Record<string, unknown>)
    } else {
      payload.detail = describe(detail)
    }
  }
  return Object.keys(payload).length > 0 ? describe(payload) : undefined
}

export function observationAllowsPlane(
  observation: ClientObservationConfig,
  plane: FrontDebugPlane | undefined,
): boolean {
  if (!observation.isEnabled) return false
  if (!plane || plane === 'session') return observation.sessionWire
  switch (plane) {
    case 'videoStreamingInput':
      return observation.videoStreamingInput
    case 'pageProjectionFrame':
      return observation.pageProjectionFrame
    case 'pageProjectionIntent':
      return observation.pageProjectionIntent
    default:
      return false
  }
}

/** Export ring as JSONL for offline correlation with Journal facts. */
export function exportFrontDebugJsonl(entries: FrontDebugLogEntry[]): string {
  return entries
    .slice()
    .reverse()
    .map((e) =>
      JSON.stringify({
        id: e.id,
        at: e.at,
        level: e.level,
        label: e.label,
        ...((e.fields ?? {}) as object),
        detail: e.detail,
      }),
    )
    .join('\n')
}
