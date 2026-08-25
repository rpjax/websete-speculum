import type { ConsoleOutputKind, NotificationKind } from './constants'

export interface SessionDeviceProfile {
  mobile?: boolean
  touch?: boolean
  deviceScaleFactor?: number
  maxTouchPoints?: number
  userAgentProfile?: string
  /** Antibot kit: phone | tablet | pc */
  deviceCategory?: 'phone' | 'tablet' | 'pc' | string
  screenOrientation?: string
}

export interface SessionGeolocation {
  latitude: number
  longitude: number
  accuracy: number
}

export interface SessionClientEnvironment {
  locale?: string
  language?: string
  timeZoneId?: string
  colorScheme?: 'light' | 'dark' | 'no-preference'
  /** BCP-47 tags for Accept-Language (soft mimic). */
  languages?: string[]
  geolocation?: SessionGeolocation
}

export interface EnsureProfileRequest {
  profileId?: string | null
}

export interface EnsureProfileResult {
  profileId: string
  created: boolean
}

export interface StartSessionRequest {
  profileId: string
  path?: string
  query?: string
  viewportWidth?: number
  viewportHeight?: number
  device?: SessionDeviceProfile | null
  clientEnvironment?: SessionClientEnvironment | null
}

export interface StartSessionResult {
  sessionId: string
  token: string
  /** Sessions.MirrorMode ack — surface already chosen from client-config. */
  mirrorMode: MirrorMode
}

/** Admin engine Sessions.MirrorMode — read-only on the live session. */
export type MirrorMode = 'videoStreaming' | 'pageProjection'

/**
 * Normalize the wire value when config is not yet operational.
 * When operational, prefer requireOperationalSessionsConfig on client-config.
 */
export function normalizeMirrorMode(value: unknown): MirrorMode {
  return String(value ?? '') === 'pageProjection' ? 'pageProjection' : 'videoStreaming'
}

/** Runtime navigation (hub <c>NavigateAsync</c>) — client path/query, not absolute target. */
export interface NavigateSessionRequest {
  path: string
  query?: string
}

/** Runtime canvas 1:1 resize (hub <c>ResizeAsync</c>). */
export interface ResizeSessionRequest {
  width: number
  height: number
  requestId?: string
  device?: SessionDeviceProfile | null
}

export interface ResizeSessionResult {
  applied: boolean
  width: number
  height: number
  chromeWidth?: number | null
  chromeHeight?: number | null
  displayWidth?: number | null
  displayHeight?: number | null
  resizeId?: string | null
  errorCode?: string | null
  phase?: string | null
  message?: string | null
}

/** Server frame envelope (`Frame` DTO). */
export interface SessionFrame {
  jpeg: Uint8Array
  sequence: number
  timestamp: number
}

/** Compact projected DOM node (`speculum-anchor`). */
export interface DomNode {
  anchor?: string
  tag: string
  attrs?: Record<string, string>
  text?: string
  children?: DomNode[]
}

/** Wire address for Dom-plane ops. */
export interface DomSelector {
  kind: 'element' | 'childAt' | string
  query: string
  index?: number | null
}

export interface CssomSelector {
  kind: 'sheet' | 'rule' | string
  id: string
}

export interface CssomScope {
  kind: 'main' | 'pierceHost' | string
  hostAnchor?: string | null
}

export interface CssomRule {
  id: string
  cssText: string
}

export interface CssomSheet {
  id: string
  scope: CssomScope
  rules: CssomRule[]
}

/** PageProjection outbound unit (Dom or Cssom plane, or an opaque §5.5 V2 binary frame/part). */
export interface PageProjectionFrame {
  sequence: number
  generation: number
  timestamp: number
  /** V1 JSON-body scheme. Empty (with {@link body} present) on the redesigned binary wire. */
  plane: 'dom' | 'cssom' | string
  /** V1 JSON-body scheme. Empty (with {@link body} present) on the redesigned binary wire. */
  operation: string
  /** Opaque §5.5 binary frame/part — never parsed here; relayed straight into `ProjectionClient.ingest`. */
  body?: Uint8Array | ArrayBuffer | number[] | null
  /** Part index within the frame (§5.5.3); 0 when the frame was not split. */
  partIndex?: number
  /** Total part count for the frame (§5.5.3); 1 when the frame was not split. */
  partCount?: number
  /** Bit 0 establish, bit 1 resync (sidecar `mirror/page/encode.ts`). */
  flags?: number
  /** Wire format version (§5.5); an unknown version desyncs (PP-WIRE-2). */
  version?: number
  document?: { root: DomNode } | null
  childList?: {
    selector: DomSelector
    removed: Array<{ selector: DomSelector }>
    added: Array<{ index: number; node: DomNode }>
  } | null
  patch?: { selector: DomSelector; node: DomNode } | null
  scrollViewport?: { scrollX: number; scrollY: number } | null
  scrollElement?: {
    selector: DomSelector
    scrollTop: number
    scrollLeft: number
  } | null
  install?: { sheets: CssomSheet[] } | null
  sheetList?: {
    removed: Array<{ selector: CssomSelector }>
    added: Array<{ index: number; sheet: CssomSheet }>
  } | null
  ruleList?: {
    selector: CssomSelector
    removed: Array<{ selector: CssomSelector }>
    added: Array<{ index: number; rule: CssomRule }>
  } | null
  cssomPatch?: { selector: CssomSelector; rule: CssomRule } | null
}

/** PageProjection unified intent (OS path §10.6). */
export interface PageProjectionIntent {
  generation?: number
  type: string
  /** `speculum-anchor` (V1). Deprecated — kept for the V1 transition; prefer {@link targetId}. */
  anchor?: string | null
  /** Redesigned id-addressed target (§5.11); null for pure motion or V1 anchor addressing. */
  targetId?: number | null
  /** V4 browsing context (root = 1). */
  contextId?: number
  timestampClient?: number | null
  /** Opaque E2E correlation id (always stamped on product send). */
  traceId?: string | null
  payload?: string
  schemaVersion?: number
  viewportW?: number | null
  viewportH?: number | null
  /** Scroll census JSON (PP down/up). */
  census?: string | null
}

export interface EditingState {
  focused?: boolean
  inputMode?: string
  multiline?: boolean
  tagName?: string
}

/** Server console/eval envelope (`ConsoleOutput` DTO). */
export interface SessionConsoleOutput {
  kind: (typeof ConsoleOutputKind)[keyof typeof ConsoleOutputKind]
  level?: number
  text?: string
  requestId?: number
  ok?: boolean
  value?: string
  error?: string
}

/** Server notification envelope (`SessionNotification` DTO). */
export interface SessionNotification {
  kind: (typeof NotificationKind)[keyof typeof NotificationKind]
  url?: string
  editing?: EditingState | null
  errorCode?: string
  message?: string
  phase?: string
  inputKind?: string
  allocationKind?: string
  reason?: string
  domGeneration?: number | null
  domFromGeneration?: number | null
  domAnchor?: string | null
  pageProjectionFramePlane?: string | null
  pageProjectionFrameOperation?: string | null
  pageProjectionFrameSequence?: number | null
  traceId?: string | null
  clientTimestampMs?: number | null
}

/** Unary status response (`SessionStatus` DTO). */
export interface SessionStatus {
  tabCount: number
  url: string
  resizing: boolean
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  chromeWidth: number
  chromeHeight: number
  fps: number
  uptimeMs: number
  sessionId: string
  jsBridgeEnabled: boolean
  editing?: EditingState | null
}

export interface EvalResult {
  requestId: number
  ok: boolean
  value?: string
  error?: string
}

export interface TouchPointInput {
  id: number
  x: number
  y: number
  radiusX?: number
  radiusY?: number
  force?: number
}

/** Interactive input only — navigate/resize/evaluate are not user input. */
export type SessionInput =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button: number }
  | { type: 'mouseup'; x: number; y: number; button: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string }
  | { type: 'keyup'; key: string }
  | { type: 'type'; text: string }
  | { type: 'text'; text: string; source?: string }
  | {
      type: 'touch'
      phase: 'start' | 'move' | 'end' | 'cancel'
      points: TouchPointInput[]
      changedIds: number[]
    }
  | { type: 'goback' }
  | { type: 'goforward' }

/** Optional wire enrichment stamped on every product send (MessagePack top-level). */
export type SessionInputWireMeta = {
  traceId?: string
  clientTimestampMs?: number
}

/**
 * One Journal fact as the API admitted it (`JournalFactHubEvent`).
 * `payload` is the fact body as opaque JSON — parse per `type`/`schemaVersion`.
 */
export interface JournalFact {
  id: string
  publishedAt: string
  type: string
  schemaVersion: number
  publishPolicy: string
  indexKeys: Record<string, string>
  payload?: string
}

export interface JournalStreamObserver {
  next: (fact: JournalFact) => void
  error?: (error: unknown) => void
  complete?: () => void
}

export interface JournalStreamSubscription {
  dispose: () => void
}

export interface SessionEventMap {
  frame: SessionFrame
  pageProjectionFrame: PageProjectionFrame
  /** Wire frame rejected by normalize (legacy shape / invalid plane). */
  pageProjectionFrameRejected: {
    sequence: number | null
    generation: number | null
    plane: string | null
    operation: string | null
    reason: string
  }
  /**
   * Frame unidirectional pipe ended while the data-plane session is still open
   * (fan-out Complete / wire stall) — T8 OOB resync trigger.
   */
  pageProjectionFrameEnded: {
    reason: 'wire_stall'
  }
  console: SessionConsoleOutput
  notification: SessionNotification
  syncUrl: string
  redirect: string
  /** Server ended the live session; local state must clear. */
  ended: SessionEndedEvent
  error: unknown
  close: undefined
}

/** Hub <c>SessionEnded</c> payload. */
export interface SessionEndedEvent {
  sessionId: string
  reason: string
  errorCode?: string
  message?: string
}
