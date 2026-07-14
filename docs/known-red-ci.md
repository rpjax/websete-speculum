# Known red CI (policy + history)

Hardened asserts exist to **catch product lies**. When they fail, fix the product or harness — do not `[Skip]` / `[Ignore]` / soften.

Policy: [engineering-standards.md](engineering-standards.md) §3.7. Agents: [../AGENTS.md](../AGENTS.md).

---

## Current status

| Gate | Status |
|------|--------|
| Fast gate (`dotnet` / `sidecar` / `web` / `compose` / `dockup`) | Green |
| **`motor-assertive`** (90 tests, MATRIX A–O) | **Green** (verified run `29317794817`) |

If `motor-assertive` goes red again, use this doc + CI logs to classify **product** vs **harness** before changing asserts.

---

## Policy (always)

1. **Missing JSON property = fail** — no `TryGetProperty` skip-as-pass.
2. **Effect assert** — events, snapshots, probes, `errorCode`; not `200` / `ok: true` alone.
3. **Functional ≠ Perf** — overflow load, frame SLOs, probe storm → `perf.yml` / Api sink units, not weakened MotorAssert.
4. **Harness flake = bug** — fix wait scope, baseline, or product timing; do not add silent retries.
5. **MATRIX** must stay accurate when coverage depth changes.

---

## Resolved (diagnostics + traps wave)

| Area | Issue | Fix |
|------|-------|-----|
| MsgPack A/B | JS `clientToken` / `status.url` not binding (PascalCase wire) | `[Key("camelCase")]` on hub DTOs + `MotorHubMessagePack.Options` |
| Cascade E6/A8 | API `/ready` green while sidecar dead | Wait sidecar HTTP `/health` after restart |
| G4 | MaxSessions PUT emitted `ConfigApplied` | Product: no event for MaxSessions |
| C3 | Wheel assert on missing `#speculum-probe` | Wait `data-clicks` on `/click-target` |
| J7 | Mirroring without `edgeTls` | **400** aligned with `ConfigValidator` |
| L11 | Silent `{}` on oversized probe | `response_too_large` + hub `errorCode` map |
| L10 | Chromium poison after cancelled CDP probe | Drain evaluate before disconnect |
| Isolation | `BrowserQuery=Metrics` after Assertive PUT | **Degraded** cap — `POST /recover` + faster cleanup + baseline |
| E1/E8 | Restore with empty cookies | Global `StateExport` wait matched wrong export → `WaitStateExportCompletedAsync(connectionId)` |

Hardened asserts that drove the above (A8, A9, B1, E3, E6, E7, F1, F3, J7, K3, L11, M1, E8, B12, …) are **green** on current `main` branch merge candidate — they remain strict; do not relax them.

---

## Harness checklist (when probes or restore fail)

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `403 probe_level_insufficient` with Assertive seed | `Diagnostics.Degraded` | `POST /api/admin/diagnostics/v1/recover`; verify `GET /runtime` → `degraded: false` |
| `effectiveLevels.BrowserQuery=Metrics` after restore PUT | Same | Baseline `EnsureBaselineAsync` |
| Restore cookies empty, export “already done” | Export wait matched another test | `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)` |
| Timeout on `ConfigApplied` after JsBridge PUT | Wrong event expectation | Remove wait; only Diagnostics/Hosting emit it |
| Mass 1ms failures after one long test | Baseline throw / degraded cascade | Fix first failing test; check `/recover` + runtime |

---

## Unit contracts (must stay green)

`DiagnosticsEmitterPublishTests`: SessionResolved payload fields, restored+counts, UrlMapped once per distinct clientUrl, Off drops publishes, Degraded still accepts catalog Motor events.

`DiagnosticsEndpointsTests.Recover_clears_degraded_and_audits`: `POST /recover` clears degraded and emits `Diagnostics.Recovered`.

---

## Deferred (intentional)

| ID | Item | Notes |
|----|------|-------|
| K4 | ACME/DNS | `deferred-K4` — manual/nightly; not PR required |

---

## Related

- Harness helpers: `DiagnosticsAssertClient`, `MotorAssertFixture`, `MotorAssertTestBase`
- Cookbook: [diagnostics.md](diagnostics.md)
- Matrix inventory: [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md)
