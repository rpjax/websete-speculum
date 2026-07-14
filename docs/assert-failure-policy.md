# Assert failure policy

**Audience:** contributors and agents triaging failed CI or MotorAssert.  
**Status:** permanent policy — not a backlog of known failures.

When a hardened assert fails, **fix the product or the harness**. Do not `[Skip]`, `[Ignore]`, soften, or “temporarily” mark green.

Canonical constitution: [engineering-standards.md](engineering-standards.md) §3. Agents: [../AGENTS.md](../AGENTS.md). Coverage inventory: [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md).

---

## Rules

1. **Missing JSON property = fail** — never `TryGetProperty` then skip as success.
2. **Effect assert** — catalogued events, snapshots, probes, and `errorCode` values. Status `200` or `ok: true` alone is not motor truth.
3. **Functional ≠ Perf** — overflow load, frame SLOs, and probe-storm capacity belong in `perf.yml` / Api sink units, not weakened MotorAssert cases.
4. **Flake = bug** — fix wait scope, baseline isolation, or product timing. No silent retry loops.
5. **MATRIX stays accurate** when coverage depth changes (same PR).

Weakening an assert to obtain a green pipeline is a **policy violation**.

---

## Classify before you change the assert

| Class | Evidence | Action |
|-------|----------|--------|
| **Product** | Event missing, wrong `errorCode`, wrong wire shape, restore loses cookies | Fix domain code; leave the assert |
| **Harness** | Shared stack pollution, wrong event wait, Degraded left on | Fix `EnsureBaselineAsync` / wait helpers; leave the assert |
| **Deferred** | Explicit MATRIX `deferred-K4` (ACME/DNS) | Documented out of PR required set only |

---

## MotorAssert triage checklist

Shared compose is serial. Prefer these checks when BrowserQuery probes or restore fail:

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `403 probe_level_insufficient` with Assertive seed | `Diagnostics.Degraded` | `POST /api/admin/diagnostics/v1/recover`; confirm `GET /runtime` → `degraded: false` |
| `effectiveLevels.BrowserQuery=Metrics` after Diagnostics PUT | Degraded cap (config is ignored for levels above Metrics) | Baseline must clear Degraded before level verify |
| Restore sees empty cookies; export “already happened” | Global `StateExport` wait matched another test | `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)` |
| Timeout on `ConfigApplied` after JsBridge / MaxSessions PUT | Those sections do not emit `ConfigApplied` | Wait only after Diagnostics or Hosting PUT |
| Cascade of sub-second Init failures | Prior test left Degraded or baseline threw | Fix the first red case; verify recover + Assertive runtime |
| `SessionStartFailed` / export / probe fail opaque | Missing `errorCode`/`phase`/`message` on timeline | Read event payload first (admin dump); fix emit or product; do not rely on Docker logs alone |

Helpers: `DiagnosticsAssertClient`, `MotorAssertFixture`, `MotorAssertTestBase`. Cookbook: [diagnostics.md](diagnostics.md).

---

## Contracts that guard wire and emitters

These unit / contract suites must remain green and strict:

- `DiagnosticsEmitterPublishTests` — SessionResolved payload, restore counts, UrlMapped uniqueness, Off drop, Degraded still accepts catalog Motor events; failure/success payloads (`SessionStartFailed`, `StateExportFailed`, `SidecarFaulted`, NavigateRejected) require `errorCode`/`phase` (missing property = fail).
- `DiagnosticsEndpointsTests` — elevate audit; `POST /recover` clears Degraded and emits `Diagnostics.Recovered`.
- `MsgPackHubContractTests` + Vitest session identity / status payload — camelCase hub wire (`[Key("…")]` + `MotorHubMessagePack.Options`).

---

## Deferred from PR required CI

| ID | Item | Notes |
|----|------|-------|
| K4 | ACME / DNS | MATRIX depth `deferred-K4` — manual or nightly only |

---

## Related

- [engineering-standards.md](engineering-standards.md) — testing and CI constitution  
- [diagnostics.md](diagnostics.md) — Act→Assert cookbook  
- [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md) — coverage truth  
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — local gates and PR expectations  
