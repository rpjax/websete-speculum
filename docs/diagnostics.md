# Diagnostics (assertable observability)

Control plane for telemetry, operator debug, and Act→Assert contracts used by MotorAssert / MotorPerf.

Schema version: **`diagnosticsSchemaVersion: 1`**.

> Testing pyramid, Act→Assert rules, and CI splits: **[engineering-standards.md](engineering-standards.md)** §§3–4. Coverage inventory: [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md). Assert failures: [assert-failure-policy.md](assert-failure-policy.md).

## Concepts

| Type | Meaning |
|------|---------|
| Metric | Low-cost gauge/counter |
| Event | Immutable timeline fact |
| Snapshot | Aggregated FSM/session state |
| Probe | On-demand interrogation (`diagProbe`) |
| Signal | Metric \| Event \| Snapshot \| Probe |

Domains: `MotorLive`, `SidecarBrowser`, `BrowserQuery`, `PersistedSessions`, `Telemetry`, `DiagnosticsSelf`.

Each catalog event carries a **capability** (`Metric` \| `Event` \| `Snapshot` \| `Probe`) as metadata — the *Signal* vocabulary above, not an operator control. Operators enable **capability toggles per domain** in config: `domains.motor.{metrics,events,snapshots}`, `domains.sidecar.{metrics,events}`, `domains.browserQuery.probe`, `domains.persisted.snapshots`. `DiagnosticsSelf` is always on while `enabled`. The transport gates each publish purely by *descriptor → `IsCapabilityEnabled(domain, capability)`* — no domain/event names are hardcoded in the bus, and an uncatalogued event is dropped.

Two runtime modifiers overlay the toggles (centralised in `IDiagnosticsRuntime`, never rewritten into config): **Degraded** forces every domain down to the `Metric` capability, and **Elevate** (TTL) forces `BrowserQuery.Probe` + `SidecarBrowser` on. `GET /runtime` and `/overview` project the resolved state as `effectiveCapabilities` (domain → {capability → bool}) plus `storageMaxBytes` and `elevate.active`.

Config section: **`Diagnostics`** (dynamic SQLite; first-boot seed Development / Production / `SPECULUM_DIAGNOSTICS_PROFILE=Assertive`). `Profile` names the preset that seeded the toggles; an explicit toggle overrides the preset. Elevate is a TTL overlay and does not rewrite the section.

REST base: **`/api/admin/diagnostics/v1`** (Bearer admin).

Response wrappers (raw HTTP — client `diagnosticsApi` unwraps where noted):

| Path | Body |
|------|------|
| `GET /sessions/{id}` | `{ snapshot, redaction }` |
| `GET /persisted/{id}` | `{ detail, redaction }` |
| `GET /host` | `{ data, redaction }` |
| `GET /sessions/{id}/events` | event array (each item includes `redaction`) |
| `GET /events?since=&namePrefix=&connectionId=` | global timeline (Drain / DiagnosticsSelf; optional `connectionId` filter) |

### Admin endpoints (all Bearer)

| Method + path | Purpose | Notable results |
|---------------|---------|-----------------|
| `GET /runtime` | Full runtime snapshot | `effectiveCapabilities`, `elevate`, `degraded`, `storageMaxBytes`, `bytesUsed`, `eventsStored`/`eventsDropped`, `overflowCount`, `probeInFlight`, `redactionMode` |
| `GET /overview` | SPA aggregate (runtime + live counts) | adds `liveSessions{activeCount,startingCount,total}`, `needsAttention[]` |
| `PUT /elevate` | Start BrowserQuery elevate (TTL) | body `{ minutes }` clamped to `elevate.browserQueryMaxMinutes`; emits `Diagnostics.ElevateStarted` |
| `DELETE /elevate` | Clear elevate | emits `Diagnostics.ElevateExpired` (`manual_clear`) |
| `POST /recover` | Clear Degraded circuit breaker | `{ recovered }`; emits `Diagnostics.Recovered` when it was degraded |
| `GET /host` | Shared host telemetry sample | `{ data, redaction }`; `403 probe_level_insufficient` unless `telemetry.enabled` + `telemetry.host.enabled` |
| `GET /resolve?connectionId=&persistedSessionId=&sidecarSessionId=` | Resolve a live session by any identity indexer | `{ connectionId, snapshot, redaction }` or `404 motor_not_found` (MATRIX `L12`) |
| `GET /sessions` | Live registry list | `{ activeCount, startingCount, sessions[] }` |
| `GET /sessions/{connectionId}` | Live session snapshot | `{ snapshot, redaction }` or `404 session_gone` |
| `GET /sessions/{connectionId}/events` | Per-session timeline | event array (each with `redaction`) |
| `POST /sessions/{connectionId}/browser` | BrowserQuery probe (`diagProbe`) | `ops[]`; `403 probe_level_insufficient`, `429 probe_busy`, `413 response_too_large`, `504 probe_timeout`, `404 session_gone` |
| `GET /catalog/events` | Stable event catalog | `{ diagnosticsSchemaVersion, events[] }` |
| `GET /persisted` | Persisted session list | store rows (counts) |
| `GET /persisted/{sessionId}` | Persisted detail | `{ detail, redaction }`; needs `persisted.snapshots`; `404 session_gone` |
| `PUT /persisted/{sessionId}/state` | Operator edit of persisted browser state | needs `persisted.snapshots`; `400 invalid_state`, `404 session_gone` |

Catalog Act→Assert events are **never** randomly sampled away. `StatusMirrorRatio` / `expensiveEventRatio` only throttle noisy `Motor.StatusMirrored` (ring-only). Catalog Motor/Sidecar lifecycle events are tagged with the `Metric` capability (not `Event`) so Production (`sidecar.events` off) and Degraded caps do not erase Act→Assert timelines; only `Motor.ResizeRequested` and `Motor.SidecarFaulted` require the `events` toggle.

## Assert Cookbook

Each recipe: Act → poll events with `?since=` / `namePrefix=` → assert snapshot / `errorCode`.

**Harness helpers** (`Speculum.MotorAssert.Tests`): prefer `WaitEvaluateContainsAsync`, `WaitCookieAsync`, `WaitLocalStorageAsync`, `WaitFixturePageAsync`, `WaitConfigAppliedAsync`, `WaitStateExportCompletedAsync`, `ExpectEvaluateAsync` / `ExpectCookieAsync` / `ExpectLocalStorageAsync` (poll), `WaitFrameSequenceAtLeastAsync`, `RequireSessionAsync` / `RequireSnapshot` / `RequireString` — missing JSON properties fail hard (no soft skip). Do **not** insert fixed `Task.Delay` before probes; poll or wait for catalog events instead.

**Per-test baseline:** every MotorAssertive test inherits `MotorAssertTestBase` → `EnsureBaselineAsync` (MaxSessions, JsBridge, clear Degraded, Assertive Diagnostics when needed). See [engineering-standards.md](engineering-standards.md) §3.6.

### 1. Session lifecycle

1. Act: SignalR `StartSessionAsync` with `identity.correlationId` (client Act id) — same id is stored on the session and emitted on `Motor.SessionStarted`.
2. Assert: `GET /events?namePrefix=Motor.Session` (or session events) contains **`Motor.SessionResolved`** then `Motor.SessionStarted` with that `correlationId`.
3. Assert SessionResolved payload: `clientTokenProvided`, `clientTokenEffective`, `persistedSessionId`, `restored`, `stateLoaded`, `cookieCount`, `localStorageCount`, `historyCount`, `initialUrl` (all present).
4. Assert: `GET /sessions/{connectionId}` → `{ snapshot.phase: "Running", ... }`.
5. Act: disconnect / stop (Stop Act generates a **new** `correlationId` on `Motor.SessionStopping` / `Motor.SessionStopped`).
6. Assert: `Motor.SessionStopped` with the Stop Act `correlationId`; `GET /sessions/{connectionId}` → `404` `{ "errorCode": "session_gone" }`; `POST .../browser` → `session_gone`.

### 1b. Session identity resolve (completeness)

| Case | Assert on `Motor.SessionResolved` |
|------|-----------------------------------|
| New session (no token) | `clientTokenProvided: false`, `restored: false` |
| Restore (same token after export) | `clientTokenProvided: true`, `restored: true`, `stateLoaded: true`, counts reflect prior export |

Motor completeness for debug: **identity resolve + URL map + export + probes** (not infinite telemetry).

### 2. Resource release

1. While Running: `POST .../browser` with `ops: ["process","resources"]` — note PIDs.
2. After stop: browser POST returns `session_gone`.
3. Assert: `GET /sessions` counts decreased; prefer sidecar `session_gone` + registry over host PID alone.

### 3. Navigate allowlist

1. Act: navigate to a URL outside Forwarding allowlist.
2. Assert: `Motor.NavigateRejected`; snapshot `lastNavigateResult: rejected`; `currentUrl` unchanged from prior.

> `Motor.NavigateCompleted` means the navigate **command** was accepted by the motor/sidecar path (allowlist + wire send), not that the remote document finished loading.

### 3b. URL map (apex + NSO / mirroring)

1. Act: in-page or hub navigate so the Chromium main-frame URL changes.
2. Assert: `Motor.UrlMapped` with `{ targetUrl, clientUrl }` — emitted **once per distinct `clientUrl`** (not 1 Hz).
3. Apex mode: `clientUrl` contains motor host path + `_w7s_nso` query param (not raw target host alone as the client-facing contract).

`Motor.StatusMirrored` remains ring-only metrics (fps/dims) and is **not** the Act→Assert source for URL sync.

### 4. Persistence

1. Act: stop session that exports state → wait **`Motor.StateExportCompleted` for that `connectionId`** (`WaitStateExportCompletedAsync` — not a global export wait).
2. Assert: `GET /persisted/{sessionId}` → `{ detail… }` (`domains.persisted.snapshots` on).
3. Act: start new session with same client token → restore.
4. Assert: `BrowserQuery` probe `cookies` / `evaluate` sees restored truth.

### 5. Governance

1. PUT tiny `storage.maxBytes` → force overflow → assert `Diagnostics.StorageOverflow` via `GET /events?namePrefix=Diagnostics.Storage` **and/or** `GET /runtime` → `overflowCount`.
2. Enable `domains.browserQuery.probe` → probe ops `cookies` OK.
3. Set `domains.browserQuery.probe: false` → probe returns `403` `{ "errorCode": "probe_level_insufficient" }`.
4. Concurrent probes beyond `maxConcurrentProbesPerSession` → `429` `{ "errorCode": "probe_busy" }`.
5. Probe response exceeding `maxProbeResponseBytes` → HTTP `413` with `errorCode: response_too_large`, **or** a soft-capped success whose body stays under the budget (never an uncapped multi‑100KB DOM dump). MotorAssert `L11` locks this contract.
6. PUT elevate → assert `GET /events?namePrefix=Diagnostics.Elevate` includes `ElevateStarted`; TTL/DELETE → `ElevateExpired`.
7. **Degraded circuit breaker** — sustained sink drops or slow writes trip `Diagnostics.Degraded`; every domain is capped to the `Metric` capability → BrowserQuery probes return `probe_level_insufficient`. Recovery: cleanup cycle or **`POST /recover`** (audited `Diagnostics.Recovered`). Harness baseline calls recover before BrowserQuery asserts.

Recovery/elevate/overview and the full route set are in the **Admin endpoints** table above (`GET /runtime`, `GET /overview`, `PUT|DELETE /elevate`, `POST /recover`, …) — implemented in `DiagnosticsEndpoints`.

### 6. Redaction

1. Same GET session/persisted/probe on Development host → plain identity (`redaction: none`).
2. Production host → masked identities/secrets (`redaction: production`); metrics/PIDs remain readable.

### 7. Performance SLOs (`perf.yml` / `Speculum.MotorPerf.Tests`)

Informational — **does not** block merge. Documented floors:

| SLO | Floor |
|-----|--------|
| Storage overflow under tiny `maxBytes` + session churn | `Diagnostics.StorageOverflow` appears |
| Frame growth | `frameSequence >= 2` within 8s of `SessionStarted` (idle screencast) |
| Probe storm | Concurrent probes beyond cap → `429` / `probe_busy` without hang |

Functional overflow: catalog id + runtime `overflowCount`/`bytesUsed`/`maxBytes` in MotorAssert `M_storage_overflow_contract`; sink emit under tiny `maxBytes` in Api.Tests; load churn in Perf.

## Stable event catalog

See `GET /catalog/events` and `DiagnosticsEventCatalog` — a registry of `DiagnosticsEventDescriptor { Name, Domain, Capability, Persist }` (Motor.*, Sidecar.Diag*, Diagnostics.*, `Telemetry.SampleCollected`). Every emitted event **must** have a descriptor; the transport drops uncatalogued names (guarded by `DiagnosticsCatalogEmittersTests`).

Notable MotorLive events for completeness:

- **`Motor.SessionResolved`** — identity/persist fact before sidecar start (payload above).
- **`Motor.UrlMapped`** — target→client URL map on change (apex NSO / mirroring).

## Failure & lifecycle payload contract

Catalog **failures** and decisive lifecycle emits must carry a JSON payload (never `null` when failure/decision context exists). Hub client messages may stay generic PT; **detail lives in the event** for Act→Assert / admin timeline.

Stable fields (camelCase):

| Field | Use |
|-------|-----|
| `errorCode` | Stable enum string (`sidecar_start_failed`, `cookie_import_invalid`, `session_cancelled`, `export_failed`, `navigate_rejected`, `probe_timeout`, `probe_busy`, `sidecar_channel_closed`, …) |
| `phase` | Where it failed (`resolve`, `sidecar_create`, `import_browser_state`, `promote`, `export`, `navigate`, `probe`) |
| `message` | Technical text truncated (~512 chars). Prod redactor does **not** wipe `message` / `errorCode` / `fault`. |
| Context | Reuse SessionResolved facts when already known: `restored`, `stateLoaded`, `cookieCount`, `persistedSessionId`, `ops`, `sectionKey`, … |

**Rule:** publishing a catalogued failure without `errorCode` + `phase` (where applicable) is a product bug — fix the emit site, do not soften asserts.

Lifecycle payload minimums (opaque but decisive — no stacks):

| Event | Payload |
|-------|---------|
| `SessionStarting` | `clientUrl`, viewport `width`/`height`, `clientTokenProvided` |
| `SlotAcquired` / `SlotReleased` | `maxSessions`, `activeCount`, `startingCount` when cheap |
| `SessionStarted` / `SessionPromoted` | `persistedSessionId`, `restored` |
| `SessionStopping` / `SessionStopped` | `reason` (`disconnect` / `replace` / `drain` / `cancel`) when known |
| `StateExportRequested` / `Completed` | `persistedSessionId`; Completed ideally cookie/LS/history counts |
| `StateExportFailed` | `errorCode`, `phase:"export"`, `message` |
| `NavigateRequested` / `Completed` | `targetUrl`; Requested may include `clientUrl` |
| `SidecarFaulted` | `fault`, `errorCode` |
| `Sidecar.DiagProbe*` | `ops`; TimedOut/Rejected also `errorCode` |

## Motor snapshot minimum

Ids, FSM phase, timing, fps/frames, navigation result, sidecar connected/fault, export flag, config fingerprint, channel depths / inputQueueApprox.

## Sidecar probes

Wire: `diagProbe` / `diagResult`. Ops: `process`, `tabs`, `export`, `cookies`, `storage`, `dom`, `evaluate`, `resources`. Soft-cap via `maxProbeResponseBytes` (default 512 KiB, absolute wire ceiling 8 MiB).

## Config reference (`Diagnostics` section)

Dynamic SQLite section; `PUT /api/admin/config/Diagnostics` validated by `ConfigValidator`. Every sub-section is optional — omitted keys keep the defaults below (bounds are enforced; out-of-range values are rejected).

| Key | Default | Notes / bounds |
|-----|---------|----------------|
| `enabled` | `true` | Master switch; when off, nothing publishes |
| `profile` | `"Production"` | Preset that seeded the toggles (`Development`/`Production`/`Assertive`); explicit toggles override the preset |
| `domains.motor` | `{ metrics, events, snapshots }` all `true` | MotorLive capabilities |
| `domains.sidecar` | `{ metrics: true, events: false }` | SidecarBrowser (probe/diag) |
| `domains.browserQuery` | `{ probe: false }` | live cookie/DOM probe |
| `domains.persisted` | `{ snapshots: true }` | persisted-state reads/edits |
| `telemetry.*` | see [Telemetry](#telemetry-composite-sample) | section toggles + `intervalSeconds` (1..3600) |
| `storage.maxBytes` | `67108864` (64 MiB) | ring/sink budget (≥ 1024) |
| `storage.maxEventsPerSession` | `5000` | per-session cap (≥ 1) |
| `storage.ttlHours` | `24` | event retention (≥ 1) |
| `storage.overflow` | `"DropOldest"` | only accepted value |
| `sampling.statusMirrorRatio` | `1.0` | throttle for ring-only `Motor.StatusMirrored` (0..1) |
| `sampling.expensiveEventRatio` | `0.25` | throttle for noisy expensive events (0..1) |
| `elevate.browserQueryMaxMinutes` | `30` | `PUT /elevate` clamps `minutes` to this (1..1440) |
| `probe.diagTimeoutMs` | `10000` | sidecar probe timeout (100..120000) |
| `probe.maxConcurrentProbesPerSession` | `2` | beyond → `429 probe_busy` (1..32) |
| `probe.maxProbeResponseBytes` | `524288` (512 KiB) | soft-cap; wire ceiling 8 MiB (1024..8388608) |
| `probe.hostSampleIntervalMs` | `1000` | host-probe cache window (100..60000) |

### Seed presets (`DiagnosticsSeedProfiles`)

| Aspect | Development | Production | Assertive |
|--------|-------------|------------|-----------|
| `sidecar.events` | on | off | on |
| `browserQuery.probe` | on | off | on |
| `telemetry.intervalSeconds` | 15 | 30 | 10 |
| telemetry identity opt-ins (`includeSessionIds`/`PerSession`/`UrlHost`/`FaultedIds`/`Bytes`/`BreakerPressure`) | on | off | on |
| `storage` `maxBytes` / `ttlHours` | 128 MiB / 48h | 64 MiB / 6h | 256 MiB / 72h |
| `sampling` (`statusMirrorRatio`/`expensiveEventRatio`) | 1.0 / 1.0 | 0.25 / 0.25 | 1.0 / 1.0 |

First boot seeds `Production` unless `SPECULUM_DIAGNOSTICS_PROFILE` overrides; MotorAssert / MotorPerf CI uses `Assertive`. Redaction is keyed off the **host** environment (`Development` → `none`, `Production` → `production`), independent of the diagnostics profile.

## Telemetry (composite sample)

The `Telemetry` domain publishes one periodic composite event, **`Telemetry.SampleCollected`** (capability `Metric`, persisted), on a single global interval (`telemetry.intervalSeconds`). Overlaying host × motor × sidecar × persistence × pipeline on one time axis is how the sample *tells a story* (symptom → signal). Each section is emitted only when its toggle is on; a missing section means "not collected".

Payload (`TelemetrySample`, camelCase):

| Section | Toggle | Fields |
|---------|--------|--------|
| `host` | `telemetry.host.enabled` | `hostname`, `uptimeSec`, `cpuUsage`, `memoryUsed`, `memoryPrivate`, `memoryTotal`, `gcHeap`, `gcGen0/1/2`, `threadCount`, `threadPoolBusy`, `threadPoolQueued`, `diskFreeBytes` |
| `motor` | `telemetry.motor.enabled` | `total`, `live`, `starting`, `stopping`, `byPhase`, `avgFps`/`minFps`/`maxFps`, `inputQueueTotal`, `frameChannelDepthTotal`, `statusChannelDepthTotal`, `capacityMax`, `capacityUsedPct`; `liveSessionIds[]?` (`includeSessionIds`), `sessions[]?` (`includePerSession`; each `urlHost?` needs `includeUrlHost`) |
| `sidecar` | `telemetry.sidecar.enabled` | `connected`, `faulted`; `faultedSessionIds[]?` (`includeFaultedIds`) |
| `persistence` | `telemetry.persistence.enabled` | `storedSessions`, `totalCookies`, `totalHistory`, `expiringSoon`; `storeBytes?` (`includeBytes`) |
| `pipeline` | `telemetry.pipeline.enabled` | `bytesUsed`, `storageMaxBytes`, `usedPct`, `eventsStored`, `eventsDropped`, `overflowCount`, `probeInFlight`, `degraded`, `elevateActive`; `recentDrops?`/`recentSlowWrites?` (`includeBreakerPressure`) |

Symptom → signal coverage (asserted by composer tests + MotorAssert `T1`/`T2`): memory leak (`host.memoryUsed`/`gcGen2`/`gcHeap` rise vs flat `motor.live`); render regression (`motor.avgFps`/`minFps` fall vs `host.cpuUsage`; when CPU is flat, `motor.inputQueueTotal`/`frameChannelDepthTotal` + `sidecar`); thread starvation (`host.threadPoolQueued` up, `threadPoolBusy` at ceiling); saturation (`motor.capacityUsedPct` → 100 + `motor.starting` piling up); sidecar instability (`sidecar.faulted` up, correlates with `Motor.SidecarFaulted`); diagnostics overhead (`pipeline.recentSlowWrites`/`bytesUsed`). Aggregate-only by default; identity (`liveSessionIds`/`sessions`/`faultedSessionIds`/`urlHost`) is opt-in and still governed by read-time redaction.

`GET /host` returns the shared host collector (the `Telemetry.Host` shape), gated by `telemetry.enabled` **and** `telemetry.host.enabled` (otherwise `probe_level_insufficient`).

## CI: motor-assertive

- **Fast gate (local + Actions):** unit/contract tests — no Chromium. Filter: `Category!=MotorAssertive&Category!=MotorPerf`.
- **Required full gate (GitHub Actions):** job `motor-assertive` boots [`deploy/compose/docker-compose.motor-assert.yml`](../deploy/compose/docker-compose.motor-assert.yml) (fixture + evil-fixture + sidecar + API + Traefik), seeds Forwarding→`fixture.test`, then runs [`Speculum.MotorAssert.Tests`](../Speculum.MotorAssert.Tests/) with `MOTOR_ASSERT_API_BASE` set.
- Fixture contract: [`tests/motor-fixture/README.md`](../tests/motor-fixture/README.md).
- Matrix inventory: [`Speculum.MotorAssert.Tests/MATRIX.md`](../Speculum.MotorAssert.Tests/MATRIX.md).
- Failure artifacts: compose logs + diagnostics dumps under the runner temp directory.

MotorAssert matrix A–O is **required green** on PRs. When an assert fails, follow [assert-failure-policy.md](assert-failure-policy.md) — do not skip or soften.

Do not run the Chrome stack as day-to-day local verification.
