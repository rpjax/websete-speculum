# Speculum.Api.Tests

Automated tests for `Speculum.Api` — config store, SSRF guard, HostMapper, browser session store, EdgeSynchronizer, sidecar wire protocol, viewport validation, and HTTP smoke tests via `WebApplicationFactory`.

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
| `SmokeTests.cs` | Health, readiness, CORS, public client-config (`SpeculumIntegrationTestCollection`, shared `WebApplicationFactory`) |
| `ConfigStoreTests.cs` | Validators, HostMapper modes, EdgeWriter boot wrapper, hosting evaluator |
| `ConfigSectionRepositoryTests.cs` | Atomic config section upsert |
| `ConfigServicePipelineTests.cs` | ConfigService PUT pipeline (drain/sync ordering) |
| `ConfigPipelineTests.cs` | PreReload drain / PostReload edge sync handlers |
| `MotorSessionCoordinatorTests.cs` | Session start, slot limits, navigation |
| `MotorUrlAdapterTests.cs` | URL mapping, mirroring modes, navigation state |
| `DynamicCorsPolicyProviderTests.cs` | CORS apex vs subdomain mirroring modes |
| `ConfigStoreSeedTests.cs` | Admin bootstrap seeding |
| `SsrfGuardTests.cs` | Private IP blocking for script URLs |
| `SidecarInputGuardTests.cs` | Sidecar input validation |
| `SidecarWireProtocolTests.cs` | Binary frame encode/decode layout |
| `MotorPlanTests.cs` | BrowserSessionStore, ClientTokenNormalizer, HostMapper |
| `ViewportDimensionsTests.cs` | Viewport parsing |

Integration host entry point: `Speculum.Api/Program.Integration.cs` (partial `Program` for test visibility).

See [../Speculum.Api/README.md](../Speculum.Api/README.md) and [../CONTRIBUTING.md](../CONTRIBUTING.md).
