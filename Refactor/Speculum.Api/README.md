# Motor migration — feature-parity modeling map

This refactor is currently modeling **interfaces and application-layer flows**.
It is not yet implementing infrastructure.

The goal of this document is precise:

> List every externally observable Motor feature that must be represented by
> application contracts and orchestrators before the migration can be 1:1.

The inventory comes from the current product surface:

- SignalR `/vhub` methods (`MotorHub`)
- public and Admin REST routes
- runtime sections written through `/api/admin/config/{section}`
- the asserted feature matrix (`Speculum.MotorAssert.Tests/MATRIX.md`)

Legend:

- ✅ modeled in `Refactor/Speculum.Api`
- ◐ partially modeled; the current contract does not cover the complete feature
- ○ not modeled

This is a **feature inventory**, not an implementation backlog. Adapters,
databases, protocols, DI, transport mechanics and tests are deliberately omitted.

---

## 1. Client bootstrap and Motor availability

Current public surface:

- `GET /health`
- `GET /ready`
- `GET /api/admin/config/status`
- `GET /api/public/client-config`
- `/vhub` negotiation remains available during setup mode

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ○ | Motor readiness | Reports whether required Motor configuration is present and names missing sections | Readiness query port/result |
| ○ | Configuration status | Reports operational state plus Hosting profile/mirroring status | Admin configuration-status query |
| ○ | Client bootstrap | Returns forwarding host, navigation-state parameter name, Hosting profiles, current domain and effective mirroring | Client-bootstrap query port/result |
| ○ | Setup mode | Motor UI can determine that setup is required while Admin/config surfaces remain available | Explicit bootstrap/setup application flow |

Required sections in current behavior are `Forwarding`, `MaxSessions` and
`Hosting`. Mirroring has its own per-profile operational status.

---

## 2. Profile identity and continuity

The current Hub accepts `SessionIdentity`:

- optional `clientToken`
- optional `correlationId`
- optional `indexers` dictionary

It resolves or creates a persisted identity and returns the effective client
token from `StartSessionAsync`.

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Durable profile | `Profile` exists, but no application flow creates/resolves one | `IProfileService` with Ensure/Resolve flow |
| ○ | Client-token continuity | Same valid token resolves the same persisted identity; invalid token is rejected | Ensure-profile request/result including effective token |
| ○ | Identity indexers | Equivalent indexers resolve the same persisted identity | Indexer model and identity-resolution rules |
| ○ | New-token issuance | Missing token creates identity and returns a token to the client | Result contract for EnsureProfile/bootstrap |
| ○ | Correlation identity | Client correlation id follows the session story | Operation/session context model |
| ○ | Rebind across generations | New live sessions reuse one persisted profile and merge history/state | Profile generation/rebind application flow |

The refactor's intended client flow remains:

```text
EnsureProfile(identity) → { profileId, clientToken }
StartSession(profileId, ...)
```

This preserves the current feature without forcing persistence identity back
into the live `Session`.

---

## 3. Start-session feature surface

Current Hub method:

```text
StartSessionAsync(clientUrl, viewportWidth, viewportHeight, identity, device?)
    → clientToken
```

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Fail-fast provisioning | Session is usable only after browser launch, state restore and initial navigation | Already modeled in `SessionService` |
| ✅ | Compensation | Failed start releases acquired live resources | Already modeled |
| ✅ | Slot admission | Rejects starts beyond `MaxSessions` | Port and flow modeled |
| ◐ | Initial URL | Resolver port exists, but lacks client URL and request-host context | Initial-navigation request/context and richer resolver contract |
| ◐ | Initial viewport | `SessionConfig` has resolution only | Startup normalization rules and viewport result |
| ○ | Startup defaults | Non-positive viewport becomes `1280×720`; oversized input is bounded | Viewport policy port/value objects |
| ○ | Device emulation | Mobile, touch, DPR, max touch points, UA profile and orientation apply at start | Device-profile model and normalization flow |
| ○ | Operational gate | Start is rejected while Motor config is incomplete | Runtime-capabilities/readiness dependency in start flow |
| ○ | Session runtime snapshot | Start captures Forwarding, Hosting profile, scripts, JsBridge, allowlist and device settings for that generation | Session-runtime-policy snapshot contract |
| ○ | Return contract | Current client receives effective client token; refactor returns only `sessionId` | Start result coordinated with EnsureProfile |
| ○ | Start replacement | A second start on the same Hub connection replaces active session or cancels an in-progress start | Transport-binding/application orchestration flow |
| ○ | Startup cancellation | Disconnect/cancellation during start releases slot and partially started session | Explicit cancellation outcome/events |

---

## 4. Session attachment, replacement and disconnect

The current product binds one live session directly to one SignalR
`ConnectionId`. The refactor deliberately introduces N pipes per session.

### Features to preserve or decide explicitly

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ✅ | Pipe ownership | Pipe is the caller's I/O handle; only the service closes it | Modeled |
| ✅ | Reference-counted presence | Opening/closing pipes retains/releases the session | Modeled at contract level |
| ○ | Transport binding | Maps SignalR connection identity to a pipe/session without leaking SignalR into domain types | Transport-session binding application port |
| ○ | Second-start replacement | Same caller can replace its previous active or starting session | Replacement orchestration contract |
| ○ | Disconnect policy | Current behavior immediately exports and stops; refactor proposes detached TTL | A deliberate parity decision and disconnect orchestrator |
| ○ | Sidecar death | Sidecar loss faults the session, closes client access and releases capacity | Session-fault handling flow |
| ○ | Stop reason | Disconnect, timeout, replacement, config drain, user stop and force stop are distinguishable | `StopReason` model and policy |

The detached-TTL design changes current behavior. It must be accepted as an
intentional product change or configured to reproduce immediate stop during
migration.

---

## 5. Streaming and input

Current Hub methods:

- `OpenFrameChannel`
- `OpenConsoleOutputChannel`
- `OpenStatusChannel`
- `OpenUserInputChannel`
- `OpenConsoleInputChannel`

### Features to preserve

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Frame stream | JPEG + monotonic sequence + capture timestamp | Pipe contract exists; frame semantics should be finalized |
| ◐ | Console/control output | Console, URL updates, eval results and redirects share client-visible output | Define typed output/control capabilities exposed by a pipe |
| ◐ | Status stream | Periodic tab count, URL, resize state, geometry, FPS, uptime, session id, JsBridge and editing state | Final `SessionStatus` projection contract |
| ◐ | User input | Mouse, keyboard, wheel, text and touch reach browser | Typed input model and application input flow |
| ◐ | Console input | Eval request carries id + JavaScript code | Eval request/result contract and JsBridge gate |
| ○ | Input validation | Malformed JSON and blocked input types are rejected; session stays alive | Input-validation policy and rejection events |
| ○ | Touch gestures | Tap, cancel, multitouch and drag-scroll are supported | Touch input models |
| ○ | Single-tab enforcement | Popup and `_blank` navigation remain in one controlled tab | Browser-window policy capability |
| ○ | Multi-pipe output | One session can supply equivalent output to N pipes | Fan-out semantics in the pipe application contract |
| ○ | Multi-pipe input authority | Defines who may control a session when multiple pipes exist | Controller/ownership policy |

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
| ◐ | Initial navigation | Required for successful start | Modeled, but resolver inputs are incomplete |
| ○ | Runtime navigation | Maps client URL to target URL and commands the active browser | Navigation application port/orchestrator |
| ○ | Scheme validation | Invalid/unsupported navigation is rejected | Navigation request validation |
| ○ | URL allowlist | Main-frame navigation honors shared domain/path pattern rules | Navigation policy port/result |
| ○ | Blocked vs failed | Policy block is distinct from technical browser failure | Named results/events |
| ○ | External redirect | Navigation outside the virtualized domain redirects the real client while session remains alive | Redirect output model |
| ○ | Client URL mapping | Target URLs map back to client URLs, preserving path/query and navigation state | Reverse-mapping port |
| ○ | Subdomain mirroring | Host changes map to mirrored Motor hosts when operational | Hosting-aware mapping context |
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
| ○ | Runtime resize | Requests a new viewport for a live session | Resize application port/orchestrator |
| ○ | Exact geometry | Success confirms browser and display geometry, not merely requested size | Resize result model |
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
| ○ | State schema | Cookies, localStorage, IndexedDB and history have real contracts | `ProfileState` / `SessionState` models |
| ○ | State merge | New exports merge continuity/history across live generations | Profile merge rules |
| ○ | Tolerant cookie restore | Dirty SameSite/expiry fields do not prevent start | State normalization policy/result |
| ○ | Export failure | Sidecar loss may prevent export without blocking resource cleanup | Explicit persistence outcome/events |
| ○ | Profile list/detail | Operator can inspect persisted identities and state metadata | Profile administration query port |
| ○ | Profile deletion | Operator deletes a persisted identity | Profile deletion flow/reasons |
| ○ | Manual state replacement | Diagnostics can replace persisted browser state | Controlled profile-state update command |
| ○ | Retention policy | `SessionPolicy.ttlDays` purges expired persisted identities | Profile-retention policy and purge flow |

---

## 9. Runtime configuration features

All sections are managed through:

- `GET /api/admin/config/{section}`
- `PUT /api/admin/config/{section}`
- `DELETE /api/admin/config/{section}`

The migration must preserve each section's **Motor effect**, not merely its JSON.

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
| ○ | Multiple Motor domains/profiles |
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
| ○ | Resolution failure leaves Motor operational without scripts but reports warning |

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
| ◐ | Capability toggles: Motor metrics/events/snapshots |
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
| ◐ | Motor lifecycle events | Explicit event interfaces exist only for start/stop |
| ○ | Navigate/input/resize/pipe/sidecar events | Capability-specific event ports |
| ○ | Composite telemetry source | Motor/sidecar/persistence/pipeline projections |

Diagnostics is a product feature, not incidental logging. Its application
contracts must preserve capability gating, redaction, governance and stable
error outcomes.

---

## 12. Failure and recovery features

| Status | Feature | Current observable behavior | Application model still required |
|--------|---------|-----------------------------|----------------------------------|
| ◐ | Start failure | Named failures + compensation exist | Cancellation and persistence-save failures |
| ◐ | Stop failure | Persist is soft; teardown continues | Explicit aggregate stop outcome/reason |
| ○ | Sidecar fault | Marks session faulted, releases capacity, makes diagnostics return gone | Session fault orchestrator |
| ○ | Export on disconnect | Export success/failure is observable | Disconnect policy + persistence events |
| ○ | Config drain | Exports/stops all active and starting sessions | Drain application service |
| ○ | Graceful shutdown drain | Same preservation guarantees as config drain | Shutdown-triggered drain request |
| ○ | Timeout stop | Collector timeout becomes a reasoned stop flow | Collector lifecycle callback/orchestrator |

---

## 13. Parity gaps in the current refactor contracts

The following are the immediate modeling gaps visible in the existing chassis:

1. `StartSession` does not carry client URL, request-host context, startup
   viewport or device profile.
2. `IInitialUrlResolver` cannot reproduce current mapping because it receives
   neither client URL nor Motor host/Hosting context.
3. `StartSessionAsync` returns `sessionId`; current client behavior also needs
   effective profile/client-token continuity.
4. There is no EnsureProfile/identity-indexer application flow.
5. There is no runtime Navigate or Resize application port/orchestrator.
6. Pipe models do not yet represent URL updates, redirects, eval results,
   complete status or input validation.
7. Disconnect/replacement/config-drain/sidecar-fault flows are not modeled.
8. `SessionState` and `ProfileState` do not express the persisted feature set.
9. Runtime configuration and its behavioral reactions are not modeled.
10. Admin profile/script/config/readiness/client-bootstrap features are not modeled.
11. Diagnostics query/control/probe/telemetry features are not modeled.

---

## 14. Recommended modeling order for 1:1 migration

This order follows user-visible dependencies, not infrastructure dependencies:

```text
1. Profile identity
   EnsureProfile + token/indexers + start result

2. Complete StartSession contract
   client URL + host context + viewport + device + runtime policy snapshot

3. Transport binding lifecycle
   start replacement + startup cancellation + disconnect + stop reasons

4. Live I/O parity
   frame + console/control + status + user input + eval

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
- `ISessionConnection` is the sidecar boundary, not the user-facing session API.
- `Session` (live) remains distinct from `Profile` (durable identity/state).
- Pipes are transport consumers; attached/detached are not lifecycle states.
- Named events replace generic `Failed(phase)`.
- Diagnostics failures still require stable `errorCode` + context in their
  eventual catalog payloads.
- W7S vocabulary remains at wire/client boundaries only.

### `ISessionConnection` surface (API ↔ sidecar)

**On the port:** `SessionId` / `IsOpen`; lifecycle (`LaunchBrowser` → ready geometry,
`RestoreProfileState`, `Navigate`, `Refresh`, `ExportSessionState`, `StopBrowser`,
`Close`); runtime (`Resize`, `RequestDiagnostics`); streams (frames, console out,
status, user-input JSON pump, console-input pump).

**Not on the port:** `IBrowserClient` registry; session slots / pipes; client↔target URL
mapping and business allowlist; profile merge/persist; Journal emit; Diagnostics
capability gates / probe budgets; hub/SignalR binding. History (`goback` /
`goforward`) stays in validated user-input JSON.
