# BrowserSession contracts by mirror mode

**Status:** **SEALED 2026-08-21** — normative session / mirror-mode contract.  
**Date sealed:** 2026-08-21 (Rodrigo). **Shape cutover impl:** same day (factory + PP class + wire).  
**Context:** PageProjection is primary; video streaming stays as **fallback**. Product still V1 → **breaking OK**, no compat shims.  
**Scratchpad (non-normative):** [../CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md) — shape done; product leftovers listed.  
**Impl ports:** `sidecar/browser/contracts/` · `PageProjectionBrowserSession.ts` · `VideoStreamingBrowserSession.ts` · `createSealedBrowserSessionFactory.ts` · wire `proto/browser_session.proto`  
**Fat port (legacy callers mid-migrate):** `sidecar/browser/BrowserSession.ts`  
**Proposal provenance:** [../proposals/browser-session-mirror-contract.md](../proposals/browser-session-mirror-contract.md) (pointer only).

**Naming (LOCKED):** .NET-style — interfaces `I…`, classes without `I`.  
**PP class name (LOCKED):** `PageProjectionBrowserSession`.

**Data plane (LOCKED 2026-08-26, amended 2026-08-27):** Virtual↔sidecar carrier = **loopback WebSocket** (`projectionDataPlane: 'loopback'`). On managed Chrome the socket is opened by the **Speculum Plane extension** ([extension-plane.md](extension-plane.md)); the page does not use `new WebSocket` for the data plane. CDP `exposeBinding` plane purged.

**Loopback establishment (LOCKED 2026-08-27):** TCP `OPEN` ≠ ready. Both sides **`await establishConnection()`** / **`waitEstablished(generation)`** after handshake (`hello` / `hello-ack`). One canonical socket per `(sessionId, generation)`; ghost WS forbidden. Full protocol: [loopback.md](loopback.md). Tracker: [open.md](open.md) PP-LOOPBACK-ESTABLISH.

**Single tab (LOCKED 2026-08-27):** **One Chromium page per session — always.** Sidecar **forbids** a second tab. `window.open` / `target=_blank` / `_new` on the site must become a **same-tab redirect** (`location` on the primary page). If Chromium still allocates a page, the session **closes it immediately** and adopts the http(s) URL on the primary (`page.goto`, not a new tab). Implementation: unified CDP inject bundle (`inject/projectionRuntimeInstaller.ts`) + `session/singleTab.ts` adoption net · [csp.md](csp.md) · [open.md](open.md) PP-CSP-SINGLE-TAB.

**Runtime inject / boot (LOCKED 2026-08-28):** Virtual producer + optional `scripts` launch payloads = **CDP-only** — single bundle per browsing-context target via `Page.addScriptToEvaluateOnNewDocument` (main + OOPIF frame CDP). **No** HTML `<script>` tag inject. Document Response hook = CSP surgery only. Sentinel scrub removes inject `<script>` orphans from the live DOM (`bootstrap.ts` + bundle prelude).

**Boot contract (same seal):**
- **Happy path:** `onNewDocument` on each CDP target (page + OOPIF). Virtual runs in the page **main world** (not Patchright isolate).
- **Idempotency:** sync inject arm (`__SPECULUM_PP_INJECT_ARMED__` / generation) wraps the bundle in an IIFE — second evaluate on the same heap is a no-op (top-level `return` is illegal in CDP scripts; arm must be inside a function).
- **lateBoot:** miss-detect only — main-world probe (`projection` / boot promise / arm); settle before inject on navigate/frame; coalesce in-flight; **fail-closed** if probe is `null`; **one attempt** per `(frame, generation, url)` token. Never probe/inject via Patchright default isolate for product decisions.
- **Not claimed:** a single CDP register covering every OOPIF forever without per-target attach; pause-until-register OOPIF (future harden). Document already live when registering still needs lateBoot.

**Launch / custom scripts (LOCKED 2026-08-28):** Session `scripts` on launch are **operator-configured** injections (stored content or remote URL), not the Virtual producer.

| Rule | Law |
|------|-----|
| Carrier | **Same CDP bundle** as the projection runtime (`ProjectionRuntimeInstaller` / `buildProjectionInjectBundle`). No HTML `<script>` tags; Document Response hook does not fulfill scripts. |
| Snapshot | Resolved at session Start (`LaunchScriptResolver`): stored → inline `content`; remote → `remoteUrl` (sidecar **fetches** bytes and inlines into the bundle). |
| Targets | Registered on **every** CDP browsing-context target (page + OOPIF), same as Virtual. |
| URL gate | Each script runs only when `TargetRules` match `location.href`. **≥1 rule required** at config validate / resolve; empty rules = **never** run (match-all must be explicit Any/Any). |
| Bundle order | Prelude (scrub / CSP meta / config / plane shim / single-tab) → **`virtual.js`** → custom scripts. Customs never precede Virtual boot. |
| Isolation | **One IIFE + `try/catch` per custom script.** A broken custom must not abort siblings or the producer. Module: `import(…).catch(…)`. |
| Classic / Module | `type` / `ExecutionType` on the DTO. |
| **Position** | **Removed** from config, session DTO, and wire. CDP timing is document-start (`onNewDocument` / lateBoot), not Head/Body HTML slots. |

Impl: `inject/resolveLaunchScripts.ts` · `inject/buildProjectionInjectBundle.ts` · `proto/browser_session.proto` `ScriptInjection`.

---

## 1. Problem

One fat session port mixed logical viewport, Xvfb/screencast, and projection APIs (optional `?`). Wrong-mode noise; opaque / optional bags (`display*?`, shared telemetry) force gRPC/.NET into the same mush.

---

## 2. Goals

- **Explicit contracts:** `IBrowserSession` (shared ops) + `IPageProjectionBrowserSession` + `IVideoStreamingBrowserSession`.  
- **Shared class:** `BrowserSession` for Chromium/CSP/navigate/viewport impl — not a shared “polymorphic” status/telemetry API.  
- **PP thin:** viewport/device + projection I/O. **No** screen emulation.  
- **Video owns** display, screencast encode (launch-only), and **video egress** (JPEG + tab audio).  
- **Cam/mic ingress** (client → Virtual) exists on **both** mirror modes.  
- **Streams are first-class:** each mode is a **session + sink pair**; typed payloads (PP frames ≠ JPEG ≠ audio). No shared `BrowserSessionEvents` god bag.  
- **Bespoke methods + bespoke DTOs per contract** — no covariance, **no `oneof` bags** on the wire.  
- **PP lab methods** live on the same `IPageProjectionBrowserSession` (documented lab/assert; Live does not call). No separate diagnostics facade.  
- Breaking once; Api + sidecar + web + MotorAssert same wave.

## 3. Non-goals

- Soft-deprecation / dual field names.  
- DomInput / frame-protocol redesign (separate).  
- Killing video.  
- Proto `oneof` as a substitute for separate RPCs/messages.

---

## 4. Recommendation (summary)

| Choice | Decision |
|--------|----------|
| Core | `IBrowserSession` / class `BrowserSession` — **shared ops only** (stop, navigate, refresh, goBack/goForward, resize viewport, cookies, eval, probe, cam/mic ingress, CDP CPU profile) |
| PP / Video | Own interfaces with **own** `launch` / `getStatus` / `getTelemetrySnapshot` (+ mode-only APIs) |
| Wire | **Distinct RPCs + messages per contract** — not one Launch/Status with `oneof` |
| PP methods | Required on PP interface |
| PP launch | Pruned to V4/PP-real knobs |
| Telemetry | Complete **named** DTOs on each mode interface |
| `viewportPolicy` | Logical clamp; video launch also has explicit `displayWidth`/`displayHeight` |
| Encode | Video launch-only; off Resize |
| Streams | **Session↔sink pair per mode** — PP `onFrame(PageProjectionFrame)` incl. `contextId`; video JPEG + audio out; shared observation on core sink |
| Cam/mic | Ingress on core session; **browser permission** = RPC host `requestPermission(kind)` (session asks Api, awaits decision) — not a sink |
| PP lab/assert | Same `IPageProjectionBrowserSession`: `haltClocks` / `resumeClocks` / `emitFrame` / `getStateSnapshot` (Live does not call) |

```text
                 IBrowserSession
            (shared ops; no launch / status / telemetry)
                  /            \
 IPageProjectionBrowserSession   IVideoStreamingBrowserSession

 Factory create*(id, sink, permissions):
   binds mode sink (push) + IBrowserPermissionHost (RPC) privately
```

---

## 5. TypeScript contracts

### 5.0 Streams / sinks (session → Api)

Outbound observation and media are **push** into a sink (one-way). Each mirror mode is a **pair**: session + sink. Factory binds that pair.

Permission for camera/mic is **not** a sink: the session asks the Api and **awaits a decision** (RPC / request-response). That lives on a separate host passed at create — see §5.0b.

| Pair | Session (commands / ingress) | Sink (egress / observation) |
|------|------------------------------|-----------------------------|
| PP | `IPageProjectionBrowserSession` | `IPageProjectionSessionSink` |
| Video | `IVideoStreamingBrowserSession` | `IVideoStreamingSessionSink` |

```ts
/**
 * Shared observation — both modes.
 * No projection frames, no screencast JPEG/audio here.
 * No request/response RPCs here (those are hosts).
 */
interface IBrowserSessionSink {
  onConsole(level: number, text: string): void;
  onLocationChanged(url: string): void;
  onMainFrameNavigationBlocked(url: string): void;
  onEditableFocusChanged(editing: BrowserEditingState | null): void;
  onCrash(fault: BrowserFault): void;
  /** Session id reserved / torn down in the registry (journal). Not Xvfb. */
  onSessionAllocated(): void;
  onSessionReleased(): void;
}

/**
 * One projection frame unit delivered to the Api (wire header fields + opaque body).
 * Aligns with frame-protocol / OPEN-6: contextId is this algorithm instance’s mine (root = 1).
 * Part fields are set when the producer splits a frame across messages.
 */
interface PageProjectionFrame {
  contextId: number;
  sequence: number;
  generation: number;
  body: Uint8Array;
  timestampMs: number;
  partIndex?: number;
  partCount?: number;
  /** Wire flags — bit1 = resync (establish bit is dead / unused). */
  flags?: number;
  version?: number;
}

interface IPageProjectionSessionSink extends IBrowserSessionSink {
  /** Live projection stream. */
  onFrame(frame: PageProjectionFrame): void;
  /** In-page producer telemetry (opt-in at launch). */
  onProjectionTelemetry(message: ProjectionTelemetryMessage): void;
}

interface IVideoStreamingSessionSink extends IBrowserSessionSink {
  onVideoFrame(jpeg: Uint8Array): void;
  onAudioFrame(chunk: Uint8Array): void;
  onDisplayAllocated(dims: { width: number; height: number }): void;
  onDisplayReleased(): void;
  onAllocationFaulted(signal: { errorCode?: string; phase?: string; reason?: string }): void;
}
```

**V4 PP sink is only** `onFrame` + `onProjectionTelemetry` (+ shared observation).  
**Not in this contract** (pre-V4 LivePageProjection bags — do not reintroduce as god callbacks):  
`onPageProjectionDiff` (plane/operation), `onPageProjectionGenerationBumped`, `onPageProjectionSoftNavObserved`, `onPageProjectionScrollEchoHit`, `onPageProjectionParity`. If Live later needs any of those signals, add **named** typed sink methods with a real product caller — not the old optional bags.

**What was `onAllocationLifecycle?`**  
Today a single optional callback with a `kind` bag. Redesign splits it:
- **Both modes:** `onSessionAllocated` / `onSessionReleased` on `IBrowserSessionSink`.
- **Video only:** `onDisplayAllocated` / `onDisplayReleased` / `onAllocationFaulted` on `IVideoStreamingSessionSink`.

No `onVideoFrame` on the PP sink. No `onFrame` on the video sink.

### 5.0b Browser permission host (session → Api → decision)

Sink = push. Permission = **RPC**: Virtual needs the client/Api to grant or deny before a browser permission prompt proceeds. Both mirror modes. One method, kinded — matches wire `PermissionKind` / `PermissionRequest` / `PermissionReply` (today camera + microphone; more kinds later without new host methods).

```ts
/** Extensible; wire enum grows with this. */
type BrowserPermissionKind = 'camera' | 'microphone';

/**
 * Api implements this. Session calls and awaits.
 * Not a sink — return value is load-bearing.
 */
interface IBrowserPermissionHost {
  requestPermission(kind: BrowserPermissionKind): Promise<BrowserPermissionDecision>;
}

/** Grant / deny / … — exact enum sealed with wire `PermissionReply`. */
type BrowserPermissionDecision = 'granted' | 'denied';
```

Wire: Control bidi already carries a single request/reply with `kind`. Same host for PP and video create.

### 5.1 Core — `IBrowserSession` / `BrowserSession`

No `launch`, no `getStatus`, no `getTelemetrySnapshot`, no mode streams here.

Types referenced but owned elsewhere (cookie/state, probe, device, scripts, faults, …) are not redefined in this proposal — seal with existing sidecar/Api modules.

```ts
interface ViewportPolicyBounds {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface BrowserResizeRequest {
  width: number;
  height: number;
  device?: BrowserDeviceProfile;
}

interface BrowserResizeResult {
  ok: boolean;
  width: number;
  height: number;
  chromeWidth?: number;
  chromeHeight?: number;
  errorCode?: string;
  phase?: string;
  message?: string;
}

interface BrowserReadyInfo {
  width: number;
  height: number;
}

interface BrowserLaunchOptionsBase {
  width: number;
  height: number;
  /** Logical viewport clamp — not Xvfb capacity. */
  viewportPolicy: ViewportPolicyBounds;
  locale: string;
  language: string;
  timeZoneId: string;
  colorScheme: BrowserColorScheme;
  geolocation?: BrowserGeolocation;
  device?: BrowserDeviceProfile;
  scripts?: readonly BrowserScriptInjection[];
  allowedNavigationDomains?: readonly string[];
  /**
   * When true, {@link IBrowserSession.startCpuProfile} / {@link IBrowserSession.stopCpuProfile}
   * may use CDP Profiler on the Virtual Chromium. Default false.
   */
  cpuProfiling?: boolean;
}

interface StopCpuProfileResult {
  ok: boolean;
  reason?: string;
  summary?: {
    totalSamples: number;
    wallMs: number;
    approxCpuMs: number;
    ourCode: { totalPct: number; totalMs: number };
  };
  /** Opaque CDP profile JSON bytes (lab/dossier). */
  profileBytes?: Uint8Array;
}

interface IBrowserSession {
  readonly sessionId: string;

  stop(): Promise<void>;
  dispose(): Promise<void>;

  restoreState(state: BrowserState): Promise<CookieNormalizeStats>;
  exportState(): Promise<BrowserState>;

  navigate(url: string): Promise<void>;
  refresh(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;

  resize(request: BrowserResizeRequest): Promise<BrowserResizeResult>;
  probe(request: BrowserProbeRequest): Promise<BrowserProbeResult>;
  evaluate(code: string): Promise<BrowserEvalResult>;

  /** Client → Virtual capture ingress — both mirror modes. */
  pushCameraFrame(frame: Uint8Array): Promise<void>;
  pushMicrophoneAudio(chunk: Uint8Array): Promise<void>;

  /**
   * CDP CPU profile on the Virtual Chromium (process/renderer) — both mirror modes.
   * Not per OPEN-6 context. Requires {@link BrowserLaunchOptionsBase.cpuProfiling} at launch.
   * Lab/assert / capacity investigation; Live product need not call.
   */
  startCpuProfile(): Promise<{ ok: boolean; reason?: string }>;
  stopCpuProfile(): Promise<StopCpuProfileResult>;
}

abstract class BrowserSession implements IBrowserSession {
  // Chromium, CSP, scripts, navigate, viewport validate/apply, cookies…
}
```

### 5.2 PageProjection — one interface

Lab/assert methods (`haltClocks`, `resumeClocks`, `emitFrame`, `getStateSnapshot`) are on the **same** `IPageProjectionBrowserSession` as Live product methods. Audience is call discipline + docs, not a nested facade (`diagnostics()` returning `this` was dropped).

If Api code ever needs a compile-time firewall, use a local `Pick`/`Omit` view — not a second session type.

```ts
interface PageProjectionLaunchOptions extends BrowserLaunchOptionsBase {
  frameRateHz: number;
  maxFrameBytes?: number;
  projectionTelemetry?: Partial<ProjectionTelemetryConfig>;
  /** Bound on session→Api frame queue (was pageProjectionDiffQueueCapacity — “diff” is dead vocab). */
  frameQueueCapacity: number;
  browserPoolSize?: number;
  browserPoolRefillPerSec?: number;
}

interface PageProjectionStatus {
  isOpen: boolean;
  tabCount: number;
  url: string;
  resizing: boolean;
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
  // No generation here — see PageProjectionTelemetrySnapshot.
}

interface PageProjectionTelemetrySnapshot {
  /** OPEN-6 context this sample describes (root = 1). */
  contextId: number;
  logicalWidth: number;
  logicalHeight: number;
  chromeWidth: number;
  chromeHeight: number;
  dataPlaneListening: boolean;
  generation: number;
  sequence: number;
  producerHalted: boolean;
  frameQueueDepth: number;
  inputPendingCount: number;
}

/**
 * Input V2 ingress (id-addressed). No legacy anchor / targetId / payloadJson aliases on this contract.
 * Full schema lives in page-projection input types; this is the session port shape.
 */
interface DomInputIngress {
  type: string;
  nodeId: number;
  /** OPEN-6 browsing context (default root = 1). */
  contextId?: number;
  generation?: number;
  timestampClient?: number;
  payload?: string;
}

/**
 * Mid-session resync request. Matches lab/Control today: which context + optional diag reason.
 * No generation/sequence watermark — producer always re-describes current truth (emitResyncFrame).
 */
interface PageProjectionResyncRequest {
  /** Which Virtual instance should emit (OPEN-6). Omit / default = root `1`. */
  contextId?: number;
  /** Diagnostic / journal only — not load-bearing for construction. */
  reason?: string;
}

/**
 * Which Virtual state planes to capture in the coherent snapshot turn.
 *
 * **Defaults (cheap):** `table: 'digest'`; every other face off → `null` on the result.
 * Lab iso opts in explicitly (`table: 'full'`, `liveChildOrder: true`, `formProps: true`, …).
 *
 * **Invariant:** `liveChildOrder: true` requires `table: 'full'` (offline table×DOM needs both
 * planes from the same turn). Impl may coerce `table` to `'full'` or fail the snapshot.
 */
interface StateSnapshotOpts {
  /**
   * Replicated DOM table plane.
   * - `digest` (default): `{ rowCount, tableHash }` only.
   * - `full`: digest + rows/links enough for offline table×DOM.
   */
  table?: 'digest' | 'full';
  /**
   * Live Virtual child-order topology at S (`parentId → childIds` in `childNodes` order).
   * Paired with `table: 'full'` for offline table×DOM. Not the structural attribute tree.
   */
  liveChildOrder?: boolean;
  /**
   * CSSOM planes at S: replicated Sheet/Rule table + live readable `cssRules`.
   * `none` (default) = omit. `committed` / `scan` = how Virtual refreshes before dump — not a verdict.
   */
  cssom?: 'none' | 'committed' | 'scan';
  /**
   * Structural Virtual tree (tag/attr/text/ns) for tree×tree vs Projected.
   * Independent of {@link liveChildOrder}; does **not** include live form properties.
   */
  tree?: boolean;
  /** Live form control properties (`value` / `checked` / `selected`) — PP-PROP-1 material. */
  formProps?: boolean;
  /**
   * NODE_NEW ids from the frame emitted in this turn, each with `isConnected` at capture.
   * Raw facts — caller decides PP-FR-1 pass/fail.
   */
  frameNewNodes?: boolean;
}

/** Compact table identity — always present on success. */
interface StateSnapshotTableDigest {
  rowCount: number;
  /** §1.5 `tableHash` as decimal string (JSON-safe). */
  tableHash: string;
}

/**
 * Full replicated table when `opts.table === 'full'`.
 * `rows` must be enough for offline `compareTableToLiveOrder` (parent / sibling links or
 * equivalent). Exact row schema sealed with wire — not an opaque bag.
 */
interface StateSnapshotTableDump {
  digest: StateSnapshotTableDigest;
  rows: unknown;
}

/**
 * Live Virtual child-order at S (id-tagged projected nodes only).
 * Sheet/Rule rows are **not** DOM children — omit them here (CSSOM has its own face).
 */
interface StateSnapshotLiveChildOrder {
  /** `parentId → childIds` in live `childNodes` order (Document id `1` included). */
  childrenByParent: ReadonlyArray<readonly [parentId: number, childIds: readonly number[]]>;
}

/** Replicated CSSOM table plane at S (raw). Exact sheet/rule schema sealed with wire. */
interface StateSnapshotCssomTableDump {
  sheets: unknown;
  rules: unknown;
}

/** Live Virtual CSSOM (`cssRules`) at S (raw; readable sheets only). */
interface StateSnapshotLiveCssomDump {
  sheets: unknown;
}

interface StateSnapshotFrameNewNode {
  nodeId: number;
  /** `Node.isConnected` on Virtual at capture. */
  connected: boolean;
}

/**
 * ## StateSnapshotResult — raw coherent dump
 *
 * Return of `getStateSnapshot`. Captured in **one** Virtual turn after takeRecords + emit S;
 * clocks left halted. Sidecar returns **state planes**, not oracle verdicts.
 *
 * Caller (lab / MotorAssert / helpers) builds features: table×DOM, CSSOM table×live,
 * PP-FR-1, tree×tree, form 1:1, etc. No `identical` / check-`ok` fields on faces.
 *
 * Optional faces are always `T | null` (`null` = not requested).
 * Failure is a discriminated branch — no fake empty planes.
 *
 * **Not on this DTO:** fixture paint-boundary samples (`cascade` / PP-CSSOM-A-2) — lab/fixture
 * concern, not a general Virtual state plane.
 */
type StateSnapshotResult =
  | { ok: false; reason: string; contextId?: number }
  | {
      ok: true;
      /** OPEN-6 instance this snapshot describes. */
      contextId: number;
      generation: number;
      /** Sequence of the frame emitted in this snapshot turn (S). */
      sequence: number;

      /** Replicated DOM table at S (`digest` or `full` per opts). */
      table: StateSnapshotTableDigest | StateSnapshotTableDump;

      /** Live child-order; `null` when not requested. */
      liveChildOrder: StateSnapshotLiveChildOrder | null;

      /**
       * CSSOM planes when `opts.cssom !== 'none'`; else `null`.
       * Both sides from the same turn for offline compare.
       */
      cssom: {
        mode: 'committed' | 'scan';
        table: StateSnapshotCssomTableDump;
        live: StateSnapshotLiveCssomDump;
      } | null;

      /** Structural tree; `null` when not requested. */
      tree: unknown | null;

      /** Form control properties; `null` when not requested. */
      formProps: FormControlSnap[] | null;

      /** NODE_NEW facts from frame S; `null` when not requested. */
      frameNewNodes: readonly StateSnapshotFrameNewNode[] | null;
    };

/** Result of {@link IPageProjectionBrowserSession.emitFrame}. */
interface EmitFrameResult {
  ok: boolean;
  reason?: string;
  generation?: number;
  sequence?: number;
}

/** PageProjection session — Live product + lab/assert on one surface. */
interface IPageProjectionBrowserSession extends IBrowserSession {
  launch(options: PageProjectionLaunchOptions): Promise<BrowserReadyInfo>;
  getStatus(): Promise<PageProjectionStatus>;
  /**
   * Cheap operational counters for one context (default root = 1).
   * Does not emit frames, does not halt clocks, not for table/DOM asserts.
   */
  getTelemetrySnapshot(contextId?: number): Promise<PageProjectionTelemetrySnapshot>;

  pushInput(input: DomInputIngress): Promise<
    { status: 'dispatched' } | { status: 'dropped'; reason: string }
  >;

  getAsset(key: string, opts?: DomAssetRequestOpts): Promise<DomAssetResult | null>;
  putUpload(id: string, body: Uint8Array, contentType: string, name: string): Promise<void>;

  /**
   * Mid-session resync (one path). Triggers Virtual emitResyncFrame / matching context;
   * resync-flagged frame arrives on IPageProjectionSessionSink.onFrame.
   * Cold start already emits via bootstrap — no request.
   * Control/loopback transport inside the session is an implementation detail.
   */
  requestResync(request?: PageProjectionResyncRequest): Promise<void>;

  // --- Lab / MotorAssert (same object; Live product does not call) ---

  /**
   * Stop **every** Virtual producer clock (all OPEN-6 contexts).
   * Impl: one bus message; every algorithm instance observes and halts its own tick.
   * Not a page pause; does not mutate tables.
   */
  haltClocks(): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Resume **every** Virtual producer clock (all OPEN-6 contexts).
   * Same bus broadcast shape as {@link haltClocks}.
   * Typical pair: after {@link getStateSnapshot}, resume so ticks continue.
   */
  resumeClocks(): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Drain that context’s mutation buffer and emit its current frame. No state capture.
   * @param contextId OPEN-6 instance (default root = 1).
   */
  emitFrame(contextId?: number): Promise<EmitFrameResult>;

  /**
   * Virtual **state snapshot** at sequence S for one context:
   * takeRecords → emit S → capture raw planes per {@link StateSnapshotOpts} in one turn;
   * leaves **that context’s** producer clock halted (resume with {@link resumeClocks}, which
   * broadcasts to all contexts). Side effects — not a pure get.
   * Returns **dumps**, not oracle verdicts — caller interprets.
   * Lab/assert only — **not** {@link getTelemetrySnapshot}.
   * Multi-context: call once per `contextId`.
   */
  getStateSnapshot(
    contextId: number,
    opts?: StateSnapshotOpts,
  ): Promise<StateSnapshotResult>;
}

class PageProjectionBrowserSession
  extends BrowserSession
  implements IPageProjectionBrowserSession {}
```

**Rename map (product):**  
`getDomAsset` → `getAsset` · `putDomUpload` → `putUpload` · `pushDomInput` → `pushInput` · `pageProjectionDiffQueueCapacity` → `frameQueueCapacity`.

**Dropped (do not bring to V4 contract):**
- `reportClientState` — pre-V4 rate-ladder; V4 never implemented.
- `getResync` — pre-V4 OOB snapshot RPC.
- `sendControl` — god bag; typed methods instead (`requestResync`, …).
- `snapshotVirtual` / `snapshotProjectionVirtual` — torn peek; iso uses `getStateSnapshot`.
- Session `compareTableToLiveDom` / baked `tableVsLiveDom` / `cssomTableVsLive` / `nodeNewConnected.ok` / `cascade` on the snapshot DTO — **oracles and fixture paint probes are caller-side**. Offline table×DOM uses `table` (`full`) + `liveChildOrder`; CSSOM uses `cssom.table` + `cssom.live`; PP-FR-1 uses `frameNewNodes`. Helpers may live in lab/packages, not on the session port.
- `resumeAllContexts` / `snapshotAllContexts` — use `resumeClocks` + N× `getStateSnapshot`.
- Launch knobs for dead paths; names `flushFrame` / `flushSnapshot`.
- Wire/session field names `o2` / `cssomO2` / `includeTree` / `liveDom` — harness slang or old opts; contract uses raw faces + `opts.tree` / `liveChildOrder`.

**Vocab:** **state snapshot** = coherent raw dump at S. No “probe coerente.” No oracle ids (`O2`, …) and no pass/fail fields on the sidecar DTO — those belong in lab/spec on top of the dump.

**`getStateSnapshot` vs `getTelemetrySnapshot` (why both):**
| | `getTelemetrySnapshot` (product) | `getStateSnapshot` (lab/assert) |
|--|----------------------------------|----------------------------------|
| Audience | Api / sidecar sampler / Live | Lab, MotorAssert, iso |
| Cost | Cheap pull of counters | Expensive coherent dump |
| Effect | None on stream/clocks | Emits frame S, **halts** clocks |
| Payload | dims, queue depth, gen/seq, halted flag, … | raw planes: table, liveChildOrder, cssom, tree, formProps, … |
| Asserts table/DOM? | **Never** | **Never on the session** — caller asserts from dumps |
| Scope | `contextId?` (default root) | **required** `contextId` |

Do not merge them. Both stay on `IPageProjectionBrowserSession`.

**Resync (one path):** `requestResync({ contextId?, reason? })` → producer emits → `onFrame` with resync flag. Client awaits the data plane.

**Streams:** `onFrame(PageProjectionFrame)` (includes `contextId`) + `onProjectionTelemetry`.  
**Cam/mic / permission / history:** as in §5.0b / §5.1.  
**Interactive input:** mode-owned `pushInput` (PP = `DomInputIngress`; video = `BrowserInput` **without** `goback`/`goforward`).

### 5.3 VideoStreaming — product surface

```ts
interface VideoStreamingLaunchOptions extends BrowserLaunchOptionsBase {
  screencastMaxEncodeScale: number;
  displayWidth: number;
  displayHeight: number;
}

interface VideoStreamingStatus {
  isOpen: boolean;
  tabCount: number;
  url: string;
  resizing: boolean;
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
  displayAllocated: boolean;
  displayWidth: number;
  displayHeight: number;
  /** Screencast pipeline running (frames may flow on events). */
  screencastActive: boolean;
}

interface VideoStreamingTelemetrySnapshot {
  inputPendingCount: number;
  inputChainDepth: number;
  displayAllocated: boolean;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  chromeWidth: number;
  chromeHeight: number;
  inputBackend: 'os' | 'patchright';
  touchPrimary: boolean;
  userDataDirPresent: boolean;
  screencastActive: boolean;
  lastEncodeWidth: number;
  lastEncodeHeight: number;
}

interface IVideoStreamingBrowserSession extends IBrowserSession {
  launch(options: VideoStreamingLaunchOptions): Promise<BrowserReadyInfo>;
  getStatus(): Promise<VideoStreamingStatus>;
  getTelemetrySnapshot(): Promise<VideoStreamingTelemetrySnapshot>;

  /**
   * Primary interactive path for video (CDP/OS Input).
   * Pointer / key / wheel / touch / text only — **not** history (`goBack`/`goForward` are core).
   * `BrowserInput` on this contract excludes the old `goback`/`goforward` cases.
   */
  pushInput(input: BrowserInput): Promise<void>;

  // pushCameraFrame / pushMicrophoneAudio: inherited from IBrowserSession (both modes).
}

class VideoStreamingBrowserSession
  extends BrowserSession
  implements IVideoStreamingBrowserSession {}
```

**Egress:** `onVideoFrame` / `onAudioFrame` on `IVideoStreamingSessionSink`.  
**Ingress cam/mic:** core methods (same as PP).  
**Interactive input:** video-only `pushInput(BrowserInput)`.  
**Permission:** `IBrowserPermissionHost` at create (§5.0b) — not the sink.  
**Display journal:** `onDisplayAllocated` / `onDisplayReleased` / `onAllocationFaulted` on video sink only.

### 5.4 Factory — binds session ↔ sink (+ permission host)

```ts
interface IBrowserSessionFactory {
  createPageProjection(
    sessionId: string,
    sink: IPageProjectionSessionSink,
    permissions: IBrowserPermissionHost,
  ): IPageProjectionBrowserSession;

  createVideoStreaming(
    sessionId: string,
    sink: IVideoStreamingSessionSink,
    permissions: IBrowserPermissionHost,
  ): IVideoStreamingBrowserSession;
}
```

The mode session **holds** the sink (push) and the permission host (RPC) privately. Api implements both. No god `BrowserSessionEvents`.

Lab/assert calls the same `IPageProjectionBrowserSession` from the factory (`haltClocks`, `getStateSnapshot`, …). No `diagnostics()` hop.

### 5.5 Resize (core — same DTO both modes)

Logical clamp via `viewportPolicy`; soft apply; no display on `BrowserResizeResult`. Video reads display via **`getStatus()`** on `IVideoStreamingBrowserSession`.

---

## 6. Wire / proto

**Not `oneof`.** Distinct RPCs and messages, aligned with the interfaces:

| Contract | Examples (names illustrative) |
|----------|-------------------------------|
| Shared | `Stop`, `Navigate`, `Refresh`, `GoBack`, `GoForward`, `Resize`, `Evaluate`, `RestoreState`, `StartCpuProfile`, `StopCpuProfile`, … |
| Shared media ingress | `PushCameraFrame`, `PushMicrophoneAudio` (both modes) |
| Shared permission | Control bidi `PermissionRequest` / `PermissionReply` + `PermissionKind` (both modes) |
| PP | `LaunchPageProjection`, status/telemetry, `PushInput` (DomInput), assets, `RequestResync`, lab `HaltClocks`/`ResumeClocks`/`EmitFrame`/`GetStateSnapshot`, … + **server-stream** of `PageProjectionFrame` |
| Video | `LaunchVideoStreaming`, status/telemetry, `PushInput`, … + **server-stream** of video JPEG + audio chunks |

Connection handler: session is created as PP **or** video; only that contract’s RPCs are valid. Wrong RPC → failed precondition / not found for that session type — not a partial message.

`Resize` stays shared (same request/result). Encode scale only on `LaunchVideoStreaming`.

---

## 7. Implementers

| Type | Role |
|------|------|
| `BrowserSession` | Shared Chromium/CSP/navigate/viewport/cookies/cam-mic ingress |
| `PageProjectionBrowserSession` | PP Chromium session; lab methods on same interface |
| `VideoStreamingBrowserSession` | video from Patchright path |
| Mode sinks | Api (or EventBridge) implements `IPageProjectionSessionSink` / `IVideoStreamingSessionSink` |
| `IBrowserPermissionHost` | Api implements; session awaits `requestPermission` |
| Lab / MotorAssert | same PP session + probes (`getStateSnapshot`, …) |
| Proto / web | PP RPCs (Live uses product subset; lab uses assert RPCs on same session type) |

---

## 8. Migration

**Shape cutover (2026-08-21):** steps 1–2 + path flip done in sidecar/Api. See [../CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md).

| # | Step | Status |
|---|------|--------|
| 1 | This doc **SEALED** | **Done** |
| 2 | TS `PageProjectionBrowserSession` + contracts + video class | **Done** |
| 3 | Split proto RPCs (no Launch/Status oneof) | **Done** — `LaunchPageProjection` / `LaunchVideoStreaming` / `WatchPageProjectionFrames`; GetResync+ReportClientState dropped |
| 4 | Prune PP launch knobs; PP telemetry + raw snapshot | **Partial** — methods exist; serializers / knob prune incomplete |
| 5 | Oracles fully caller-side on dump | **Done** — lab iso uses `getStateSnapshot`; PP aliases removed |
| 6 | Api + web + MotorAssert same wave | **Done surface** — Launch split + Frames; web package; Sessions.Tests `PP-LIVE-*` |
| 7 | Delete god interface + optional bags | **Done** — fat PP bags / LPP stub gone; hub MessagePack = `pageProjectionFrame*` |

### 8.1 Deferred until wire seal (shape OK; schemas TBD)

Exact serializers for `StateSnapshotTableDump.rows`, CSSOM `sheets`/`rules`, and `tree` (align with `TreeNode`).  
`BrowserInput` / `DomInputIngress.payload` / `ProjectionTelemetryMessage` / `FormControlSnap` remain owned by their modules — session port only names them.

---

## 9. Locked decisions (final)

1. Encode — launch-only on video; off Resize.  
2. Wire — **distinct** RPCs/messages per contract; **no** proto `oneof` for Launch/Status/telemetry.  
3. Core — shared ops only (incl. cam/mic ingress + CDP CPU profile). No launch/status/telemetry/mode streams.  
4. PP / Video — each owns `launch` / `getStatus` / `getTelemetrySnapshot` (+ mode APIs). No covariance. PP status has **no** generation (generation on PP telemetry).  
5. Display — video only (`displayWidth`/`displayHeight` at launch; `displayAllocated` on status; display journal on video sink).  
6. Streams — factory binds session↔mode sink. PP sink = `onFrame(PageProjectionFrame)` + `onProjectionTelemetry` only.  
7. Permission — `IBrowserPermissionHost.requestPermission(kind)` (RPC); sinks stay push-only.  
8. Allocation — session allocate/release on core sink; display allocate/release/fault on video sink.  
9. Frame DTO — `PageProjectionFrame` includes **`contextId`** (OPEN-6).  
10. Input — mode-specific `pushInput` (PP `DomInputIngress`; video `BrowserInput` without history). History = core `goBack`/`goForward`.  
11. Resync — one path: `requestResync({ contextId?, reason? })` → frame on `onFrame`. Drop `getResync` / `sendControl` / `reportClientState`.  
12. PP launch — `frameQueueCapacity`; no establish/rate-ladder knobs. DomInput — no legacy aliases.  
13. PP lab — `haltClocks` / `resumeClocks` / `emitFrame` / `getStateSnapshot` on the **same** PP interface (no diagnostics facade). Clocks = all contexts via bus broadcast.  
14. State snapshot — **raw planes** + opts; discriminated `ok`; digest-only default; `liveChildOrder` + `table:'full'` for offline table×DOM; no oracle/`cascade` verdicts on the DTO.  
15. Telemetry ≠ snapshot — both on PP; product counters vs coherent dump.  
16. CPU profile — core methods; `cpuProfiling` on launch base; both modes.

---

## 10. Decision log

| Date | Note |
|------|------|
| 2026-08-21 | Inheritance + `I*` naming + PP thin / video owns display. |
| 2026-08-21 | Reject proto `oneof`; core has no launch/status/telemetry. |
| 2026-08-21 | Mode sinks + factory; `PageProjectionFrame` + `contextId`; cam/mic both modes; allocation split. |
| 2026-08-21 | Permission host off sink; input mode-specific; drop clientState / getResync / sendControl. |
| 2026-08-21 | Lab clocks all-contexts; drop snapshotVirtual / compare RPC / multi-context session bags. |
| 2026-08-21 | Fold diagnostics into PP session; CPU profile → core. |
| 2026-08-21 | State snapshot = raw dump (`liveChildOrder`, opts, no baked oracles / cascade). |
| 2026-08-21 | **Final polish:** permission decision stub; EmitFrameResult; async telemetry; diagram/factory clarity; seal checklist. |
| 2026-08-21 | **SEALED** — Rodrigo. Normative home: [browser-session.md](browser-session.md) (this file). |

---

## 11. Review checkpoint

| # | Topic | Status |
|---|--------|--------|
| 1 | `launch` only on mode contracts | OK |
| 2 | No covariance / no opaque shared results | OK |
| 3 | PP methods required | OK |
| 4 | PP launch pruned | OK |
| 5 | Telemetry complete (async) | OK |
| 6 | viewportPolicy vs display | OK |
| 7 | Streams / sinks | OK |
| 8 | Permission host | OK |
| 9 | PP lab methods (no facade) | OK |
| 10 | Resync | OK |
| 11 | DomInput / BrowserInput | OK |
| 12 | emitFrame / getStateSnapshot / contextId | OK |
| 13 | CDP CPU profile on core | OK |
| 14 | StateSnapshotResult raw dump | OK |
| 15 | Wire serializers for snapshot planes | Deferred §8.1 |
| 16 | Process seal | **SEALED 2026-08-21** |

**Next:** implement (§8). Do not reopen shape without a decision-log row.
