/**
 * Plug-and-play remote browser session contract (V1).
 *
 * The WebSocket / connection handler calls this surface — it is NOT a TS mirror of
 * C# ISessionConnection. Transport, wire codecs, and session registry stay outside.
 *
 * Implementations (injected at composition via {@link BrowserSessionFactory}):
 * - `VideoStreamingBrowserSession` / `PatchrightBrowserSession` — video Live.
 * - `PageProjectionBrowserSession` — sealed PageProjection Live (via createSealedBrowserSessionFactory).
 * - `MockBrowserSession` — tests / SPECULUM_BROWSER=mock.
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

  /**
   * Dom Projection diff (only when MirrorMode is PageProjection).
   * V2 (§5.5 binary wire): `plane`/`operation` are empty strings and the
   * part/flags/version fields describe the opaque `body` frame directly.
   * V1 (JSON wire, pre-cutover): `plane`/`operation` select the payload shape.
   */
  onPageProjectionFrame?(diff: {
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    /** §5.5 — 0-based index of this part within the frame (V2 only). */
    partIndex?: number;
    /** §5.5 — total part count for this frame's `sequence` (V2 only). */
    partCount?: number;
    /** §5.5 — header flags: bit0 establish, bit1 resync (V2 only). */
    flags?: number;
    /** §5.5 — wire format version (V2 only). */
    version?: number;
    /** Browsing context id; root = 1. */
    contextId?: number;
  }): void;

  /**
   * Dom Projection generation identity changed (opt-in Telemetry hop).
   * reason: main_frame_navigated | page_emit_sync
   */
  onPageProjectionGenerationBumped?(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    frameKind?: string;
  }): void;

  onPageProjectionSoftNavObserved?(event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }): void;

  onPageProjectionScrollEchoHit?(event: {
    kind: string;
    generation?: number;
    anchor?: string;
    scrollX?: number;
    scrollY?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }): void;

  /** Pre-warmed browser pool lifecycle (opt-in Telemetry hop). */
  onSessionPoolAcquired?(event: {
    maxWidth: number;
    maxHeight: number;
    poolSize: number;
    waitMs: number;
  }): void;

  onSessionPoolReleased?(event: { heldMs: number }): void;

  /**
   * PageProjection telemetry pushed on the dataplane Telemetry channel (opt-in caps at launch).
   * Off = zero messages.
   */
  onPageProjectionTelemetry?(message: import('@speculum/page-projection/core/telemetry').ProjectionTelemetryMessage): void;

  // page console (side effects of page scripts / evaluate; not the eval return value)
  onConsole(level: number, text: string): void;

  // navigation / session observation
  /** Main-frame http(s) URL changed inside the virtual browser. */
  onLocationChanged(url: string): void;
  /**
   * Allowlist aborted this main-frame navigation; the real client should leave the session
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

  /** Allocation lifecycle (session/display alloc, release, fault) — never on input/frame hot paths. */
  onAllocationLifecycle?(signal: AllocationLifecycleSignal): void;
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
  /** Logical viewport width (px). */
  width: number;
  /** Logical viewport height (px). */
  height: number;
  /** Allocated X display width (px); 0 when no display. */
  displayWidth: number;
  /** Allocated X display height (px); 0 when no display. */
  displayHeight: number;
  /** Chrome render viewport width (px); 0 when browser not open. */
  chromeWidth: number;
  /** Chrome render viewport height (px); 0 when browser not open. */
  chromeHeight: number;
}

export type AllocationLifecycleKind =
  | 'session_allocated'
  | 'session_released'
  | 'display_allocated'
  | 'display_released'
  | 'allocation_faulted';

/** Low-volume allocation lifecycle signal (opt-in journal on API). */
export interface AllocationLifecycleSignal {
  kind: AllocationLifecycleKind;
  displayWidth?: number;
  displayHeight?: number;
  logicalWidth?: number;
  logicalHeight?: number;
  inputBackend?: 'os' | 'patchright';
  errorCode?: string;
  phase?: string;
  reason?: string;
}

/**
 * Session-local operational telemetry that stays inside the sidecar process and is sampled
 * only by the sidecar telemetry collector.
 */
export interface BrowserTelemetrySnapshot {
  inputPendingCount?: number;
  inputChainDepth?: number;
  displayAllocated?: boolean;
  displayWidth?: number;
  displayHeight?: number;
  logicalWidth?: number;
  logicalHeight?: number;
  chromeWidth?: number;
  chromeHeight?: number;
  inputBackend?: 'os' | 'patchright';
  touchPrimary?: boolean;
  userDataDirPresent?: boolean;
}

// ── Launch / device / scripts ────────────────────────────────────────────────

export interface BrowserLaunchOptions {
  width: number;
  height: number;
  /** Sessions.ViewportPolicy bounds from Launch — required for allocate + validate. */
  viewportPolicy: {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  };
  /** Sessions.ScreencastPolicy.MaxEncodeScale (1..2). */
  screencastMaxEncodeScale: number;
  /** Sessions.MirrorMode from Launch (admin engine config). */
  mirrorMode: 'videoStreaming' | 'pageProjection';
  /** Sessions.frameQueueCapacity — EventBridge Dom queue depth. */
  frameQueueCapacity: number;
  /** Sessions.PageProjection.FrameRateHz (§5.3.4) — PageProjectionEngine top clock rate. */
  frameRateHz?: number;
  /**
   * PageProjection in-page telemetry caps, injected at boot (`__SPECULUM_PROJECTION__`).
   * Default off (zero cost). Lab composition typically passes {@link LAB_TELEMETRY_DEFAULTS}.
   */
  projectionTelemetry?: Partial<
    import('@speculum/page-projection/core/telemetry').ProjectionTelemetryConfig
  >;
  /** When false, {@link BrowserSession.startCpuProfile} must not enable CDP Profiler. */
  cpuProfiling?: boolean;
  /**
   * PageProjection Virtual→sidecar data plane.
   * Carrier = loopback WebSocket opened by Speculum Plane extension (not page-origin).
   * Only `'loopback'` is accepted; omit or set `'loopback'`.
   */
  projectionDataPlane?: 'loopback';
  /** Sessions.PageProjection.MaxFrameBytes (§5.3.5.5) — one wire message cap before splitting. */
  maxFrameBytes?: number;
  /** Sessions.PageProjection.BrowserPoolSize (§5.13, WP13) — 0 disables the pre-warm pool. */
  browserPoolSize?: number;
  /** Sessions.PageProjection.BrowserPoolRefillPerSec (§5.13). */
  browserPoolRefillPerSec?: number;
  /** §5.6.3 establish HTML chunk byte budget. */
  establishChunkBytes?: number;
  frameRateLadder?: number[];
  hiddenRateHz?: number;
  rateRecoverMs?: number;
  frameStallMs?: number;
  mirrorMaxBytes?: number;
  assetCacheL1MaxBytes?: number;
  assetCacheL2MaxBytes?: number;
  assetCacheL2Enabled?: boolean;
  assetPriorityViewportPx?: number;
  aggregateIntervalMs?: number;
  locale: string;
  language: string;
  timeZoneId: string;
  colorScheme: BrowserColorScheme;
  geolocation?: BrowserGeolocation;
  device?: BrowserDeviceProfile;
  scripts?: readonly BrowserScriptInjection[];
  /** Main-frame allowlist; matching and block notify are internal to the session. */
  allowedNavigationDomains?: readonly string[];
  /** Immutable URL resolution policy injected at Launch (motor-migration M1). */
  navigationPolicy?: import('./navigation/navigationPolicy').NavigationPolicy;
}

export interface BrowserGeolocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type BrowserColorScheme = 'light' | 'dark' | 'no-preference';

export interface BrowserDeviceProfile {
  mobile?: boolean;
  touch?: boolean;
  deviceScaleFactor?: number;
  maxTouchPoints?: number;
  userAgentProfile?: string;
  /** Antibot kit: phone | tablet | pc (preferred over userAgentProfile aliases). */
  deviceCategory?: string;
  screenOrientation?: string;
}

export interface BrowserScriptInjection {
  type: string;
  file: string;
  /** Inline JS for stored scripts; empty when remoteUrl is set. */
  content: string;
  /** Absolute http(s) URL — sidecar fetches and inlines into CDP bundle. */
  remoteUrl?: string;
  targetRules?: BrowserUrlMatchRule[];
}

export interface BrowserUrlMatchRule {
  domain: BrowserDomainPattern;
  path: BrowserPathPattern;
}

export interface BrowserDomainPattern {
  scope: string;
  labels: BrowserLabelPattern[];
}

export interface BrowserPathPattern {
  scope: string;
  matchType: string;
  segments: BrowserLabelPattern[];
}

export interface BrowserLabelPattern {
  match: string;
  value: string;
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

/** Cookie sanitize + optional CDP apply counts from {@link BrowserSession.restoreState}. */
export interface CookieNormalizeStats {
  total: number;
  skipped: number;
  normalized: number;
  applied: number;
  failedIndividual: number;
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
  /** Sessions.ScreencastPolicy.MaxEncodeScale when provided on resize. */
  screencastMaxEncodeScale?: number;
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
 * One live browser session (Chrome instance + display for a Speculum session).
 *
 * Lifecycle expected by the connection handler:
 *   launch → restoreState? → navigate? → (resize | input | probe | …) → exportState? → stop → dispose
 *
 * History (goback/goforward) travels through {@link pushInput} as non-blocking
 * navigation; pointer/key/touch are fire-and-forget CDP Input.* events.
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
  getTelemetrySnapshot?(): BrowserTelemetrySnapshot;

  restoreState(state: BrowserState): Promise<CookieNormalizeStats>;
  exportState(): Promise<BrowserState>;

  navigate(url: string): Promise<void>;
  /** Resolve client path/query via Launch NavigationPolicy, then navigate. */
  navigateClient?(path: string, query: string): Promise<void>;
  refresh(): Promise<void>;
  /** History — core (not {@link pushInput}). */
  goBack(): Promise<void>;
  goForward(): Promise<void>;

  resize(request: BrowserResizeRequest): Promise<BrowserResizeResult>;
  probe(request: BrowserProbeRequest): Promise<BrowserProbeResult>;

  /**
   * Run JS in the page and return the value. No wire correlation id — callers above
   * map id ↔ result. Page `console.*` side effects surface via {@link BrowserSessionEvents.onConsole}.
   */
  evaluate(code: string): Promise<BrowserEvalResult>;

  /**
   * Pointer / keyboard / wheel / touch / text / history.
   * Input.* CDP is fire-and-forget; history does not block other input.
   * Validation and product policy live above this port.
   */
  pushInput(input: BrowserInput): Promise<void>;


  /** Sealed PP lab clocks (all contexts). */
  haltClocks?(): Promise<{ ok: boolean; reason?: string }>;
  resumeClocks?(): Promise<{ ok: boolean; reason?: string }>;
  emitFrame?(contextId?: number): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    reason?: string;
  }>;
  getStateSnapshot?(
    contextId: number,
    opts?: import('./contracts').StateSnapshotOpts,
  ): Promise<import('./contracts').StateSnapshotResult>;
  requestResync?(request?: { contextId?: number; reason?: string }): Promise<void>;


  /** Dom Projection virtual resource by path key / blob / data id. */
  getDomAsset?(
    key: string,
    opts?: { kind?: string; rangeHeader?: string },
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    statusCode?: number;
    contentRange?: string;
    passThrough?: boolean;
    /**
     * §5.12.2.1 shareability signals — only populated for a fresh, non-pass-through
     * "asset" fetch; the API's SharedAssetCacheL2 predicate reads these before
     * deciding whether the body may be dedup-served host-wide.
     */
    requestHadCookie?: boolean;
    requestHadAuthorization?: boolean;
    cacheControl?: string;
    vary?: string;
  } | null>;


  putDomUpload?(id: string, body: Uint8Array, contentType: string, name: string): Promise<void>;

  startCpuProfile?(): Promise<{ ok: boolean; reason?: string }>;
  stopCpuProfile?(): Promise<{
    ok: boolean;
    summary?: {
      totalSamples: number;
      wallMs: number;
      approxCpuMs: number;
      ourCode: { totalPct: number; totalMs: number };
    };
    profileBytes?: Uint8Array;
    reason?: string;
  }>;
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
