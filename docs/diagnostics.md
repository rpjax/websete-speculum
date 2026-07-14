# Diagnostics (assertable observability)

Phase 2 control plane for telemetry, debug, and Phase 3 Act→Assert contracts.

Schema version: **`diagnosticsSchemaVersion: 1`**.

## Concepts

| Type | Meaning |
|------|---------|
| Metric | Low-cost gauge/counter |
| Event | Immutable timeline fact |
| Snapshot | Aggregated FSM/session state |
| Probe | On-demand interrogation (`diagProbe`) |
| Signal | Metric \| Event \| Snapshot \| Probe |

Domains: `MotorLive`, `SidecarBrowser`, `BrowserQuery`, `PersistedSessions`, `HostResources`, `DiagnosticsSelf`.

Levels (totally ordered): `Off < Metrics < Events < StateSnapshots < BrowserQuery`.

Config section: **`Diagnostics`** (dynamic SQLite; first-boot seed Development / Production / `SPECULUM_DIAGNOSTICS_PROFILE=Assertive`). Elevate is a TTL overlay and does not rewrite the section.

REST base: **`/api/admin/diagnostics/v1`** (Bearer admin).

Response wrappers (raw HTTP — client `diagnosticsApi` unwraps where noted):

| Path | Body |
|------|------|
| `GET /sessions/{id}` | `{ snapshot, redaction }` |
| `GET /persisted/{id}` | `{ detail, redaction }` |
| `GET /host` | `{ data, redaction }` |
| `GET /sessions/{id}/events` | event array (each item includes `redaction`) |
| `GET /events?since=&namePrefix=&connectionId=` | global timeline (Drain / DiagnosticsSelf; optional `connectionId` filter) |

Catalog Act→Assert events are **never** randomly sampled away. `StatusMirrorRatio` / `expensiveEventRatio` only throttle noisy `Motor.StatusMirrored` (ring-only). Catalog Motor/Sidecar/Diagnostics events also use a Metrics publish floor so Prod (`SidecarBrowser=Metrics`) and `DiagnosticsDegraded` caps do not erase Act→Assert timelines.

## Assert Cookbook (Phase 3 input)

Each recipe: Act → poll events with `?since=` / `namePrefix=` → assert snapshot / errorCode.

**Harness helpers** (`Speculum.MotorAssert.Tests`): prefer `ExpectEvaluateAsync`, `ExpectCookieAsync`, `ExpectLocalStorageAsync`, `WaitFrameSequenceAtLeastAsync`, `RequireSessionAsync` / `RequireSnapshot` / `RequireString` — missing JSON properties fail hard (no soft skip).

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

1. Act: stop session that exports state → `Motor.StateExportCompleted` (always recorded; not sampled).
2. Assert: `GET /persisted/{sessionId}` → `{ detail… }` (level ≥ `StateSnapshots`).
3. Act: start new session with same client token → restore.
4. Assert: `BrowserQuery` probe `cookies` / `evaluate` sees restored truth.

### 5. Governance

1. PUT tiny `storage.maxBytes` → force overflow → assert `Diagnostics.StorageOverflow` via `GET /events?namePrefix=Diagnostics.Storage` **and/or** `GET /runtime` → `overflowCount`.
2. Enable `domains.browserQuery: BrowserQuery` → probe ops `cookies` OK.
3. Set BrowserQuery `Off` → probe returns `403` `{ "errorCode": "probe_level_insufficient" }`.
4. Concurrent probes beyond `maxConcurrentProbesPerSession` → `429` `{ "errorCode": "probe_busy" }`.
5. Probe response exceeding `maxProbeResponseBytes` → HTTP `413` with `errorCode: response_too_large`, **or** a soft-capped success whose body stays under the budget (never an uncapped multi‑100KB DOM dump). MotorAssert `L11` locks this contract.
6. PUT elevate → assert `GET /events?namePrefix=Diagnostics.Elevate` includes `ElevateStarted`; TTL/DELETE → `ElevateExpired`.

### 7. Performance SLOs (`perf.yml` / `Speculum.MotorPerf.Tests`)

Informational — **does not** block merge. Documented floors:

| SLO | Floor |
|-----|--------|
| Storage overflow under tiny `maxBytes` + session churn | `Diagnostics.StorageOverflow` appears |
| Frame growth | `frameSequence >= 2` within 8s of `SessionStarted` (idle screencast) |
| Probe storm | Concurrent probes beyond cap → `429` / `probe_busy` without hang |

Functional overflow: catalog id + runtime `overflowCount`/`bytesUsed`/`maxBytes` in MotorAssert `M_storage_overflow_contract`; sink emit under tiny `maxBytes` in Api.Tests; load churn in Perf.

### 6. Redaction

1. Same GET session/persisted/probe on Development host → plain identity (`redaction: none`).
2. Production host → masked identities/secrets (`redaction: production`); metrics/PIDs remain readable.

## Stable event catalog

See `GET /catalog/events` and `DiagnosticsEventCatalog` (Motor.*, Sidecar.Diag*, Diagnostics.*).

Notable MotorLive additions for completeness:

- **`Motor.SessionResolved`** — identity/persist fact before sidecar start (payload above).
- **`Motor.UrlMapped`** — target→client URL map on change (apex NSO / mirroring).

## Known red (intentional until hotfix plan)

MsgPack camelCase identity + web `SessionStatus` casing traps, and hardened MotorAssert asserts, may fail CI until the follow-up **hotfix** plan. Do not skip or weaken those tests.

## Motor snapshot minimum

Ids, FSM phase, timing, fps/frames, navigation result, sidecar connected/fault, export flag, config fingerprint, channel depths / inputQueueApprox.

## Sidecar probes

Wire: `diagProbe` / `diagResult`. Ops: `process`, `tabs`, `export`, `cookies`, `storage`, `dom`, `evaluate`, `resources`. Soft-cap via `maxProbeResponseBytes` (default 512 KiB, absolute wire ceiling 8 MiB).

## Phase 3 CI (motor-assertive)

- **Fast gate (local + Actions):** unit/contract tests — no Chromium. Filter: `Category!=MotorAssertive`.
- **Full gate (GitHub Actions only):** job `motor-assertive` boots [`deploy/compose/docker-compose.motor-assert.yml`](../deploy/compose/docker-compose.motor-assert.yml) (fixture + evil-fixture + sidecar + API + Traefik), seeds Forwarding→`fixture.test`, then runs [`Speculum.MotorAssert.Tests`](../Speculum.MotorAssert.Tests/) with `MOTOR_ASSERT_API_BASE` set.
- Fixture contract: [`tests/motor-fixture/README.md`](../tests/motor-fixture/README.md).
- Matrix inventory: [`Speculum.MotorAssert.Tests/MATRIX.md`](../Speculum.MotorAssert.Tests/MATRIX.md).
- On failure Actions uploads compose logs + diagnostics dumps under the runner temp dir.

Do not run the Chrome stack as day-to-day local verification.
