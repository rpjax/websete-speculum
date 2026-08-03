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
  /** Sessions.ViewportPolicy — sole client bounds for resize validation after start. */
  viewportMinWidth: number
  viewportMinHeight: number
  viewportMaxWidth: number
  viewportMaxHeight: number
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
