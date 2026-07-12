# Speculum.Api.Tests

Automated tests for `Speculum.Api` — config store, SSRF guard, motor planning, snapshot merge, viewport validation, and HTTP smoke tests via `WebApplicationFactory`.

## Run

```bash
dotnet test Speculum.Api.Tests/Speculum.Api.Tests.csproj -c Release
```

Or the full solution:

```bash
dotnet test Speculum.sln -c Release
```

## Structure

| Test file | Focus |
|-----------|-------|
| `SmokeTests.cs` | Health, readiness, public admin status |
| `ConfigStoreTests.cs` | SQLite config CRUD and operational gate |
| `ConfigStoreSeedTests.cs` | Admin bootstrap seeding |
| `SsrfGuardTests.cs` | Private IP blocking for script URLs |
| `MotorPlanTests.cs` | Session / forwarding integration |
| `ProfileSnapshotMergerTests.cs` | Profile BLOB merge logic |
| `ViewportDimensionsTests.cs` | Viewport parsing |

Integration host entry point: `Speculum.Api/Program.Integration.cs` (partial `Program` for test visibility).

See [../Speculum.Api/README.md](../Speculum.Api/README.md) and [../CONTRIBUTING.md](../CONTRIBUTING.md).
