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
- the legacy asserted feature matrix (`Speculum.MotorAssert.Tests/MATRIX.md`)

Legend:

- ✅ modeled in `Refactor/Speculum.Api`
- ◐ partially modeled; the current contract does not cover the complete feature
- ○ not modeled

This is a **feature inventory**, not an implementation backlog. Adapters,
databases, protocols, DI, transport mechanics and tests are deliberately omitted.

---

## 1. Client bootstrap and session availability

Current public surface:

- `GET /health`
- `GET /ready`
- `GET /api/admin/config/status`
- `GET /api/public/client-config`
- `/vhub` negotiation remains available during setup mode

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ○ | Session readiness | Reports whether required live-session configuration is present and names missing sections | Readiness query port/result |
| ○ | Configuration status | Reports operational state plus Hosting profile/mirroring status | Admin configuration-status query |
| ○ | Client bootstrap | Returns forwarding host, navigation-state parameter name, Hosting profiles, current domain and effective mirroring | Client-bootstrap query port/result |
| ○ | Setup mode | Session UI can determine that setup is required while Admin/config surfaces remain available | Explicit bootstrap/setup application flow |

Required sections in current behavior are `Forwarding`, `MaxSessions` and
`Hosting`. Mirroring has its own per-profile operational status.

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
| ✅ | Reference-counted presence | Explicit `ILiveSession.Attach(IAttachedSessionClient)` / `Detach` retains/releases the whole session (single client slot); streams do not affect presence | Modeled (one attach; SyncUrl/Redirect via attached client; reverse URL map still ○) |
| ✅ | Context teardown | Releasing a live context disposes mux, unbinds hooks (deny) and drops attachments | Modeled via `ILiveSessionService.Release` → `LiveSession.Release` |
| ✅ | Transport binding | Maps opaque caller identity to Starting/Live state, attachment and owned pipes without SignalR types in the port | `ISessionBindingRegistry` |
| ✅ | Second-start replacement | Same caller replaces Live or cancels and awaits Starting teardown before slot admission | `BeginStart` / `TryPromote` / start completion |
| ✅ | Disconnect policy | Hub disconnect closes owned pipes and detaches presence; zero attachments arm detached TTL | `OnDisconnectedAsync` → `CloseCaller`; collector stops with `TimedOut` |
| ○ | Sidecar death | Sidecar loss faults the session, closes client access and releases capacity | Session-fault handling flow |
| ◐ | Stop reason | User stop, replacement, cancellation/disconnect, timeout and faults are distinguishable in aggregate and journal payloads | Drain/force-stop orchestration remains item 11 |

Detached TTL is the selected disconnect policy. A transport disconnect never
calls `StopSession`; collector timeout performs the eventual stop.

---

## 5. Streaming and input

SignalR `/vhub` carries control only: `EnsureProfileAsync`, `StartSessionAsync`,
`StopSessionAsync`, lifecycle hooks, `StreamJournalAsync` (live Journal
observation — catalogued facts as the Journal admits them, no replay, not session
data), and typed server→client `SyncUrl` / `Redirect` (`ISessionHubClient`) to the
attached session client. WebTransport `/vtransport?sessionId=…&token=…` carries the
data plane. Each WebTransport stream starts with a one-byte kind followed by
big-endian length-prefixed MessagePack messages:

- server streams: frame, console/eval output, notification
- client streams: user input, console/eval input, unary status

The host must expose an HTTPS HTTP/3 Kestrel endpoint for WebTransport; ordinary
HTTP requests to `/vtransport` are rejected with `426 Upgrade Required`.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Frame stream | CDP JPEG + relay monotonic sequence + API relay-receipt UTC timestamp | Typed `Frame` over disposable mux streams and WebTransport |
| ◐ | Console/control output | Console and eval results use typed envelopes; location/blocked drive hub SyncUrl/Redirect via attached client; focus/crash still on notification pipe | Reverse URL projection still ○ |
| ✅ | Status poll | Unary status includes engine JsBridge state, session id and relay uptime | `ILiveSession.GetStatusAsync`; fps remains zero until measured |
| ✅ | User input | Typed `UserInput` envelopes carry validated mouse, keyboard, wheel, text and touch payloads through mux → gRPC | Invalid payloads emit `InputRejected` and do not kill the session |
| ✅ | Console input | Stable `{ id, code }` eval request and typed eval-result envelope | JsBridge-gated; disabled requests are rejected without stopping the session |
| ✅ | Input validation | Malformed MessagePack/JSON and blocked input types are rejected; session stays alive | WebTransport framing limits + gRPC input mapping |
| ◐ | Touch gestures | Touch points/phases reach the sidecar | Exclusive gesture ownership/scheduling remains |
| ○ | Single-tab enforcement | Popup and `_blank` navigation remain in one controlled tab | Browser-window policy capability |
| ✅ | Multi-pipe output | One session can supply equivalent output to N consumers | Fan-out via `SessionStreamMultiplexer`; disposable per-consumer streams |
| ◐ | Multi-pipe input authority | Defines who may control a session when multiple pipes exist | Shared/Exclusive access on mux; ownership/scheduling pending |

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
| ◐ | Runtime navigation | Maps client path/query to target URL and commands the active browser | `ILiveSession.NavigateAsync` uses the same host-aware `IUrlResolver`; SyncUrl/Redirect push absolute target URLs (reverse map ○) |
| ○ | Scheme validation | Invalid/unsupported navigation is rejected | Navigation request validation |
| ○ | URL allowlist | Main-frame navigation honors shared domain/path pattern rules | Navigation policy port/result |
| ○ | Blocked vs failed | Policy block is distinct from technical browser failure | Named results/events |
| ◐ | External redirect | Navigation outside the virtualized domain redirects the real client while session remains alive | `IAttachedSessionClient.RedirectAsync` ← `MainFrameNavigationBlocked` (absolute URL) |
| ○ | Client URL mapping | Target URLs map back to client URLs, preserving path/query and navigation state | Reverse-mapping port; SyncUrl currently pushes absolute browser URL |
| ○ | Subdomain mirroring | Host changes map to mirrored session hosts when operational | Hosting-aware mapping context |
| ○ | Redirect chains / history | Redirects, SPA paths, back/forward and history remain coherent | Navigation-state/history capability |
| ○ | Asset escape rule | Allowlist applies to main-frame navigation, not assets/XHR/subframes | Explicit policy boundary |

---

## 7. Viewport, resize and device behavior

Current Hub method:

```text
ResizeAsync(width, height, device?) → ResizeResult
```

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Startup viewport | Resolution exists in `SessionConfig` | Startup normalization policy |
| ◐ | Runtime resize | Requests a new viewport for a live session | `ILiveSession.ResizeAsync`; validation/busy policy still incomplete |
| ○ | Exact geometry | Success confirms logical Chrome viewport; display dims report policy max allocation | Resize result model |
| ○ | Resize rejection | `<100` or `>4096×2160` is rejected without changing prior geometry | Validation/rejection flow |
| ○ | Resize failure | Operational failure is distinct from validation rejection | Named failure event/result |
| ○ | Resize serialization | Concurrent resize is rejected/coalesced as busy | Per-session resize coordination contract |
| ○ | Device profile | DPR, touch, mobile, max points, UA profile and orientation may change with resize | Shared device-profile contract |

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
| ◐ | State schema | Cookies, localStorage, IndexedDB and history have real contracts | Tolerant restore / normalization still open |
| ◐ | State merge | New exports merge continuity/history across live generations | — |
| ○ | Tolerant cookie restore | Dirty SameSite/expiry fields do not prevent start | State normalization policy/result |
| ○ | Export failure | Sidecar loss may prevent export without blocking resource cleanup | Explicit persistence outcome/events |
| ✅ | Profile list/detail | Operator can inspect persisted identities and state metadata | Admin HTTP mapping deferred until Admin auth (§9) |
| ✅ | Profile deletion | Operator deletes a persisted identity; live sessions reject delete | Admin HTTP mapping deferred until Admin auth (§9) |
| ○ | Manual state replacement | Diagnostics can replace persisted browser state | Controlled profile-state update command |
| ○ | Retention policy | `SessionPolicy.ttlDays` purges expired persisted identities | Profile-retention policy and purge flow |

---

## 9. Runtime configuration features

All sections are managed through:

- `GET /api/admin/config/{section}`
- `PUT /api/admin/config/{section}`
- `DELETE /api/admin/config/{section}`

The migration must preserve each section's **session effect**, not merely its JSON.

### `Forwarding`

| Status | Feature to model |
|--------|------------------|
| ○ | Target host and main-frame domain allowlist |
| ○ | Exact/wildcard domain semantics |
| ○ | Required-for-operation contribution |
| ○ | Active/starting session drain before change applies |
| ○ | Change events/results |

### `MaxSessions`

| Status | Feature to model |
|--------|------------------|
| ◐ | Admission through `ISessionSlotRegistry` |
| ○ | Dynamic policy read by start orchestration |
| ○ | Change does **not** drain current sessions |
| ○ | Capacity/status projection |

### `Hosting`

| Status | Feature to model |
|--------|------------------|
| ○ | Multiple session domains/profiles |
| ○ | Current profile resolution from request host |
| ○ | Subdomain-mirroring enablement and operational status |
| ○ | Wildcard dependency on Forwarding domains |
| ○ | Required-for-operation contribution |
| ○ | Active/starting session drain before change applies |
| ○ | Edge synchronization application capability |

### `ScriptInjection`

| Status | Feature to model |
|--------|------------------|
| ○ | Ordered script references by stored id or remote URL |
| ○ | Positions: HeaderTop, HeaderBottom, BodyTop, BodyBottom |
| ○ | Types: Classic / Module |
| ○ | Per-script target URL rules with shared domain/path pattern models |
| ○ | Session-generation snapshot: config changes affect new sessions |
| ○ | Resolution failure leaves sessions operational without scripts but reports warning |

### `JsBridge`

| Status | Feature to model |
|--------|------------------|
| ○ | Enables/disables eval/console bridge |
| ○ | Value is snapshotted per session; mid-session change does not mutate it |
| ○ | Eval/console behavior and status projection |

### `SessionPolicy`

| Status | Feature to model |
|--------|------------------|
| ○ | Persisted-profile retention (`ttlDays`) |
| ○ | Policy refresh and purge orchestration |

### `Admin`

| Status | Feature to model |
|--------|------------------|
| ○ | Bearer protection for Admin/OpenAPI surfaces |
| ○ | API-key opacity (`GET Admin` never returns the key) |
| ○ | Admin section cannot be deleted |

### Configuration application as a feature

| Status | Feature | Application model still required |
|--------|---------|----------------------------------|
| ○ | Generic section query/update/delete | Configuration application service |
| ○ | Validation result with field paths | Config validation result model |
| ○ | Operational-state recomputation | Readiness projection |
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
| ◐ | Session lifecycle events | Explicit event interfaces exist only for start/stop |
| ○ | Navigate/input/resize/pipe/sidecar events | Capability-specific event ports |
| ○ | Composite telemetry source | Sessions/sidecar/persistence/pipeline projections |

Diagnostics is a product feature, not incidental logging. Its application
contracts must preserve capability gating, redaction, governance and stable
error outcomes.

---

## 12. Failure and recovery features

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Start failure | Named failures + compensation + Aborted marking exist | Cancellation and persistence-save failures |
| ◐ | Stop failure | Persist is soft; teardown is best-effort and serialized per session; idempotent for already-stopped | Explicit aggregate stop outcome/reason |
| ○ | Sidecar fault | Marks session faulted, releases capacity, makes diagnostics return gone | Session fault orchestrator |
| ○ | Export on disconnect | Export success/failure is observable | Disconnect policy + persistence events |
| ○ | Config drain | Exports/stops all active and starting sessions | Drain application service |
| ○ | Graceful shutdown drain | Same preservation guarantees as config drain | Shutdown-triggered drain request |
| ○ | Timeout stop | Collector timeout becomes a reasoned stop flow | Collector lifecycle callback/orchestrator |

---

## 13. Parity gaps in the current refactor contracts

The following are the immediate modeling gaps visible in the existing chassis:

1. `StartSession` now carries Path/Query, transport-derived request host and
   complete launch mimicry; policy fields are assembled from Engine configuration.
2. `IUrlResolver` is host-aware for start and runtime navigation; reverse URL
   projection, redirects and full navigation-state semantics remain open.
3. Runtime Navigate/Resize/Status/Refresh/Diag/streams/hooks/Attach-Detach are on
   `ILiveSession`; `ILiveSessionService.Create` binds a context to an already-open
   connection (no re-resolve). Richer allowlist, busy-coalesce and projection contracts remain open.
4. Stream models do not yet represent URL updates, redirects, eval results,
   complete status or input validation.
5. Disconnect/replacement/config-drain/sidecar-fault flows are not modeled.
6. `SessionState` and `ProfileState` express the persisted feature set; tolerant
   restore / export-failure outcomes remain open.
7. Runtime configuration and its behavioral reactions are not modeled.
8. Admin profile HTTP / script/config/readiness/client-bootstrap features are not
   modeled (profile query/delete exist on `IProfileService`; Admin Bearer arrives in §9).
9. Diagnostics query/control/probe/telemetry features are not modeled.

---

## 14. Recommended modeling order for 1:1 migration

This order follows user-visible dependencies, not infrastructure dependencies:

```text
1. Profile identity ✅
   EnsureProfile (opaque profileId) + correlation + list/detail/delete ports

2. Complete StartSession contract
   Path/Query + transport host + edge-normalized mimicry + Engine launch assembly

3. Transport binding lifecycle ✅
   start replacement + startup cancellation + disconnect + stop reasons

4. Live I/O parity ◐
   frame + console/control + status + user input + eval
   (URL/redirect projection and input ownership scheduling remain)

5. Runtime navigation
   mapping + allowlist + URL sync + redirects + history semantics

6. Resize/device
   startup normalization + runtime exact resize + reject/fail outcomes

7. Persistence/profile administration
   state schema + merge + list/detail/delete + retention

8. Runtime configuration behavior
   all Admin sections + readiness/client projection + drain reactions

9. Script administration/injection

10. Diagnostics/operator surface
    runtime + sessions + timelines + probes + telemetry + governance

11. Fault/drain recovery paths
    sidecar fault + timeout + config drain + shutdown drain
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
  Live runtime push failures journal `Sessions.AttachedClientCommandFailed` (BestEffort)
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
