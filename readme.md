# Speculum

**Remote browser isolation** for the Websete (W7S) platform. A real Chromium instance runs on the server; users interact through a low-latency JPEG screencast in a React canvas. Runtime motor configuration lives in **SQLite** and is managed through the Admin API and admin UI.

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
npm install -g @rodrigopjax/dockup   # >= 2.0.1

cd deploy
cp speculum.dockup.example.json speculum.dockup.json
# Edit domains if needed (defaults work for local dev)

dockup validate --root ..
dockup deploy --env dev --root ..
```

Open **https://speculum.localhost:8443** (accept the self-signed certificate).

1. Copy the bootstrap API key from the `api` container logs.
2. Go to **/admin** and sign in.
3. Configure **Forwarding** (target site apex + navigation domains) and **MaxSessions**.
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

Set `VITE_API_URL=http://localhost:8080` in `web/.env`. Ensure API CORS includes `http://localhost:5173` (default when `Cors__AllowedOrigins` is unset in Development).

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
Browser  →  Traefik (TLS)
              ├─ TRAEFIK_MOTOR_DOMAIN   →  speculum-web (React)
              └─ TRAEFIK_API_DOMAIN     →  speculum-api
                                            ├─ SignalR /vhub
                                            ├─ Admin /api/admin/*
                                            └─ SQLite
                                          →  sidecar (internal)
```

| Layer | Role |
|-------|------|
| **Traefik** | HTTPS termination, host-based routing |
| **speculum-web** | Motor `/`, setup `/setup`, admin `/admin/*` |
| **Speculum.Api** | Sessions, config store, frame relay, OpenAPI |
| **Sidecar** | Xvfb + Chrome + navigation guard + JPEG frames |

**Dev hostnames:** `speculum.localhost` (web) and `api.speculum.localhost` (API) on port **8443**.

Deep dive: [docs/architecture.md](docs/architecture.md) · Motor internals: [docs/motor-reference.md](docs/motor-reference.md)

---

## Configuration

### Infrastructure (environment — API will not start without these)

| Key | Description |
|-----|-------------|
| `HttpAddress` | Kestrel listen address (e.g. `0.0.0.0:8080`) |
| `Database__Path` | SQLite path (e.g. `/data/speculum.db`) |
| `Sidecar__BaseUrl` | Sidecar WebSocket (e.g. `ws://sidecar:3000`) |
| `Cors__AllowedOrigins` | Semicolon-separated SPA origins |
| `ASPNETCORE_ENVIRONMENT` | `Development` or `Production` |

### Motor runtime (SQLite — via admin UI or REST)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | `host` (target apex FQDN) + `domains` (navigation allowlist) |
| `MaxSessions` | Yes | Concurrent session limit |
| `ScriptInjection` | No | `{ scriptId }` or `{ url }` entries |
| `SnapshotPolicy` | No | `{ "ttlDays": 30 }` |
| `JsBridge` | No | `{ "enable": true \| false }` |

When not operational, the motor redirects to `/setup`.

### Admin authentication

`Admin.apiKey` is seeded on first database creation. Override before first boot with `ADMIN_BOOTSTRAP_KEY`. The full key is logged in Development; Production logs a prefix only.

### Session persistence

- Client: `localStorage` key `speculum_session_id`
- Server: Chrome profile snapshots in SQLite (`browser_snapshots`)
- `StartSessionAsync(clientUrl, w, h, sessionId?)` returns the effective `sessionId`

---

## Admin API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Process alive |
| `GET /ready` | Public | Motor configured and ready |
| `GET /api/admin/config/status` | Public | `{ operational, missing }` |
| `GET/PUT/DELETE /api/admin/config/{section}` | Bearer | Runtime config sections |
| `GET/DELETE /api/admin/snapshots[/{sessionId}]` | Bearer | Snapshot metadata |
| `GET/POST/DELETE /api/admin/scripts[/{id}]` | Bearer | Injected script CRUD |

OpenAPI (protected): `/openapi/v1.json`

**Public surfaces:** `/health`, `/ready`, `/api/admin/config/status`, `/vhub` (SignalR negotiate). Protect the API host at the edge in production as needed.

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
dotnet test Speculum.sln -c Release
cd sidecar && npm ci && npm test
cd web && npm ci && npm run lint && npm run build
```

CI runs the same matrix on push/PR to `main` / `master` (see `.github/workflows/ci.yml`).

### Component READMEs

- [Speculum.Api/README.md](Speculum.Api/README.md)
- [web/README.md](web/README.md)
- [sidecar/README.md](sidecar/README.md)

---

## Deploy

**Canonical path:** [dockup](https://github.com/rpjax/npm-dockup) from `deploy/`.

```bash
cd deploy
dockup deploy --env dev --root ..    # local HTTPS on :8443
dockup deploy --env prod --root ..   # Let's Encrypt on :443
```

Production VPS workflow: generate `out/prod/`, copy to server, `docker compose up -d`. Details in [deploy/README.md](deploy/README.md).

An optional hand-maintained compose file lives at [deploy/compose/docker-compose.reference.yml](deploy/compose/docker-compose.reference.yml) for environments without dockup.

---

## Verification

After changes, run:

```bash
dotnet test Speculum.sln -c Release
cd sidecar && npm test
cd web && npm run lint && npm run build
```

For dockup stacks: `dockup validate --root ..` before deploy.

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
