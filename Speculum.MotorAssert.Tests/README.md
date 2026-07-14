# Speculum.MotorAssert.Tests

Act→Assert harness for the **motor-assertive** GitHub Actions job (real sidecar + Chromium).

## Local behaviour

Without `MOTOR_ASSERT_API_BASE`, every `[MotorAssertFact]` is **skipped**. Safe to include in `dotnet test Speculum.sln` with `--filter Category!=MotorAssertive&Category!=MotorPerf` for the fast gate.

## Layout

- Helpers: `MotorActClient`, `DiagnosticsAssertClient` (`Expect*` / `Require*`), `MotorAssertHost`, `MotorAssertTokens`
- Deep suites: `LifecycleDeepTests`, `NavigationDeepTests`, `PersistenceDeepTests`, `ScriptsDeepTests`, `DiagnosticsEdgeDeepTests`
- Matrix inventory (Depth column): [MATRIX.md](MATRIX.md)
- Fixture pages: [`tests/motor-fixture/`](../tests/motor-fixture/)

## Perf sibling

Capacity/SLO checks live in `Speculum.MotorPerf.Tests` + [`.github/workflows/perf.yml`](../.github/workflows/perf.yml) (informational badge — not a required check).

## CI

See [docs/diagnostics.md](../docs/diagnostics.md) and [deploy/compose/docker-compose.motor-assert.yml](../deploy/compose/docker-compose.motor-assert.yml).

Do not run this stack routinely on a developer laptop.
