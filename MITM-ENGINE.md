# Websete Speculum — Motor Reference

Internal reference for architecture, data flow, navigation guard, and configuration.

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ User browser                                                              │
│   SignalR /vhub  —  control + frame/console/status streams               │
│   GET /          —  index.html (canvas) or redirect to /setup            │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTP (Traefik terminates TLS)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Container: app (.NET 10)                                                  │
│  BootstrapConfig     — HttpAddress, Database, Sidecar (env only)           │
│  ISpeculumConfigStore — SQLite runtime config + in-memory snapshot         │
│  VirtualizationHub   — StartSessionAsync, streams                          │
│  VSession            — sidecar relay, per-session config snapshot          │
│  SidecarClient       — WebSocket to sidecar                                │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ ws://sidecar:3000
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Container: sidecar (Node.js + Patchright)                                  │
│  Chrome (non-headless) → CDP Page.startScreencast → MSG_SCREENCAST 0x08  │
│  allowedNavigationDomains guard on main-frame Document requests only       │
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

**Admin section (SQLite, factory seed):** `Admin` with `{ "apiKey": "password" }` on first boot only.

Boot algorithm:
1. If DB empty → seed `Admin` with factory key
2. Load all sections from DB into memory (NULL if absent)
3. No appsettings seed for motor sections

Operational requires: `Forwarding` (host + domains), `MaxSessions`.

Admin API: `PUT/GET/DELETE /api/admin/config/{section}` with `Authorization: Bearer {Admin.apiKey}`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

Changing `Forwarding` kills all active sessions.

---

## 4. Session lifecycle

1. Client connects SignalR, calls `StartSessionAsync(window.location.href)` — **required**
2. Hub checks `IsOperational`, `MaxSessions`, builds initial URL via `InitialUrlBuilder`
3. `VSession` snapshot: scripts, jsBridge, `allowedNavigationDomains`
4. Sidecar: Xvfb → Chrome → screencast → frames
5. Input JSON → CDP; URL updates via `MSG_URL 0x04` (real URLs, no rewrite)
6. Disconnect → session stopped

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
- `GET /` → 302 `/setup`
- `/setup` — static page listing missing sections
- `/libs/*`, `/health`, `/ready`, `/api/admin/config/status` — always available
- `/vhub` — connects; `StartSessionAsync` throws `HubException`

---

## 7. Docker compose

Services: `traefik` (ACME), `sidecar`, `app` (volume `speculum-data:/data`).

Env: `TRAEFIK_DOMAIN`, `ACME_EMAIL`, `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `ASPNETCORE_ENVIRONMENT`.
