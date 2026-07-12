# Speculum.Api

ASP.NET Core **API-only** backend for Speculum. Hosts the SignalR virtualization hub, Admin REST API, SQLite configuration store, and sidecar WebSocket relay. There is no static file hosting — the React client runs as a separate service.

---

## Table of contents

- [Responsibilities](#responsibilities)
- [Project layout](#project-layout)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Run locally](#run-locally)
- [HTTP surface](#http-surface)
- [Key types](#key-types)
- [Tests](#tests)
- [Docker image](#docker-image)

---

## Responsibilities

| Concern | Implementation |
|---------|----------------|
| Session orchestration | `VirtualizationHub` → `VSessionRegistry` → `VSession` |
| Sidecar communication | `SidecarClient` WebSocket to Patchright sidecar |
| Runtime config | `SpeculumConfigStore` + SQLite `config_sections` |
| Browser state persistence | `BrowserSessionStore` — Tier 4 CDP export (cookies, LS, IDB, history) |
| Subdomain mirroring | `HostMapper`, `EdgeWriter`, `MotorUrlAdapter`, `DynamicCorsPolicyProvider` (per Hosting profile) |
| Script injection | `InjectedScriptStore`, `ScriptResolver` (SSRF-safe HTTP) |
| Admin auth | `AdminAuthMiddleware` — Bearer `Admin.apiKey` |
| Graceful shutdown | `GracefulShutdownHostedService` — drains sessions |

---

## Project layout

```
Speculum.Api/
├── Admin/                    AdminEndpoints, AdminAuthMiddleware
├── Config/
│   ├── Bootstrap/            Env-only BootstrapConfig
│   ├── Persistence/          EF/SQLite entities
│   ├── Runtime/              Section DTOs (Forwarding, MaxSessions, …)
│   ├── Scripts/              ScriptResolver
│   └── Store/                SpeculumConfigStore, SsrfGuard, validators
├── Hosting/                  EdgeWriter, TraefikReloader, DynamicCorsPolicyProvider, GracefulShutdown
├── Middleware/               SecurityHeadersMiddleware
├── Scripts/                  Injected script persistence
├── Virtualization/
│   ├── Presentation/         VirtualizationHub (SignalR)
│   ├── Sidecar/              SidecarClient
│   ├── Persistence/          BrowserSessionStore
│   └── …                     VSession, registry, models
├── Program.cs
├── Speculum.Api.http         REST examples for IDE / curl
└── appsettings*.json         Minimal; motor config is in SQLite
```

---

## Prerequisites

- [.NET SDK 10.0](https://dotnet.microsoft.com/download)
- Running [sidecar](../sidecar/README.md) at `Sidecar__BaseUrl`

---

## Configuration

Environment variables (required):

| Variable | Local example |
|----------|---------------|
| `HttpAddress` | `0.0.0.0:8080` |
| `Database__Path` | `./speculum.db` (or absolute path) |
| `Sidecar__BaseUrl` | `ws://127.0.0.1:3000` |
| `Cors__AllowedOrigins` | `http://localhost:5173` (optional; defaults include Vite + dockup dev) |
| `Traefik__Root` | `/data/traefik` (EdgeWriter output) |
| `Cors__AllowedOrigins` | Dev SPA origins (e.g. `http://localhost:5173`) |

Motor domains live in SQLite **`Hosting`**, not env.

Optional:

| Variable | Purpose |
|----------|---------|
| `ADMIN_BOOTSTRAP_KEY` | Fixed admin API key on first DB creation |
| `ASPNETCORE_ENVIRONMENT` | `Development` enables verbose bootstrap key logging |

Launch profile: see `Properties/launchSettings.json`.

---

## Run locally

```bash
cd Speculum.Api

# Ensure sidecar is running (see sidecar/README.md)
export HttpAddress=0.0.0.0:8080
export Database__Path=./speculum.db
export Sidecar__BaseUrl=ws://127.0.0.1:3000

dotnet run
```

API listens on `http://localhost:8080`. Pair with `web` dev server on port 5173.

---

## HTTP surface

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness (503 if motor not configured) |
| GET | `/api/admin/config/status` | Operational status (+ `hosting.profiles`, legacy `subdomainMirroring` aggregate) |
| GET | `/api/public/client-config` | Hosting profiles, mirroring flags, NSO param name |
| * | `/vhub` | SignalR hub (negotiate + WebSocket) |

### Protected (Bearer)

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT/DELETE | `/api/admin/config/{section}` | Config CRUD |
| GET/DELETE | `/api/admin/sessions[/{sessionId}]` | Session metadata and browser state |
| GET/POST/DELETE | `/api/admin/scripts[/{id}]` | Script upload (multipart `.js`, max 5 MB) |
| GET | `/openapi/v1.json` | OpenAPI document |

Config sections: `Hosting`, `Forwarding`, `MaxSessions`, `ScriptInjection`, `SessionPolicy` (`SnapshotPolicy` alias), `JsBridge`, `Admin`. Legacy `SubdomainMirroring` is deprecated — use `Hosting` profiles.

---

## Key types

| Type | Role |
|------|------|
| `BootstrapConfig` | Loads env; fails fast if required keys missing |
| `ISpeculumConfigStore` | Thread-safe config with `IsOperational` / `MissingRequired` |
| `VirtualizationHub` | `StartSessionAsync(clientUrl, w, h, SessionIdentity?)`, input relay, frame streaming |
| `IVSessionRegistry` | Session slots, promotion from starting → active |
| `SsrfGuard` | Blocks private/reserved IPs for script URL fetches |

Motor behaviour reference: [../docs/motor-reference.md](../docs/motor-reference.md).

---

## Tests

```bash
dotnet test ../Speculum.Api.Tests/Speculum.Api.Tests.csproj -c Release
```

Tests use `WebApplicationFactory` (`Program.Integration.cs`) for smoke, config store, SSRF, HostMapper, browser session store, and EdgeWriter coverage.

---

## Docker image

Built from this directory:

```bash
cd Speculum.Api
docker build -t speculum-api .
```

In composed stacks, the API container mounts a volume at `/data` for SQLite.

Deploy context: [../deploy/README.md](../deploy/README.md).
