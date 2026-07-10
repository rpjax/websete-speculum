# Websete.Speculum (W7S)

**Websete.Speculum** is a remote browser isolation engine. A real Chromium instance runs on the server; the user interacts with a low-latency JPEG screencast rendered in a `<canvas>`.

The motor is **domain-agnostic**: Traefik terminates TLS at the edge. Runtime configuration (target site, session limits, script injection) lives in a **local SQLite database**, managed via Admin API.

---

## Architecture

```
Browser  →  Traefik (TLS)  →  .NET Host (:8080 HTTP)
                                  ├─ SignalR /vhub (control + streams)
                                  ├─ Admin API /api/admin/config/*
                                  └─ SQLite (runtime config)
                              →  Sidecar (Chrome + CDP screencast)
```

| Layer | Role |
|-------|------|
| **Traefik** | HTTPS, Let's Encrypt, routes to `app:8080` |
| **.NET Host** | Sessions, config store, frame relay, setup page |
| **Sidecar** | Xvfb + Chrome + navigation guard + JPEG frames |
| **Client** | `index.html` — canvas renderer + SignalR |

---

## Configuration

Three layers:

### 1. Infrastructure (env only — required to start)

| Key | Description |
|-----|-------------|
| `HttpAddress` | Kestrel listen address (e.g. `0.0.0.0:8080`) |
| `Database__Path` | SQLite file path (e.g. `/data/speculum.db`) |
| `Sidecar__BaseUrl` | WebSocket URL (e.g. `ws://sidecar:3000`) |
| `ASPNETCORE_ENVIRONMENT` | `Development` or `Production` |

`appsettings.json` contains only `Logging` and `AllowedHosts`.

### 2. Runtime motor (SQLite — source of truth)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | `host` (FQDN) + `domains` (navigation allowlist, supports `*.`) |
| `MaxSessions` | Yes | Concurrent session limit |
| `ScriptInjection` | No | Array of `{ file }` or `{ source }` entries |
| `JsBridge` | No | `{ "enable": true\|false }` — NULL means disabled |

On first boot the motor is **not operational** until `Forwarding` and `MaxSessions` are configured via Admin API.

### 3. Admin auth (SQLite — factory seed)

On first boot, section `Admin` is seeded with `{ "apiKey": "password" }`. Change it via `PUT /api/admin/config/Admin`.

When required motor sections are missing, `/` redirects to `/setup`.

---

## Admin API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Process alive |
| `GET /ready` | Public | Config complete |
| `GET /api/admin/config/status` | Public | `{ operational, missing }` |
| `GET/PUT/DELETE /api/admin/config/{section}` | Bearer | Manage runtime config |

Default Bearer token on first boot: `password`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

OpenAPI: `/openapi/v1.json`

---

## Docker

Quick local stack (build from source):

```bash
export TRAEFIK_DOMAIN=speculum.example.com
export ACME_EMAIL=admin@example.com
docker compose up -d
```

### Build and deploy (dockup)

Production-oriented build, push, and compose artifacts via [dockup](deploy/README.md) v2:

```bash
npm install -g @rodrigopjax/dockup   # >= 2.0.1
cd deploy
cp speculum.dockup.example.json speculum.dockup.json
dockup validate --root ..
dockup deploy --env prod --root ..
```

| Environment | Default host | TLS | Published ports |
|-------------|--------------|-----|-----------------|
| `dev` | `speculum.websete.localhost` | Self-signed | `8080` (HTTP), `8443` (HTTPS) |
| `prod` | `speculum.websete.org` | Let's Encrypt | `80`, `443` |

Copy `deploy/out/prod/` to the VPS, then `docker compose pull && docker compose up -d`. See [deploy/README.md](deploy/README.md) for details.

---

## Local development

```bash
# Terminal 1 — sidecar
cd sidecar && npm run build && node dist/index.js

# Terminal 2 — host
cd Websete.Speculum.Host
dotnet run
```

Infra env vars are in `Properties/launchSettings.json`. DB file: `data/speculum.db`. Configure motor sections via Admin API (`Bearer password` on first boot).
