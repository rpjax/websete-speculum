/**
 * Plug-and-play remote browser session contract (V1).
 *
 * The WebSocket / connection handler calls this surface — it is NOT a TS mirror of
 * C# ISessionConnection. Transport, wire codecs, and session registry stay outside.
 *
 * Implementations (Patchright+Xvfb, headless mock, …) are injected at composition time
 * via {@link BrowserSessionFactory}.
 *
 * V1 rules:
 * - Outbound media/observation only via {@link BrowserSessionEvents}.
 * - Main-frame allowlist lives in {@link BrowserLaunchOptions}; block notify is
 *   {@link BrowserSessionEvents.onMainFrameNavigationBlocked}.
 * - JsBridge / Diagnostics gating live above this port (API). Console stream and
 *   {@link BrowserSession.evaluate} are always session capabilities.
 * - Session snapshot is pull: {@link BrowserSession.getStatus}. The API polls when/if needed.
 * - Editable focus (client native keyboard / IME) is push:
 *   {@link BrowserSessionEvents.onEditableFocusChanged}.
 * - Single-tab enforcement is internal (visible via {@link BrowserStatus.tabCount}).
 * - Audio out + camera/mic in are on the contract for facial-validation paths;
 *   payloads may stay opaque until codecs are fixed.
 */

// ── Events (session → connection handler) ────────────────────────────────────

/** Page permission decision returned by the connection handler / API policy. */
export type BrowserPermissionDecision = 'allow' | 'deny';

/**
 * Editable focus inside the virtual page — enough for the real client to show/hide
 * the native keyboard (IME). Null means blur / dismiss.
 */
export interface BrowserEditingState {
  inputMode?: string;
  multiline?: boolean;
  tagName?: string;
}

/** Outbound signals from a live browser session. No WebSocket types here. */
export interface BrowserSessionEvents {
  // media out
  onVideoFrame(jpeg: Uint8Array): void;
  onAudioFrame(chunk: Uint8Array): void;

  // page console (side effects of page scripts / evaluate; not the eval return value)
  onConsole(level: number, text: string): void;

  // navigation / session observation
  /** Main-frame http(s) URL changed inside the virtual browser. */
  onLocationChanged(url: string): void;
  /**
   * Allowlist aborted this main-frame navigation; the real client should leave Motor
   * to this absolute URL. Session stays alive. Browser already failed the request.
   */
  onMainFrameNavigationBlocked(url: string): void;

  /**
   * Editable focus in the virtual page changed. Consumers may relay this so the
   * real client can show/hide the native keyboard (IME). Null = blur / dismiss.
   */
  onEditableFocusChanged(editing: BrowserEditingState | null): void;

  // permission gates (page getUserMedia → policy above)
  onCameraPermissionRequested(): Promise<BrowserPermissionDecision>;
  onMicrophonePermissionRequested(): Promise<BrowserPermissionDecision>;

  /** Unrecoverable fault; subsequent {@link BrowserSession.getStatus} reports isOpen false. */
  onCrash(fault: BrowserFault): void;
}

export interface BrowserFault {
  errorCode: string;
  message: string;
  phase?: string;
}

export interface BrowserEvalResult {
  ok: boolean;
  /** JSON-serialized or stringified return value when ok. */
  value: string;
  errorMessage?: string;
}

/**
 * Pull snapshot of the live browser. No editing field — that is push via
 * {@link BrowserSessionEvents.onEditableFocusChanged}. fps/uptime/session labels are API-side.
 */
export interface BrowserStatus {
  /** False after stop/dispose or an unrecoverable crash. */
  isOpen: boolean;
  tabCount: number;
  url: string;
  resizing: boolean;
  width: number;
  height: number;
}

// ── Launch / device / scripts ────────────────────────────────────────────────

export interface BrowserLaunchOptions {
  width: number;
  height: number;
  device?: BrowserDeviceProfile;
  scripts?: readonly BrowserScriptInjection[];
  /** Main-frame allowlist; matching and block notify are internal to the session. */
  allowedNavigationDomains?: readonly string[];
}

export interface BrowserDeviceProfile {
  mobile?: boolean;
  touch?: boolean;
  deviceScaleFactor?: number;
  maxTouchPoints?: number;
  userAgentProfile?: string;
  screenOrientation?: string;
}

export interface BrowserScriptInjection {
  position: string;
  type: string;
  file: string;
  content: string;
}

export interface BrowserReadyInfo {
  width: number;
  height: number;
}

// ── Durable state ────────────────────────────────────────────────────────────

export interface BrowserState {
  cookies: readonly BrowserCookieState[];
  localStorage: readonly BrowserLocalStorageState[];
  idbRecords: readonly BrowserIdbRecordState[];
  history: readonly BrowserHistoryState[];
}

export interface BrowserCookieState {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface BrowserLocalStorageState {
  origin: string;
  key: string;
  value: string;
}

export interface BrowserIdbRecordState {
  origin: string;
  databaseName: string;
  storeName: string;
  keyJson: string;
  valueJson: string;
}

export interface BrowserHistoryState {
  url: string;
  title?: string;
  visitedAtMs?: number;
  transitionType?: string;
  indexOrder?: number;
}

// ── Resize / probe ───────────────────────────────────────────────────────────

export interface BrowserResizeRequest {
  width: number;
  height: number;
  device?: BrowserDeviceProfile;
}

export interface BrowserResizeResult {
  ok: boolean;
  width: number;
  height: number;
  chromeWidth?: number;
  chromeHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  errorCode?: string;
  phase?: string;
  message?: string;
}

/** Evidence collection request (cookies/tabs/DOM/…). Gating / budgets live above this port. */
export interface BrowserProbeRequest {
  ops: readonly string[];
  evaluateExpression?: string;
  domSelector?: string;
}

export interface BrowserProbeResult {
  ok: boolean;
  /** Opaque evidence sections when ok. */
  data?: unknown;
  errorCode?: string;
  message?: string;
}

// ── User input (pointer / keys / history — not navigate/resize/eval) ──────────

export interface BrowserTouchPoint {
  id: number;
  x: number;
  y: number;
  radiusX?: number;
  radiusY?: number;
  force?: number;
}

/**
 * Interactive input only. Navigation, refresh, resize and evaluate are
 * {@link BrowserSession} methods — they must not travel through {@link BrowserSession.pushInput}.
 */
export type BrowserInput =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button: number }
  | { type: 'mouseup'; x: number; y: number; button: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string }
  | { type: 'keyup'; key: string }
  | { type: 'type'; text: string }
  | { type: 'text'; text: string; source?: string }
  | {
      type: 'touch';
      phase: 'start' | 'move' | 'end' | 'cancel';
      points: readonly BrowserTouchPoint[];
      changedIds: readonly number[];
    }
  | { type: 'goback' }
  | { type: 'goforward' };

// ── Contract ─────────────────────────────────────────────────────────────────

/**
 * One live browser session (Chrome instance + display for a Motor session).
 *
 * Lifecycle expected by the connection handler:
 *   launch → restoreState? → navigate? → (resize | input | probe | …) → exportState? → stop → dispose
 *
 * History (goback/goforward) and pointer/key events travel through {@link pushInput}.
 */
export interface BrowserSession {
  readonly sessionId: string;

  launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo>;

  /** Tear down Chrome/display but keep the instance identity until {@link dispose}. */
  stop(): Promise<void>;

  /** Idempotent final cleanup. */
  dispose(): Promise<void>;

  /**
   * Pull live snapshot (open/tabs/url/viewport/resizing). The API polls when/if needed;
   * this session does not push periodic status.
   */
  getStatus(): Promise<BrowserStatus>;

  restoreState(state: BrowserState): Promise<void>;
  exportState(): Promise<BrowserState>;

  navigate(url: string): Promise<void>;
  refresh(): Promise<void>;

  resize(request: BrowserResizeRequest): Promise<BrowserResizeResult>;
  probe(request: BrowserProbeRequest): Promise<BrowserProbeResult>;

  /**
   * Run JS in the page and return the value. No wire correlation id — callers above
   * map id ↔ result. Page `console.*` side effects surface via {@link BrowserSessionEvents.onConsole}.
   */
  evaluate(code: string): Promise<BrowserEvalResult>;

  /**
   * Pointer / keyboard / wheel / touch / text / history.
   * Validation and product policy live above this port.
   */
  pushInput(input: BrowserInput): Promise<void>;

  /** Client camera frame → virtual browser capture / getUserMedia path. */
  pushCameraFrame(frame: Uint8Array): Promise<void>;

  /** Client microphone chunk → virtual browser audio input path. */
  pushMicrophoneAudio(chunk: Uint8Array): Promise<void>;
}

/**
 * Creates {@link BrowserSession} instances. Injected at the composition root so the
 * connection host does not hard-depend on Patchright/Xvfb.
 */
export interface BrowserSessionFactory {
  create(sessionId: string, events: BrowserSessionEvents): BrowserSession;
}
