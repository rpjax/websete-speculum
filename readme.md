# Websete.Speculum (W7S)

**Websete.Speculum** is a remote browser isolation engine. A real Chromium instance runs on the server; the user interacts with a low-latency JPEG screencast rendered in a `<canvas>`.

The motor is **domain-agnostic**: Traefik terminates TLS at the edge. Runtime configuration (target site, session limits, script injection) lives in a **local SQLite database**, seeded once from `appsettings.json` on first boot.

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

### Bootstrap (appsettings / env — required to start)

| Key | Description |
|-----|-------------|
| `HttpAddress` | Kestrel listen address (e.g. `0.0.0.0:8080`) |
| `Database:Path` | SQLite file path (e.g. `/data/speculum.db`) |
| `Sidecar:BaseUrl` | WebSocket URL (e.g. `ws://sidecar:3000`) |
| `Admin:ApiKey` | Bearer token for admin API |

### Runtime (SQLite — source of truth)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | `host` (FQDN) + `domains` (navigation allowlist, supports `*.`) |
| `MaxSessions` | Yes | Concurrent session limit |
| `Environment` | Yes | `Dev` or `Prod` |
| `ScriptInjection` | No | Array of `{ file }` or `{ source }` entries |
| `JsBridge` | No | `{ "enable": true\|false }` — NULL means disabled |

**Seed rule:** on boot, if a DB section is NULL and `appsettings` has a value, it is written to the DB once. `appsettings` never overwrites existing DB values.

When required sections are missing, `/` redirects to `/setup`.

---

## Admin API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Process alive |
| `GET /ready` | Public | Config complete |
| `GET /api/admin/config/status` | Public | `{ operational, missing }` |
| `GET/PUT/DELETE /api/admin/config/{section}` | Bearer | Manage runtime config |

OpenAPI: `/openapi/v1.json`

---

## Docker

```bash
export TRAEFIK_DOMAIN=speculum.example.com
export ACME_EMAIL=admin@example.com
export ADMIN_API_KEY=your-secret-key
docker compose up -d
```

---

## Local development

```bash
# Terminal 1 — sidecar
cd sidecar && npm run build && node dist/index.js

# Terminal 2 — host
cd Websete.Speculum.Host
dotnet run
```

Default `appsettings.json` seeds OLX forwarding on first run. DB file: `data/speculum.db`.
