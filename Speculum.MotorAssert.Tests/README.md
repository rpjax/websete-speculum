# Speculum.MotorAssert.Tests

Act→Assert harness for the **motor-assertive** GitHub Actions job (real sidecar + Chromium).

## Local behaviour

Without `MOTOR_ASSERT_API_BASE`, every `[MotorAssertFact]` is **skipped**. Safe to include in `dotnet test Speculum.sln` with `--filter Category!=MotorAssertive` for the fast gate.

## Layout

- Helpers: `MotorActClient` (SignalR `/vhub` + input/frame/status/console channels), `DiagnosticsAssertClient`, `MotorAssertHost`, `MotorAssertTokens`
- Matrix inventory: [MATRIX.md](MATRIX.md)
- Fixture pages: [`tests/motor-fixture/`](../tests/motor-fixture/)

## CI

See [docs/diagnostics.md](../docs/diagnostics.md) § Phase 3 and [deploy/compose/docker-compose.motor-assert.yml](../deploy/compose/docker-compose.motor-assert.yml).

Do not run this stack routinely on a developer laptop.
