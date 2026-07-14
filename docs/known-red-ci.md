# Known red CI (diagnostics + bug traps)

Hardened asserts and remaining product gaps may still fail. Do not `[Skip]` / `[Ignore]` them — fix the product.

Policy context: [engineering-standards.md](engineering-standards.md) (§3.7 known-red, anti-patterns). Agents: [../AGENTS.md](../AGENTS.md).

## MsgPack camelCase (Bugs A/B) — fixed

| ID | Test | Status |
|----|------|--------|
| A′ | `MsgPackHubContractTests.SessionIdentity_deserializes_js_camelCase_clientToken` | Green via `[Key("clientToken")]` + `MotorHubMessagePack` |
| B′ | `MsgPackHubContractTests.SessionStatus_roundtrip_exposes_camelCase_url_for_js_client` | Green via `[Key("url")]` + camelCase wire |
| B′ web | `sessionStatusPayload.test.ts` | Green (camelCase required; PascalCase ignored by design) |
| E8 / B12 | MotorAssert rebind / UrlMapped traps | Re-validate after deploy; C# Act path already camelCase-aligned |

## Hardened asserts (may fail; fix product, not the assert)

A8 SidecarFaulted + session_gone (+ sidecar `/health` wait after restart), A9 viewport dims, B1 probe `/nav/b`, E3 multi-entry history, E6 SidecarFaulted then StateExportFailed (+ `/health` wait), E7 cookie/LS after drain, F1 DELETE SessionPolicy, F3 DELETE→404, J7 mirroring without edgeTls → 400, K3 CORS success status, L11 soft-cap → `response_too_large`, M1 exact `Diagnostics.ConfigApplied`, no StartSession retry, strict FindPersistedSessionId (token-only), camelCase-only detail JSON (`history`/`cookies`/`localStorage`).

## Diagnostics emitter publish (unit — must stay green)

`DiagnosticsEmitterPublishTests`: SessionResolved payload fields, restored+counts, UrlMapped once per distinct clientUrl, Off drops publishes, Degraded accepts catalog Motor events.

## Harness isolation (MotorAssert)

Every MotorAssertive test inherits `MotorAssertTestBase` → `EnsureBaselineAsync` before Act:

- `MaxSessions=4`, `JsBridge.enable=true`
- Clears **Diagnostics Degraded** via `POST /api/admin/diagnostics/v1/recover` when needed (Degraded caps effective levels at Metrics → `403 probe_level_insufficient`)
- Diagnostics Assertive (`BrowserQuery`) restored when effective levels are insufficient, with `ConfigApplied` wait + runtime verify

Do not use `WaitConfigApplied` for non-Diagnostics/Hosting sections (e.g. JsBridge, MaxSessions).

## Isolation wave (29316122628) — root cause

`BrowserQuery=Metrics` after PUT Assertive = **Degraded cap**, not wrong config. Fixed in `b837670`: recover endpoint + faster cleanup + baseline clears Degraded.

## Export wait (E1/E8) — harness

`WaitForEventsAsync(null, "Motor.StateExport", since-at-test-start)` could match another test's `StateExportCompleted` (e.g. E4/G2/G3 before E1). Use `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)`.

## Next

1. Re-run MotorAssert CI after export-scoped wait.
2. Treat any remaining hard failures as product with independent evidence.
