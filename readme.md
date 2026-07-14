# Speculum

[![CI](https://github.com/rpjax/websete-speculum/actions/workflows/ci.yml/badge.svg)](https://github.com/rpjax/websete-speculum/actions/workflows/ci.yml)
[![Perf](https://github.com/rpjax/websete-speculum/actions/workflows/perf.yml/badge.svg)](https://github.com/rpjax/websete-speculum/actions/workflows/perf.yml)

**Remote browser isolation** for the Websete (W7S) platform. A real Chromium instance runs on the server; users interact through a low-latency JPEG screencast in a React canvas. Runtime motor configuration lives in **SQLite** and is managed through the Admin API and admin UI.

> **Development status:** Speculum **V1.0.0** is **in active development** — not released yet. There are no semver tags, release branches, or changelog entries until launch is announced. The codebase does **not** carry backward-compatibility bridges; config/API shape changes are allowed until then.

---

## Table of contents

- [Quick start](#quick-start)
- [Repository map](#repository-map)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Admin API](#admin-api)
- [Development](#development)
- [Deploy](#deploy)
- [Verification](#verification)
- [Documentation index](#documentation-index)

---

## Quick start

### Option A — Full stack with dockup (recommended)

Prerequisites: [Docker](https://docs.docker.com/get-docker/), [Node.js 22+](https://nodejs.org/) (for dockup CLI).

```bash
npm install -g @rodrigopjax/dockup   # >= 2.0.2

cd deploy
cp speculum.dockup.example.json speculum.dockup.json
# Edit domains if needed (defaults work for local dev)

dockup validate -c speculum.dockup.example.json --root ..
dockup deploy --env dev --root ..
```

If you already copied to `speculum.dockup.json` (gitignored), `dockup validate --root ..` also works.

Open **http://speculum.localhost:8080** — no TLS setup required (dev uses plain HTTP).

1. Copy the bootstrap API key from the `api` container logs, or use **`password`** in dockup dev (`ADMIN_BOOTSTRAP_KEY`). If login fails after changing the key, run `docker compose down -v` in `out/dev` and redeploy.
2. Go to **/admin** and sign in.
3. Configure **Hosting** (motor domain) and **Forwarding** (target site apex + navigation domains) and **MaxSessions**.
4. Open **/** to start the virtual browser.

Full deploy guide: [deploy/README.md](deploy/README.md).

### Option B — Local development (three terminals)

```bash
# Terminal 1 — sidecar
cd sidecar && npm ci && npm run build && npm start

# Terminal 2 — API
cd Speculum.Api && dotnet run

# Terminal 3 — web
cd web && cp .env.example .env && npm ci && npm run dev
```

Set `VITE_API_URL` only for cross-origin dev (optional). Default empty = same-origin relative `/api` and `/vhub`. Ensure API CORS includes your dev origin (default `http://localhost:5173` in Development).

---

## Repository map

```
Speculum/
├── Speculum.Api/           # .NET 10 API (+ Dockerfile → speculum-api)
├── Speculum.Api.Tests/     # Integration and unit tests
├── web/                    # React SPA (+ Dockerfile → speculum-web)
├── sidecar/                # Chrome sidecar (+ Dockerfile → speculum-sidecar)
├── deploy/                 # dockup config (canonical deploy path)
│   ├── speculum.dockup.example.json
│   └── compose/            # Optional reference docker-compose
├── docs/                   # Architecture and motor reference
├── Speculum.sln
└── .github/workflows/ci.yml
```

| Artifact | Purpose |
|----------|---------|
| `deploy/speculum.dockup.json` | Your local dockup config (gitignored; copy from example) |
| `deploy/out/{dev,prod}/` | Generated compose stacks (gitignored) |

---

## Architecture

```
Browser  →  Traefik (EdgeSynchronizer routes)
              ├─ PathPrefix /api, /vhub, …  →  speculum-api
              └─ default                    →  speculum-web (React)
                                            →  sidecar (internal)
```

| Layer | Role |
|-------|------|
| **Traefik** | Host-based routing (HTTP in dev, HTTPS in prod) |
| **speculum-web** | Motor `/`, setup `/setup`, admin `/admin/*` |
| **Speculum.Api** | Sessions, config store, frame relay, OpenAPI |
| **Sidecar** | Xvfb + Chrome + navigation guard + JPEG frames |

**Dev:** Traefik on port **8080** (HTTP). Same-origin — web, `/api`, and `/vhub` share one host. Virgin VPS: `http://<IP>/admin`.

Deep dive: [docs/architecture.md](docs/architecture.md) · Motor internals: [docs/motor-reference.md](docs/motor-reference.md)

---

## Configuration

### Infrastructure (environment — API will not start without these)

| Key | Description |
|-----|-------------|
| `HttpAddress` | Kestrel listen address (e.g. `0.0.0.0:8080`) |
| `Database__Path` | SQLite path (e.g. `/data/speculum.db`) |
| `Sidecar__BaseUrl` | Sidecar WebSocket (e.g. `ws://sidecar:3000`) |
| `Cors__AllowedOrigins` | Dev SPA origins (semicolon-separated) |
| `Traefik__Root` / `Traefik__DynamicDir` | EdgeSynchronizer materialization paths |
| `ASPNETCORE_ENVIRONMENT` | `Development` or `Production` |
| `SPECULUM_DIAGNOSTICS_PROFILE` | Optional first-boot Diagnostics seed when the SQLite `Diagnostics` section is absent. Set to `Assertive` for CI or integration environments that need full observability defaults (BrowserQuery domains, tight budgets). Otherwise seeds follow `ASPNETCORE_ENVIRONMENT` (`Development` / `Production`). |

Motor domains and TLS are configured in Admin → **Hosting** (SQLite), not container env.

### Motor runtime (SQLite — via admin UI or REST)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | Target site apex + navigation allowlist |
| `MaxSessions` | Yes | Concurrent session limit |
| `Hosting` | No | Per-domain TLS, mirroring, Cloudflare (Admin → Hosting) |
| `ScriptInjection` | No | `{ scriptId }` or `{ url }` entries |
| `SessionPolicy` | No | `{ "ttlDays": 30 }` |
| `JsBridge` | No | `{ "enable": true \| false }` |
| `Diagnostics` | No | Observability levels, storage budgets, probe limits (seeded on first boot; see `SPECULUM_DIAGNOSTICS_PROFILE`) |

When not operational, the motor redirects to `/setup`.

### Admin authentication

`Admin.apiKey` is seeded on first database creation. Override before first boot with `ADMIN_BOOTSTRAP_KEY`. The full key is logged in Development; Production logs a prefix only.

### Session persistence

- Client: cookie `speculum_client_token` (host-only in apex+NSO mode; `.<profile.domain>` when mirroring operational)
- Server: Tier 4 browser state in SQLite (`browser_sessions` + cookies, localStorage, IndexedDB, history tables)
- `StartSessionAsync(clientUrl, w, h, SessionIdentity?)` returns the effective client token for the cookie
- **URL is never persisted** — only browser state crosses sessions

---

## Admin API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Process alive |
| `GET /ready` | Public | Motor configured and ready |
| `GET /api/admin/config/status` | Public | `{ operational, missing, hosting.profiles }` — per-profile mirroring status |
| `GET /api/public/client-config` | Public | Hosting profiles, mirroring flags, NSO param name |
| `GET/PUT/DELETE /api/admin/config/{section}` | Bearer | Runtime config sections (see below) |
| `GET/DELETE /api/admin/sessions[/{sessionId}]` | Bearer | Session metadata and browser state drill-down |
| `GET/POST/DELETE /api/admin/scripts[/{id}]` | Bearer | Injected script CRUD |

OpenAPI (protected): `/openapi/v1.json`

**Config `{section}` names** are exact PascalCase literals: `Admin`, `Forwarding`, `MaxSessions`, `ScriptInjection`, `SessionPolicy`, `JsBridge`, `Hosting`. Other spellings (e.g. `sessionpolicy`, `SnapshotPolicy`) return `400` / `404`.

**Public surfaces:** `/health`, `/ready`, `/api/admin/config/status`, `/vhub` (SignalR negotiate). Restrict edge exposure in production as needed.

Example requests: `Speculum.Api/Speculum.Api.http`

---

## Development

### Prerequisites

| Tool | Version |
|------|---------|
| [.NET SDK](https://dotnet.microsoft.com/download) | 10.0.x |
| [Node.js](https://nodejs.org/) | 22.x |
| Docker | Latest (for dockup / sidecar image) |

### Run tests and builds

```bash
# Fast gate (no Chrome / no sidecar Docker)
dotnet test Speculum.sln -c Release --filter "Category!=MotorAssertive"
cd sidecar && npm ci && npm test
cd web && npm ci && npm test && npm run lint && npm run build
```

CI also runs the required **`motor-assertive`** job (fixture + sidecar Chromium) on GitHub Actions only — see [docs/diagnostics.md](docs/diagnostics.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Do not treat that stack as day-to-day local QA.

Intentional failing traps (MsgPack camelCase / hardened asserts) until the hotfix plan: [docs/known-red-ci.md](docs/known-red-ci.md).

### Component READMEs

- [Speculum.Api/README.md](Speculum.Api/README.md)
- [web/README.md](web/README.md)
- [sidecar/README.md](sidecar/README.md)

---

## Deploy

**Canonical path:** [dockup](https://github.com/rpjax/npm-dockup) from `deploy/`.

```bash
cd deploy
dockup deploy --env dev --root ..    # local HTTP on :8080
dockup deploy --env prod --root ..   # Let's Encrypt on :443
```

Production VPS workflow: generate `out/prod/`, copy to server, `docker compose up -d`. Details in [deploy/README.md](deploy/README.md).

An optional hand-maintained compose file lives at [deploy/compose/docker-compose.reference.yml](deploy/compose/docker-compose.reference.yml) for environments without dockup.

CI-only motor assert stack (Chrome): [deploy/compose/docker-compose.motor-assert.yml](deploy/compose/docker-compose.motor-assert.yml).

---

## Verification

After changes, run the **fast gate** (no Chrome):

```bash
dotnet test Speculum.sln -c Release --filter "Category!=MotorAssertive"
cd sidecar && npm test
cd web && npm run lint && npm test && npm run build
```

For dockup stacks: `dockup validate --root ..` before deploy (requires **dockup >= 2.0.2**).

Full motor assert (fixture + Chromium) runs only in GitHub Actions job `motor-assertive`.
---

## Documentation index

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Documentation hub |
| [docs/architecture.md](docs/architecture.md) | System design and security |
| [docs/motor-reference.md](docs/motor-reference.md) | Protocol, forwarding, sessions |
| [deploy/README.md](deploy/README.md) | dockup workflow (dev + prod) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute and code standards |

Legacy W7 Go engine docs (archived): [docs/archive/w7-go-engine.md](docs/archive/w7-go-engine.md)

---

## License and notice

Speculum is part of the Websete platform. Use only on systems and domains you are authorized to operate. Remote browser isolation does not replace legal, contractual, or organisational security controls.
