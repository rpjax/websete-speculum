# Sessions migration — feature-parity modeling map

This refactor models **interfaces and application-layer flows** and implements the
session lifecycle/runtime chassis (`ISessionService`, `ILiveSessionService` /
`ILiveSession`, stream multiplexer, hooks, collector) with unit coverage in
`Speculum.Api.Sessions.Tests`. Infrastructure adapters (real sidecar wire, edge,
diagnostics pipeline) are still deliberately out of scope.

The goal of this document is precise:

> List every externally observable live-session feature that must be represented by
> application contracts and orchestrators before the migration can be 1:1.

The inventory comes from the current product surface:

- legacy SignalR `/vhub` methods (`MotorHub`)
- public and Admin REST routes
- runtime sections written through `/api/admin/config/{section}`
- the legacy asserted feature matrix (`Speculum.Api.SessionsTest.Tests/MATRIX.md`)

Legend:

- ✅ modeled in `Speculum.Api`
- ◐ partially modeled; the current contract does not cover the complete feature
- ○ not modeled

This is a **feature inventory**, not an implementation backlog. Adapters,
databases, protocols, DI, transport mechanics and tests are deliberately omitted.

---

## 1. Client bootstrap and session availability

Current public surface:

- Public mount: ASP.NET `UsePathBase("/w7s")` — clients use `/w7s/…`
- `GET /w7s/health/live` / `GET /w7s/health/ready`
- `GET /w7s/api/configurations/status`
- `GET /w7s/api/public/client-config` (V1)
- `/w7s/vhub` negotiation remains available during setup mode

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Session readiness | `/w7s/health/ready` + client-config `operational`/`missing` (Nav/Sessions/RM) | — |
| ✅ | Configuration status | Operational + optional Hosting domains (no `mirroringOperational` — 1.1) | — |
| ✅ | Client bootstrap | V1 `GET /w7s/api/public/client-config` (nsoParamName, navigation, sessions, RM, hosting optional) | — |
| ✅ | Setup mode | Hub connects; EnsureProfile allowed; StartSession fails with `Pending config` until mandatory complete; Lab/Live → `/w7s/setup` when not-ready (`/w7s/lab?configure=1` for apply-defaults) | — |

Required sections in the refactor are `Navigation`, `Sessions` and
`ResourceManagement` (legacy names were `Forwarding` / `MaxSessions` /
`Hosting`). Hosting is **optional** for ready; subdomain mirroring ops are **1.1**.

---

## 2. Profile identity and continuity

Speculum V1 persists continuity as an opaque `profileId` the client stores
locally. There is no application-layer `clientToken` and no indexer table —
that differs from the legacy `BrowserSessionRegistry` which resolved identity
via token/indexers.

Security rules that drive the ensure contract:

- Unknown/forged/purged ids never bind to the caller's value; the service
  issues a new `Guid.NewGuid()` (v4) and returns `Created = true`.
- The id is the credential for the cookie/localStorage bucket; v7 timestamps
  are deliberately avoided on this public credential.

Optional `correlationId` on ensure is projected onto profile journal facts.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Durable profile | `EnsureProfileAsync` resolves a known `profileId` or creates one; unknown ids never bind to caller-supplied values | — |
| — | Client-token continuity | N/A in Speculum V1 (continuity is the opaque `profileId`) | — |
| — | Identity indexers | N/A in Speculum V1 | — |
| ✅ | Id issuance | Missing/unknown id creates identity and returns a server-generated `profileId` | — |
| ✅ | Correlation identity | Optional correlation id follows profile ensure/delete journal facts | — |
| ✅ | Rebind across generations | New live sessions reuse one persisted profile and merge history/state | — |

The refactor client flow:

```text
EnsureProfileAsync({ profileId?, correlationId? }) → { profileId, created }
StartSessionAsync({ profileId, … })
```

This preserves continuity without forcing persistence identity back into the
live `Session`.

---

## 3. Start-session feature surface

Refactor Hub method:

```text
StartSessionAsync({
  profileId, path, query, viewportWidth, viewportHeight, device?, clientEnvironment?
}) → { sessionId, token }
```

`RequestHost` is read from the SignalR HTTP transport; it is never trusted from
the client body. Missing mimicry is filled once at the presentation edge from
validated `EngineConfiguration.Sessions` policies. From the application layer
through gRPC and the sidecar, values are explicit and missing values fail.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Fail-fast provisioning | Session is usable only after browser launch, state restore and initial navigation | Modeled in `SessionService` (persist Live → `Create(connection)` → `Watch`) |
| ✅ | Compensation | Failed start releases acquired live resources and marks a persisted row Aborted | Modeled (`CompensateStartFailureAsync`) |
| ✅ | Slot admission | Rejects starts beyond `MaxSessions` | Port and flow modeled |
| ✅ | Resolved start URL | `Path` + `Query` + transport host resolve NSO/apex or mirrored subdomains to one allowlisted absolute target before browser navigation | `IUrlResolver.Resolve(path, query, requestHost)` is shared by start and runtime navigation; mirroring apex comes from `Navigation.AllowedMainFrameUrls` |
| ✅ | Start viewport | Client geometry is filled/clamped once at the edge from `Sessions.ViewportPolicy` | Application and sidecar reject incomplete values; they do not re-default |
| ✅ | Device emulation | Mobile, touch, DPR, max touch points, UA profile and orientation apply at start | Edge normalization uses `Sessions.DeviceEmulationPolicy` |
| ✅ | Client environment | Locale, language, timezone, color scheme and optional geolocation reach Chrome | Edge fill uses `Sessions.ClientEnvironmentPolicy`; launch wire is strict |
| ✅ | Operational gate | Start is rejected while required engine configuration is incomplete | `SessionService` validates configuration before opening a browser connection |
| ◐ | Launch configuration | Start assembles mimicry, JsBridge, allowlist and resolved scripts for the generation | Script source resolution remains part of item 9; configured unresolved injections fail closed |
| ✅ | Return contract | Client receives `sessionId` plus the effective binding token | `StartSessionResponse` / Hub response |
| ✅ | Start replacement | A second start on the same Hub connection stops Live with `Replaced` or cancels and awaits an in-progress start teardown | `ISessionBindingRegistry` + `SessionService` |
| ✅ | Startup cancellation | Disconnect/cancellation during start compensates with a non-cancelled teardown token and releases the slot | `Cancelled` / `Disconnected` lifecycle reasons |

---

## 4. Session attachment, replacement and disconnect

The current product binds one live session directly to one SignalR
`ConnectionId`. The refactor deliberately introduces N pipes per session.

### Features to preserve or decide explicitly

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Stream ownership | Disposable stream handles unregister themselves from the mux | Modeled |
| ✅ | Reference-counted presence | Explicit `ILiveSession.Attach(IAttachedSessionClient)` / `Detach` retains/releases the whole session (single client slot); streams do not affect presence | Modeled (one attach; SyncUrl/Redirect via attached client + `ProjectToClient`) |
| ✅ | Context teardown | Releasing a live context disposes mux, unbinds hooks (deny) and drops attachments | Modeled via `ILiveSessionService.Release` → `LiveSession.Release` |
| ✅ | Transport binding | Maps opaque caller identity to Starting/Live state, attachment and owned pipes without SignalR types in the port | `ISessionBindingRegistry` |
| ✅ | Second-start replacement | Same caller replaces Live or cancels and awaits Starting teardown before slot admission | `BeginStart` / `TryPromote` / start completion |
| ✅ | Disconnect policy | Hub disconnect closes owned pipes and detaches presence; zero attachments arm detached TTL | `OnDisconnectedAsync` → `CloseCaller`; collector stops with `TimedOut` |
| ✅ | Sidecar death | Sidecar loss / notification-channel end faults the session via `AbandonAsync(Faulted, …)` and releases capacity | Crash + `sidecar_connection_ended` → `ISessionFaultScheduler` |
| ◐ | Stop reason | User stop, replacement, cancellation/disconnect, timeout, faults, Drain and ForceStop are distinguishable | — |

Detached TTL is the selected disconnect policy. A transport disconnect never
calls `StopSession`; collector timeout performs the eventual stop.

---

## 5. Streaming and input

SignalR `/vhub` is the **control plane**: `EnsureProfileAsync`, `StartSessionAsync`,
`StopSessionAsync`, `NavigateAsync`, `ResizeAsync`, lifecycle hooks,
`StreamJournalAsync` (live Journal observation — catalogued facts as the Journal
admits them, no replay, not session data), and typed server→client `SyncUrl` /
`Redirect` (`ISessionHubClient`) to the attached session client. User input is
**not** admitted on the hub.

WebTransport `/vtransport?sessionId=…&token=…` and WebSocket `/vstream?sessionId=…&token=…`
are the **data plane** carriers (`DataStreams` on the client). Sessions config
`dataStreamTransport` (`webTransport` | `webSocket`) is projected on
`GET /api/public/client-config`; browsers pick it up after refresh. Logical
pipes share the same framing: one-byte kind, then big-endian length-prefixed
MessagePack messages:

- server→client: frame, console/eval output, notification
- client→server: UserInput (product path), console/eval input, unary status

WebSocket uses a stream-id mux (OPEN/DATA/CLOSE) on one socket; WebTransport
uses native uni/bi streams. The host must expose HTTPS HTTP/3 for WebTransport;
ordinary HTTP to `/vtransport` is rejected with `426 Upgrade Required`.
`/vstream` is a normal WebSocket upgrade (nginx/Vite-proxyable like `/vhub`).
Sessions tests may admit input via harness HTTP (`AdmitUserInput`) without a
data-plane client.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Frame stream | CDP JPEG + relay monotonic sequence + API relay-receipt UTC timestamp | Typed `Frame` over disposable mux streams and WT/WS carriers |
| ✅ | Console/control output | Console and eval results use typed envelopes; location/blocked drive hub SyncUrl/Redirect; EditableFocusChanged and crash→SessionEnded via attached client | — |
| ✅ | Status poll | Unary status includes engine JsBridge state, session id and relay uptime | `ILiveSession.GetStatusAsync`; fps is measured from relay-observed video frames |
| ✅ | User input | Data-plane UserInput → `ILiveSession.AdmitUserInput` → HF-first bounded admit → bounded mux → gRPC | Invalid payloads emit `InputRejected` and do not kill the session |
| ✅ | Input path hops (opt-in) | VideoStreamingInput: `DataPlaneReceived` / `ControlReceived` / `SidecarPushWritten` / `SidecarAdmitted`. PageProjection: `Diff.FrameReceived`, `Input.DataPlaneReceived` / `SidecarPushWritten` / `Applied` / `Rejected` | Lab Telemetry event toggles; planes do not share facts. Sidecar pull telemetry also exposes `inputDepth` / `inputChainDepth`; Wire `client_sent` is a separate localStorage toggle |
| ✅ | Console input | Stable `{ id, code }` eval request and typed eval-result envelope | JsBridge-gated; disabled requests are rejected without stopping the session |
| ✅ | Input validation | Malformed JSON/MessagePack and blocked input types are rejected; session stays alive | Hub admit + gRPC input mapping; optional WT framing limits |
| ◐ | Touch gestures | Touch points/phases reach the sidecar | Exclusive gesture ownership beyond Access Exclusive remains thin |
| ✅ | Single-tab enforcement | Sidecar `setupSingleTab` + tab interception keep popup/`_blank` on one main tab | Assert via SessionsTest / sidecar units |
| ✅ | Multi-pipe output | One session can supply equivalent output to N consumers | Fan-out via `SessionStreamMultiplexer`; Exclusive delivery uses first-attached pipe |
| ✅ | Multi-pipe input authority | Shared/Exclusive Access; Ownership FirstAttached/FirstClaim/PreemptiveClaim; Scheduling read (ArrivalOrder drain; RoundRobin Shared = arrival-order merge) | Wired in `SessionInputMerger` / `SessionOutputFanOut` |

---

## 6. Runtime navigation and URL synchronization

Current Hub method:

```text
NavigateAsync(clientUrl)
```

Current behavior also exposes URL updates and external redirects through the
live output stream.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Start navigation | Required for successful start | Resolve → Navigate uses Path, Query and transport host |
| ✅ | Runtime navigation | `NavigateAsync` → `NavigateResult` (Applied / ResolveFailed / NavigateFailed); SyncUrl via `ProjectToClient` | — |
| ✅ | Scheme validation | Resolve always builds `https://` targets; bad path/host → ResolveFailed outcome | — |
| ✅ | URL allowlist | Main-frame host + optional path (`UrlMatchRule.Path` Exact/Prefix) via `Navigation.AllowedMainFrameUrls` | — |
| ✅ | Blocked vs failed | Policy block (`MainFrameNavigationBlocked` → Redirect hub) distinct from NavigateFailed outcome | — |
| ✅ | External redirect | `IAttachedSessionClient.RedirectAsync` ← `MainFrameNavigationBlocked` (absolute URL) | — |
| ✅ | Client URL mapping | `IUrlResolver.ProjectToClient` maps browser absolute → session-host SyncUrl (apex NSO / mirroring); status poll uses the same projection | — |
| ◐ | Subdomain mirroring | Resolve-time + SyncUrl reverse in `UrlResolver` | Operational status / edge sync → **1.1** |
| ✅ | History nav | `goback` / `goforward` user-input → sidecar `page.goBack` / `goForward` | SessionsTest effect row |
| ✅ | Asset escape rule | Allowlist gates main-frame Resolve/Navigate only; assets/XHR/subframes are not filtered here (`NavigationConfiguration`) | — |

---

## 7. Viewport, resize and device behavior

Current Hub method:

```text
ResizeAsync(width, height, device?) → ResizeResult
```

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Startup viewport | Client geometry filled/clamped at the edge from `Sessions.ViewportPolicy` | Application and sidecar reject incomplete values |
| ✅ | Runtime resize | Hub `ResizeAsync` → `ILiveSession.ResizeAsync`; busy returns `Applied=false` + `Outcome=Busy` + `resize_busy` | — |
| ✅ | Exact geometry | `ResizeResult` reports chrome logical viewport and display dims (SessionsTest D1) | — |
| ✅ | Resize rejection | Bounds from `ViewportPolicy`; `Outcome=Rejected` + telemetry Rejected (SessionsTest D2) | — |
| ✅ | Resize failure | `Outcome` Applied/Rejected/Busy/Failed + `errorCode`/`phase` + telemetry | — |
| ✅ | Resize serialization | Resize uses `_commandGate.TryAcquire` (busy-reject); Navigate/Refresh still queue | Rapid coalesce remains client-side (`CanvasViewportSync`) |
| ✅ | Device profile | Optional `DeviceProfile` on resize request reaches sidecar (SessionsTest C11) | — |

---

## 8. Browser-state persistence and profile administration

Current persisted state includes cookies, local storage, IndexedDB and history.
State is restored on start and exported on disconnect/drain.

Admin routes:

- `GET /api/admin/sessions`
- `GET /api/admin/sessions/{sessionId}`
- `DELETE /api/admin/sessions/{sessionId}`

Diagnostics also exposes persisted list/detail and state replacement.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Restore/export orchestration | Start restores; stop exports best-effort | Flow modeled |
| ✅ | State schema | Cookies, localStorage, IndexedDB and history have real contracts | — |
| ✅ | State merge | New exports merge continuity/history across live generations | `ProfileState.MergeFrom` |
| ✅ | Tolerant cookie restore | Dirty SameSite/expiry fields sanitize; journal `ProfileStateRestored` carries normalize stats | Sidecar `PageState` + proto `CookieNormalizeStats` |
| ◐ | Export failure | Soft persist; export/skipped events exist without blocking teardown | Explicit persistence outcome completeness |
| ✅ | Profile list/detail | Operator can inspect persisted identities and state metadata | Admin HTTP mapping deferred until Admin auth (§9) |
| ✅ | Profile deletion | Operator deletes a persisted identity; live sessions reject delete | Admin HTTP mapping deferred until Admin auth (§9) |
| ✅ | Manual state replacement | `PUT /api/admin/diagnostics/v1/profiles/{id}/state` (E8b path) | `IProfileService.ReplaceProfileStateAsync` |
| ◐ | Retention policy | `InactiveRetentionPeriod` in config; Cleaner+Enforcer hosted scaffolds registered (no purge yet) | Future SQLite-only purge via `IProfileRepository.Delete` |

---

## 9. Runtime configuration features

Legacy Admin used `/api/admin/config/{section}`. The refactor exposes
`/api/configurations` (+ `/{section}`, status) over `EngineConfiguration` via
`IConfigurationService` / `IConfigurationApplyService`.

The migration must preserve each section's **session effect**, not merely its JSON.

### `Navigation` (legacy `Forwarding`)

| Status | Feature to model |
|--------|------------------|
| ✅ | Default target host and main-frame host allowlist (`AllowedMainFrameUrls`) |
| ✅ | Exact/wildcard domain + optional path Exact/Prefix at resolve |
| ✅ | Required-for-operation contribution (`ConfigurationCompleteness`) |
| ✅ | Active/starting session drain before change applies (`ISessionDrainOrchestrator`) |
| ○ | Change events/results |

### `ResourceManagement.Sessions` (legacy `MaxSessions`)

| Status | Feature to model |
|--------|------------------|
| ✅ | Admission through `ISessionSlotRegistry` |
| ✅ | Dynamic policy read by start orchestration |
| ✅ | Change does **not** drain current sessions (by design) |
| ○ | Capacity/status projection |

### Host resources (admin infra uncap)

Manual sidecar `/dev/shm` (and optional ulimit) provision — **not** session capacity.

| Endpoint | Role |
|----------|------|
| `GET /api/admin/host-resources` | Host probe + sidecar shm snapshot + last apply |
| `POST /api/admin/host-resources/preview` | Formula only (`maxRamBytes` ceiling, reserve %, caps) |
| `POST /api/admin/host-resources/apply` | Preview → gRPC `ApplyHostResources` → persist last apply |

Formula lives in `HostResourceCalculator`. Sidecar executes precomputed bytes (remount).
No auto-apply on boot; sidecar restart resets shm to Docker `shm_size` floor.

### `Hosting`

| Status | Feature to model |
|--------|------------------|
| ◐ | Multiple session domains/profiles (model + resolve-time use) |
| ◐ | Current profile resolution from request host |
| ◐ | Subdomain-mirroring enablement |
| ○ | Wildcard dependency on Navigation allowlist completeness |
| ○ | Required-for-operation contribution (Hosting not in mandatory completeness) |
| ✅ | Active/starting session drain before change applies (`ISessionDrainOrchestrator`) |
| ○ | Edge synchronization application capability |

### `Scripting` (legacy `ScriptInjection`)

| Status | Feature to model |
|--------|------------------|
| ◐ | Ordered script sources (model + launch resolver) |
| ◐ | Positions / Classic vs Module |
| ◐ | Per-script target URL rules (models exist) |
| ◐ | Session-generation snapshot at start |
| ◐ | Resolution failure fail-closed for configured injections |
| ○ | Stored-script admin CRUD (§10) |

### `Sessions.JsBridge` (legacy `JsBridge`)

| Status | Feature to model |
|--------|------------------|
| ✅ | Enables/disables eval/console bridge |
| ✅ | Value is snapshotted per session at start |
| ✅ | Eval/console behavior and status projection |

### `Profiles` retention (legacy `SessionPolicy`)

| Status | Feature to model |
|--------|------------------|
| ◐ | Inactive retention period in config |
| ○ | Policy refresh and purge orchestration |

### `Administration` (legacy `Admin`)

| Status | Feature to model |
|--------|------------------|
| ○ | Bearer protection for Admin/OpenAPI surfaces |
| ○ | API-key opacity (`GET Admin` never returns the key) |
| ○ | Admin section cannot be deleted |

### Configuration application as a feature

| Status | Feature | Application model still required |
|--------|---------|----------------------------------|
| ✅ | Generic section query/update (full snapshot PUT) | `ConfigurationEndpoints` + apply service |
| ◐ | Validation result with field paths | Validators + apply errors; richer field-path UX open |
| ◐ | Operational-state recomputation | Completeness + status endpoint |
| ○ | Config-triggered drain | Session-drain orchestrator with reason |
| ○ | Public client projection | Client-config query service |

---

## 10. Injected-script administration

Current routes:

- `GET /api/admin/scripts`
- `POST /api/admin/scripts`
- `DELETE /api/admin/scripts/{id}`

### Features to preserve

| Status | Feature | Application model still required |
|--------|---------|----------------------------------|
| ○ | Upload stored script | Script command/service |
| ○ | List script metadata | Script query |
| ○ | Delete script | Delete command/result |
| ○ | Upload constraints | `.js`, non-empty, 5 MB maximum |
| ○ | Script-reference integrity | ScriptInjection rejects missing ids |
| ○ | Remote-script safety | Absolute HTTP(S), SSRF-safe source |
| ○ | Injection placement/type | Session script snapshot model |

---

## 11. Diagnostics and operator control

Current `/api/admin/diagnostics/v1` surface includes runtime state, overview,
elevation, recovery, probes, live/persisted session views, timelines, telemetry,
event catalog and persisted-state control.

### Diagnostics configuration (`Diagnostics`)

| Status | Feature to model |
|--------|------------------|
| ◐ | Global enabled; Development/Production/Assertive remain bootstrap presets |
| ◐ | Capability toggles: Sessions metrics/events/snapshots |
| ◐ | Capability toggles: Sidecar metrics/events |
| ◐ | Capability toggle: BrowserQuery probe |
| ◐ | Capability toggle: persisted-profile snapshots |
| ◐ | Composite telemetry and per-section identity/detail toggles |
| ○ | Storage budget, TTL, per-session event cap and DropOldest overflow |
| ◐ | Sampling ratios |
| ◐ | Temporary elevate duration |
| ◐ | Probe concurrency and response-size budgets; timeout remains technical |

### Diagnostics routes/features

| Status | Feature | Application model still required |
|--------|---------|----------------------------------|
| ○ | Runtime/overview | Diagnostics runtime query incl. capabilities/degraded/storage/live counts |
| ○ | Elevate / clear elevate | Temporary unredacted BrowserQuery control |
| ○ | Recover | Clear degraded circuit state |
| ○ | Live session list/detail | Diagnostics session snapshot query |
| ○ | Resolve identity | Resolve by transport id, persisted profile id or sidecar id |
| ○ | Session/global timelines | Event query with range, prefix and identity filters |
| ○ | Telemetry history | Pagination and bucket/downsample query |
| ○ | Browser probe | cookies/storage/DOM/evaluate/resource ops |
| ○ | Probe governance | capability gate, per-session concurrency, timeout, response soft cap |
| ○ | Host/API process probes | Resource-probe query surface |
| ○ | Event catalog | Descriptor/capability/span catalog query |
| ○ | Persisted snapshots | List/detail/state replacement under capability gate |
| ◐ | Session lifecycle events | Start/stop/live event interfaces + rich `ISessionTelemetryEvents*` (capacity/start/navigate/persist/input/resize/browse/client) | Operator query surfaces still ○ |
| ◐ | Navigate/input/resize/pipe/sidecar events | Catalogued telemetry event models + ports exist | Diagnostics timeline query still ○ |
| ◐ | Composite telemetry source | `TelemetrySampleComposer` / `SampleCollected` / session samples | Admin telemetry history HTTP still ○ |

Diagnostics is a product feature, not incidental logging. Its application
contracts must preserve capability gating, redaction, governance and stable
error outcomes.

---

## 12. Failure and recovery features

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Start failure | Named failures + compensation + Aborted marking exist | Cancellation and persistence-save failures |
| ◐ | Stop failure | Persist is soft; teardown is best-effort and serialized per session; idempotent for already-stopped | Explicit aggregate stop outcome/reason |
| ✅ | Sidecar fault | Marks session faulted via abandon, releases capacity | Diagnostics-gone / operator projection still ○ |
| ◐ | Export on disconnect | Export success/failure/skipped is journalled | Disconnect policy + persistence events completeness |
| ✅ | Config drain | `ISessionDrainOrchestrator`: drain→persist→apply on Navigation/Hosting PUT; `Drain` then `ForceStop` + final sweep; Start gated while draining | — |
| ✅ | Graceful shutdown drain | `SessionDrainHostedService` drains on host stop (before Journal flush); soft budget then ForceStop | — |
| ✅ | Timeout stop | Collector detached TTL → `StopReason.TimedOut` | — |

---

## 13. Parity gaps in the current refactor contracts

Immediate modeling gaps still open (chassis already covers much of the former list):

1. **Navigation / Live I/O polish** — ✅ ownership/scheduling wiring, Navigate/Resize
   outcomes, history + single-tab; output default **Broadcast** (Exclusive is opt-in);
   RoundRobin Shared remains arrival-order merge.
2. **Resize busy** — ✅ `resize_busy` / `Outcome=Busy` (unit + MATRIX D3).
3. **Config/shutdown drain** — ✅ `ISessionDrainOrchestrator` wired to Navigation/Hosting
   Apply and process shutdown (`Drain` → `ForceStop` budget).
4. **Tolerant restore / retention purge** — ✅ dirty-cookie sanitize + journal
   normalize stats + diagnostics PUT state; retention Cleaner/Enforcer scaffolds
   registered (purge = SQLite-only future, not enabled).
5. **Client bootstrap / setup mode** — ✅ public V1 client-config + setup UI +
   hub setup-mode (StartSession still gated); Hosting optional; mirroring ops 1.1.
6. **Script administration** — scripting models + launch resolve ◐; stored-script
   Admin CRUD remains ○.
7. **Diagnostics operator HTTP** — capability toggles + session telemetry events +
   composite samples exist; runtime/overview/timelines/probes/catalog query remain ○
   (still 1.0 later; out of this gap plan).
8. **Admin Bearer** — Administration section and API-key opacity remain ○
   (still 1.0 later; out of this gap plan).

### Post-1.0 / 1.1 (explicitly deferred)

- EdgeSynchronizer / Traefik dynamic YAML / dockup file provider
- `mirroringOperational` + J7 DnsChallenge + B8 + K1–K3
- UI Hosting `edgeTls` → mirroring ops
- Subdomain mirroring “operacional” beyond unit `UrlResolver` coverage

---

## 14. Recommended modeling order for 1:1 migration

This order follows user-visible dependencies, not infrastructure dependencies:

```text
1. Profile identity ✅
   EnsureProfile (opaque profileId) + correlation + list/detail/delete ports

2. Complete StartSession contract ✅
   Path/Query + transport host + edge-normalized mimicry + Engine launch assembly
   (script resolution remains ◐)

3. Transport binding lifecycle ✅
   start replacement + startup cancellation + disconnect + sidecar fault + timeout

4. Live I/O parity ◐→near ✅
   frame + console/control + status + data-plane AdmitUserInput + eval
   (SyncUrl ProjectToClient ✅; input ownership scheduling remain)

5. Runtime navigation ◐
   forward resolve/navigate ✅; reverse SyncUrl ✅; path allowlist ✅; history open

6. Resize/device ◐
   ports + policy + resize busy-reject ✅; exact-result / coalesce polish open

7. Persistence/profile administration ✅/◐
   schema + merge ✅; tolerant restore + E8b PUT ✅; retention purge scaffold only

8. Runtime configuration / bootstrap ✅
   EngineConfiguration + Apply/CRUD ✅; V1 client-config + setup mode ✅;
   Hosting optional; mirroring ops → 1.1

9. Script administration/injection ○/◐
   launch snapshot ◐; Admin script store ○

10. Diagnostics/operator surface ○/◐
    telemetry samples + session event ports ✅; HTTP/probes/timelines ○

11. Fault/drain recovery paths ✅
    sidecar fault + timeout + config/shutdown drain ✅

12. Edge / subdomain mirroring ops → **1.1**
    EdgeSynchronizer, Traefik file sync, mirroringOperational, J7/B8/K*
```

For each item: define interfaces and models, implement only its
application-layer orchestration, then mark the feature ✅/◐ here.

---

## 15. Boundaries to preserve while modeling

- Presentation calls application ports; it does not inject `IBrowserClient`.
- `ISessionService` = lifecycle (Start/Stop); `ILiveSessionService` / `ILiveSession` =
  one in-memory context per live connection (typed streams, commands, hooks, Attach/Detach).
  Start success order: persist Live → `Create(sessionId, connection, requestHost, jsBridgeEnabled)` →
  collector `Watch` → `Attach(IAttachedSessionClient)` → binding `TryPromote`.
  Live runtime push failures journal `Telemetry.Sessions.Client.AttachedCommandFailed` (BestEffort)
  and `Sessions.FeatureLoopFaulted` (Guaranteed); ILogger remains the operational log path.
  Stop order: persist best-effort → MarkStopped → live `Release` → `Unwatch` →
  StopBrowser → Close → slot release. Host registers `ISessionService` with `IUrlResolver`;
  `AddBrowserSessions` registers `ILiveSessionService` (needs `IUrlResolver`).
- `ISessionConnection` is the sidecar boundary, not the user-facing session API.
- `Session` (live) remains distinct from `Profile` (durable identity/state).
- Caller attachment is a single `IAttachedSessionClient` on `ILiveSession` (presence +
  SyncUrl/Redirect); independent from disposable stream registrations.
- Named events replace generic `Failed(phase)`.
- Diagnostics failures still require stable `errorCode` + context in their
  eventual catalog payloads.
- W7S vocabulary remains at wire/client boundaries only.

### `ISessionConnection` surface (API ↔ sidecar)

**On the port:** `SessionId` / `IsOpen`; lifecycle (`LaunchBrowser` → ready geometry,
`RestoreProfileState`, `Navigate`, `Refresh`, `ExportSessionState`, `StopBrowser`,
`Close`); runtime (`Resize`, `RequestDiagnostics`); streams (frames, console out,
notifications, user-input JSON pump, console-input pump); hooks (camera/mic
permission handlers — default deny).

**Not on the port:** `IBrowserClient` registry; session slots / pipes; client↔target URL
mapping and business allowlist; profile merge/persist; Journal emit; Diagnostics
capability gates / probe budgets; hub/SignalR binding. History (`goback` /
`goforward`) stays in validated user-input JSON. Application wraps hooks via
`ILiveSession` / `ILiveSessionService` (application never calls
`Set*PermissionHandler` directly).
