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
│  BootstrapConfig + CORS (dynamic when subdomain mirroring ON)             │
│  ISpeculumConfigStore — SQLite runtime config                             │
│  VirtualizationHub — StartSessionAsync(clientUrl, w, h, clientToken)      │
│  BrowserSessionStore — Tier 4 state (cookies, LS, IDB, history)           │
│  VSession — sidecar relay                                                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ ws://sidecar:3000
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ sidecar (Node.js + Patchright)                                            │
│  Chrome → CDP screencast → MSG_SCREENCAST 0x08                            │
│  BrowserState export/import on disconnect / create                        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Forwarding model

Runtime section `Forwarding`:

```json
{
  "host": "www.olx.com.br",
  "domains": ["olx.com.br", "*.olx.com.br"]
}
```

| Field | Purpose |
|-------|---------|
| `host` | FQDN only — motor opens `https://{host}{pathname}{search}` in apex mode |
| `domains` | **Navigation** allowlist for main-frame Document requests |

`domains` does **not** restrict assets, `fetch`, XHR, or sub-frame documents.

Wildcard `*.example.com` matches subdomains only (not apex `example.com`). A wildcard entry is **required** when Subdomain Mirroring is enabled.

External main-frame navigation → sidecar sends `MSG_REDIRECT 0x0A` → client `window.location.href`.

---

## 3. URL sync and subdomain mirroring

### Apex mode (default)

- Client URL bar stays on motor apex (`speculum.com/path`).
- Target redirects that change subdomain are mapped to apex + path via `MSG_URL` + `history.pushState`.
- Initial navigation: `InitialUrlBuilder` uses `https://{Forwarding.host}{clientPathAndQuery}`.

### Subdomain mirroring (opt-in)

Section `SubdomainMirroring`:

```json
{
  "enabled": true,
  "edgeTls": {
    "provider": "cloudflare",
    "email": "admin@example.com",
    "apiToken": "..."
  }
}
```

When **operational** (`enabled` + Cloudflare credentials + wildcard in `Forwarding.domains` + `Motor__PublicDomain`):

- `HostMapper` maps client ↔ target hosts (e.g. `www.speculum.com` ↔ `www.olx.com.br`).
- `MSG_URL` triggers `window.location.href` when the client host changes.
- Session cookie uses `Domain=.<motorPublicDomain>`.

When enabled but misconfigured, runtime **degrades to apex mode**; status is exposed at `GET /api/admin/config/status`.

**URL is never persisted or restored** across sessions.

Public client bootstrap: `GET /api/public/client-config` → `{ motorPublicDomain, subdomainMirroringEnabled, forwardingHost }`.

---

## 4. Configuration store

SQLite table `config_sections (key, value_json, updated_at)`.

**Infrastructure (env only):** `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `Motor__PublicDomain`, `Cors__AllowedOrigins`, `ASPNETCORE_ENVIRONMENT`.

**Motor sections (SQLite + Admin API):** `Forwarding`, `MaxSessions`, `ScriptInjection`, `SessionPolicy` (alias `SnapshotPolicy`), `SubdomainMirroring`, `JsBridge`.

**Admin section (SQLite, factory seed):** random `apiKey` on first boot (full key in dev logs; prefix only in production). Override with env `ADMIN_BOOTSTRAP_KEY` before first boot.

Boot algorithm:
1. If DB empty → seed `Admin` with random bootstrap key (or `ADMIN_BOOTSTRAP_KEY`)
2. Load all sections from DB into memory (NULL if absent)
3. No appsettings seed for motor sections

Operational requires: `Forwarding` (host + domains), `MaxSessions`. Subdomain mirroring is optional and does not block `/ready`.

Admin API: `PUT/GET/DELETE /api/admin/config/{section}` with `Authorization: Bearer {Admin.apiKey}`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

Changing `Forwarding` kills all active sessions.

---

## 5. Session lifecycle

1. React motor fetches `/api/public/client-config` and reads `speculum_client_token` cookie (or receives a new token from the hub).
2. Motor connects SignalR to `api` host `/vhub`.
3. `StartSessionAsync(clientUrl, w, h, clientToken)` resolves `client_token` → internal `session_id`, returns effective id for the hub connection.
4. Hub checks `IsOperational`, `MaxSessions`, loads Tier 4 browser state by `session_id`.
5. Sidecar: import state → Xvfb → Chrome → screencast → frames.
6. Disconnect → CDP export (cookies, localStorage, IndexedDB, history) → SQLite relational store.

There is **no HTTP session cookie** for the motor; persistence is client token + server state.

---

## 6. Binary protocol (sidecar → client)

| Type | Name | Payload |
|------|------|---------|
| 0x04 | URL update | UTF-8 URL |
| 0x05 | Console | level + message |
| 0x06 | Eval result | id + ok + value |
| 0x08 | Screencast | JPEG bytes |
| 0x09 | Status | JSON snapshot (1 s) |
| 0x0A | Redirect | UTF-8 URL (leave virtual browser) |

---

## 7. Setup mode

When not operational:
- React motor `fetch(/ready)` → redirect to `/setup`
- `/admin` — configure via UI (Bearer API key)
- `/health`, `/ready`, `/api/admin/config/status`, `/api/public/client-config`, `/vhub` negotiate — public on API host
- `StartSessionAsync` throws `HubException` until configured

Subdomain mirroring status is shown separately; it does not block base motor readiness.

---

## 8. Docker and deploy

Services: `traefik`, `sidecar`, `api` (`speculum-api`), `web` (`speculum-web`).

**Canonical deploy:** [dockup](../deploy/README.md) from `deploy/` with `--root ..`.

When subdomain mirroring is enabled in Admin, the API writes `/data/traefik/cloudflare.env` and `/data/traefik/dynamic/subdomain-wildcard.yml` on the shared volume. **Restart Traefik** after the first enable so it sources the Cloudflare token and issues the wildcard certificate.

Optional reference compose (without dockup): [deploy/compose/docker-compose.reference.yml](../deploy/compose/docker-compose.reference.yml).

Env: `TRAEFIK_MOTOR_DOMAIN`, `TRAEFIK_API_DOMAIN`, `Motor__PublicDomain`, `Cors__AllowedOrigins`, `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `Traefik__DynamicDir` (prod).
