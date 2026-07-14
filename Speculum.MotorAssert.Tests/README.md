# Speculum.MotorAssert.Tests

Act→Assert harness for the **motor-assertive** GitHub Actions job (real sidecar + Chromium).

Standards: [docs/engineering-standards.md](../docs/engineering-standards.md) §§3–4 · agents: [../AGENTS.md](../AGENTS.md) · inventory: [MATRIX.md](MATRIX.md) · red policy: [docs/known-red-ci.md](../docs/known-red-ci.md).

## Local behaviour

Without `MOTOR_ASSERT_API_BASE`, every `[MotorAssertFact]` is **skipped**. Safe to include in `dotnet test Speculum.sln` with `--filter "Category!=MotorAssertive&Category!=MotorPerf"` for the fast gate.

## Layout

| Piece | Role |
|-------|------|
| `MotorAssertFixture` / `MotorAssertTestBase` | Per-test `EnsureBaselineAsync` (shared compose isolation) |
| `MotorActClient` | SignalR Act (MessagePack hub) |
| `DiagnosticsAssertClient` | Assert (`Expect*` / `Require*` / `Wait*` poll helpers) |
| `MotorAssertHost` | Admin HTTP + config PUT |
| `MotorAssertTokens` | Deterministic 32-hex `clientToken` for persistence tests |
| Deep suites | `Lifecycle*`, `Navigation*`, `Persistence*`, `Scripts*`, `Diagnostics*` |
| Bug traps | `BugTraps/*` (rebind E8, UrlMapped B12) |
| Emitter recipes | `DiagnosticsGovernance/DiagnosticsEmitterRecipesTests` |

Fixture pages: [`tests/motor-fixture/`](../tests/motor-fixture/). Compose: [`deploy/compose/docker-compose.motor-assert.yml`](../deploy/compose/docker-compose.motor-assert.yml).

## Harness rules (summary)

- **Serial** collection — one stack; do not parallelize MotorAssert.
- **Baseline** before each test: MaxSessions, JsBridge, `POST …/recover` if degraded, Assertive Diagnostics verify.
- **Export:** `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)`.
- **ConfigApplied:** only after Diagnostics or Hosting PUT.
- **No** fixed sleeps as primary sync — poll events/probes.

Cookbook: [docs/diagnostics.md](../docs/diagnostics.md).

## Perf sibling

Capacity/SLO checks live in `Speculum.MotorPerf.Tests` + [`.github/workflows/perf.yml`](../.github/workflows/perf.yml) (informational badge — not a required check).

## CI

Job `motor-assertive` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): compose up → `seed-motor-assert.sh` → `dotnet test --filter Category=MotorAssertive`.

Do not run this stack routinely on a developer laptop.
