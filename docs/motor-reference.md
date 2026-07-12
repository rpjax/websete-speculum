# Motor reference

> Internal technical reference for session lifecycle, forwarding rules, configuration store behaviour, and the sidecar binary protocol.  
> For system-level design, see [architecture.md](architecture.md). For operations, see [../deploy/README.md](../deploy/README.md).

**Speculum (W7S)** — remote browser isolation engine.

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ User browser — speculum-web (React)                                       │
│   /           — canvas motor (SignalR client)                           │
│   /admin/*    — admin panel (REST + Bearer)                               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS cross-origin
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ api.speculum.<domain> — Speculum.Api (.NET 10)                            │
│  BootstrapConfig + CORS                                                   │
│  ISpeculumConfigStore — SQLite runtime config                             │
│  VirtualizationHub — StartSessionAsync(sessionId?) → sessionId              │
│  VSession — sidecar relay                                                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ ws://sidecar:3000
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ sidecar (Node.js + Patchright)                                            │
│  Chrome → CDP screencast → MSG_SCREENCAST 0x08                            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Forwarding model

Runtime section `Forwarding`:

```json
{
  "host": "www.meu-site.com",
  "domains": ["meu-site.com", "*.meu-site.com"]
}
```

| Field | Purpose |
|-------|---------|
| `host` | FQDN only — motor opens `https://{host}{pathname}{search}` |
| `domains` | **Navigation** allowlist for main-frame Document requests |

`domains` does **not** restrict assets, `fetch`, XHR, or sub-frame documents.

Wildcard `*.example.com` matches subdomains only (not apex `example.com`).

External main-frame navigation → sidecar sends `MSG_REDIRECT 0x0A` → client `window.location.href`.

---

## 3. Configuration store

SQLite table `config_sections (key, value_json, updated_at)`.

**Infrastructure (env only):** `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `ASPNETCORE_ENVIRONMENT`.

**Motor sections (SQLite + Admin API):** `Forwarding`, `MaxSessions`, `ScriptInjection`, `JsBridge`.

**Admin section (SQLite, factory seed):** random `apiKey` on first boot (full key in dev logs; prefix only in production). Override with env `ADMIN_BOOTSTRAP_KEY` before first boot.

Boot algorithm:
1. If DB empty → seed `Admin` with random bootstrap key (or `ADMIN_BOOTSTRAP_KEY`)
2. Load all sections from DB into memory (NULL if absent)
3. No appsettings seed for motor sections

Operational requires: `Forwarding` (host + domains), `MaxSessions`.

Admin API: `PUT/GET/DELETE /api/admin/config/{section}` with `Authorization: Bearer {Admin.apiKey}`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

Changing `Forwarding` kills all active sessions.

---

## 4. Session lifecycle

1. React motor connects SignalR to `api` host `/vhub`
2. `StartSessionAsync(clientUrl, w, h, sessionId?)` returns effective `sessionId` (stored in `localStorage`)
3. Hub checks `IsOperational`, `MaxSessions`, loads snapshot by `sessionId`
4. Sidecar: Xvfb → Chrome → screencast → frames
5. Disconnect → profile captured and merged in SQLite

---

## 5. Binary protocol (sidecar → client)

| Type | Name | Payload |
|------|------|---------|
| 0x04 | URL update | UTF-8 URL |
| 0x05 | Console | level + message |
| 0x06 | Eval result | id + ok + value |
| 0x08 | Screencast | JPEG bytes |
| 0x09 | Status | JSON snapshot (1 s) |
| 0x0A | Redirect | UTF-8 URL (leave virtual browser) |

---

## 6. Setup mode

When not operational:
- React motor `fetch(/ready)` → redirect to `/setup`
- `/admin` — configure via UI (Bearer API key)
- `/health`, `/ready`, `/api/admin/config/status`, `/vhub` negotiate — public on API host
- `StartSessionAsync` throws `HubException` until configured

---

## 7. Docker and deploy

Services: `traefik`, `sidecar`, `api` (`speculum-api`), `web` (`speculum-web`).

**Canonical deploy:** [dockup](../deploy/README.md) from `deploy/` with `--root ..`.

Optional reference compose (without dockup): [deploy/compose/docker-compose.reference.yml](../deploy/compose/docker-compose.reference.yml).

Env: `TRAEFIK_MOTOR_DOMAIN`, `TRAEFIK_API_DOMAIN`, `Cors__AllowedOrigins`, `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`.
