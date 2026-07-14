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

| Area | Focus |
|------|-------|
| `Diagnostics/Catalog/` | Event catalog stability (`SessionResolved`, `UrlMapped`, …) |
| `Diagnostics/Runtime/` | Levels, elevate floors, Off cost |
| `Diagnostics/Pipeline/` | Sink overflow / budgets |
| `Diagnostics/Redaction/` | Dev vs Prod redaction |
| `Diagnostics/Endpoints/` | REST v1 diagnostics API |
| `Diagnostics/Emitters/` | Payload shape contracts for new events |
| `Diagnostics/Contracts/` | **MsgPack hub traps** (known-red until hotfix) — see [docs/known-red-ci.md](../docs/known-red-ci.md) |
| Root `*Tests.cs` | Config, motor coordinator, URL adapter, smoke, wire protocol |

Integration host entry point: `Speculum.Api/Program.Integration.cs` (partial `Program` for test visibility).

See [../Speculum.Api/README.md](../Speculum.Api/README.md), [../docs/diagnostics.md](../docs/diagnostics.md), and [../CONTRIBUTING.md](../CONTRIBUTING.md).
