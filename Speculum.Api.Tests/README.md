# Speculum.Api.Tests

Automated tests for `Speculum.Api` — config store, SSRF guard, HostMapper, browser session store, EdgeTls writer, viewport validation, and HTTP smoke tests via `WebApplicationFactory`.

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
| `SmokeTests.cs` | Health, readiness, CORS, public client-config |
| `ConfigStoreTests.cs` | Validators, HostMapper modes, subdomain evaluator, EdgeTlsWriter |
| `DynamicCorsPolicyProviderTests.cs` | CORS apex vs subdomain mirroring modes |
| `ConfigStoreSeedTests.cs` | Admin bootstrap seeding |
| `SsrfGuardTests.cs` | Private IP blocking for script URLs |
| `MotorPlanTests.cs` | BrowserSessionStore, ClientTokenNormalizer, HostMapper |
| `ViewportDimensionsTests.cs` | Viewport parsing |

Integration host entry point: `Speculum.Api/Program.Integration.cs` (partial `Program` for test visibility).

See [../Speculum.Api/README.md](../Speculum.Api/README.md) and [../CONTRIBUTING.md](../CONTRIBUTING.md).
