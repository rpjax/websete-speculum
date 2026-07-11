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
| `ScriptInjection` | No | Array of `{ scriptId }` (DB upload) or `{ url }` (external, SSRF-guarded) |
| `SnapshotPolicy` | No | `{ "ttlDays": 30 }` — browser profile snapshot TTL |
| `JsBridge` | No | `{ "enable": true\|false }` — NULL means disabled |

On first boot the motor is **not operational** until `Forwarding` and `MaxSessions` are configured via Admin API.

### 3. Admin auth (SQLite — factory seed)

On first boot, section `Admin` is seeded with a random `apiKey` (printed to container logs). Override with env `ADMIN_BOOTSTRAP_KEY`. Change it via `PUT /api/admin/config/Admin`.

When required motor sections are missing, `/` redirects to `/setup`.

### 4. Session persistence (cookie + SQLite BLOB)

- Cookie `speculum_sid` (HttpOnly) identifies returning visitors.
- On disconnect, the sidecar tar.gz's the Chrome profile; the host stores it in `browser_snapshots`.
- **Multi-tab merge:** profiles are merged per file path — complementary files are kept; same path conflicts use last-write-wins (mtime). Volatile Chrome caches are excluded.
- `last_url` uses last-write-wins by disconnect timestamp.
- TTL configurable via `SnapshotPolicy` (default 30 days). Admin: `GET/DELETE /api/admin/snapshots`.

---

## Admin API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Process alive |
| `GET /ready` | Public | Config complete |
| `GET /api/admin/config/status` | Public | `{ operational, missing }` |
| `GET/PUT/DELETE /api/admin/config/{section}` | Bearer | Manage runtime config |
| `GET/DELETE /api/admin/snapshots[/{cookieId}]` | Bearer | Snapshot metadata (no blob) |
| `GET/POST/DELETE /api/admin/scripts[/{id}]` | Bearer | Upload/list injected scripts |

Bootstrap API key: check container logs on first boot, or set `ADMIN_BOOTSTRAP_KEY`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

OpenAPI (protected): `/openapi/v1.json`

**Public motor surface:** `GET /`, `/vhub`, `/libs/*`, `/js/*`, `/workers/*`, `/health`, `/ready`, `/setup`, `GET /api/admin/config/status`.

**Sidecar:** internal Docker network only — do not publish port 3000 on Traefik.

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

Infra env vars are in `Properties/launchSettings.json`. DB file: `data/speculum.db`. Configure motor sections via Admin API (bootstrap key from logs or `ADMIN_BOOTSTRAP_KEY`).

### Client libs (`wwwroot/libs/`)

Self-hosted SignalR + MessagePack (no CDN). Only these files belong in `wwwroot/libs/`:

- `signalr.min.js`
- `signalr-protocol-msgpack.min.js`

Refresh from npm when upgrading (do **not** commit `package/` or `.tgz` residue):

```bash
cd Websete.Speculum.Host/wwwroot/libs
npm pack @microsoft/signalr@10.0.0
npm pack @microsoft/signalr-protocol-msgpack@10.0.0
tar -xf microsoft-signalr-10.0.0.tgz package/dist/browser/signalr.min.js
tar -xf microsoft-signalr-protocol-msgpack-10.0.0.tgz package/dist/browser/signalr-protocol-msgpack.min.js
mv package/dist/browser/signalr.min.js .
mv package/dist/browser/signalr-protocol-msgpack.min.js .
rm -rf package *.tgz
# Recompute SRI for index.html: certutil -hashfile <file> SHA256 → sha256-<hex>
```
