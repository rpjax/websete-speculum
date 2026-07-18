# Motor reference

> Internal technical reference for session lifecycle, forwarding rules, configuration store behaviour, and the sidecar binary protocol.  
> For system-level design, see [architecture.md](architecture.md). For operations, see [../deploy/README.md](../deploy/README.md).

**Speculum (W7S)** — remote browser isolation engine.

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ User browser — speculum.<domain> (same origin)                            │
│   /           — canvas motor (SignalR client)                           │
│   /admin/*    — admin panel (REST + Bearer)                               │
│   /api, /vhub — Speculum.Api (.NET 10)                                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ internal Docker network
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Speculum.Api                                                              │
│  BootstrapConfig + dynamic CORS (Hosting profiles)                        │
│  ConfigService (ISpeculumConfigStore) — SQLite runtime config             │
│  MotorHub — StartSessionAsync(clientUrl, w, h, SessionIdentity)           │
│  BrowserSessionStore — persisted browser state (cookies, LS, IDB, history)│
│  MotorSession — live sidecar relay                                        │
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

### Apex + NSO mode (default per profile)

- Client URL bar stays on motor apex (`speculum.com/path?_w7s_nso=…`).
- Target subdomain is encoded in `_w7s_nso` (JSON `{ "v": 1, "h": "www" }`, base64; AES-GCM in Production).
- Server maps sidecar URLs via `MotorUrlAdapter`; client uses `history.pushState` only (no subdomain redirect).

### Subdomain mirroring (per Hosting profile)

Section `Hosting`:

```json
{
  "acmeEmail": "admin@example.com",
  "profiles": [{
    "domain": "speculum.com",
    "subdomainMirroringEnabled": true,
    "edgeTls": { "provider": "cloudflare", "email": "...", "apiToken": "..." }
  }]
}
```

When **operational** (mirroring ON + Cloudflare + wildcard in `Forwarding.domains`):

- `HostMapper` maps client ↔ target hosts (e.g. `www.speculum.com` ↔ `www.olx.com.br`).
- `MSG_URL` triggers `window.location.href` when the client host changes.
- Session cookie uses `Domain=.<profile.domain>`.

**URL is never persisted or restored** across sessions.

Public client bootstrap: `GET /api/public/client-config` → `{ nsoParamName, forwardingHost, mirroringEnabled, currentDomain, profiles[] }`.

---

## 4. Configuration store

SQLite table `config_sections (key, value_json, updated_at)`.

**Infrastructure (env only):** `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `Traefik__Root`, `Traefik__DynamicDir`, `Traefik__DockerSocket`, `Cors__AllowedOrigins`, `ASPNETCORE_ENVIRONMENT`.

**Motor sections (SQLite + Admin API):** `Hosting`, `Forwarding`, `MaxSessions`, `ScriptInjection`, `SessionPolicy`, `JsBridge`.

**Admin section (SQLite, factory seed):** random `apiKey` on first boot (full key in dev logs; prefix only in production). Override with env `ADMIN_BOOTSTRAP_KEY` before first boot.

Boot algorithm:
1. If DB empty → seed `Admin` with random bootstrap key (or `ADMIN_BOOTSTRAP_KEY`)
2. Load all sections from DB into memory (NULL if absent)
3. No appsettings seed for motor sections

Operational requires: `Forwarding` (host + domains), `MaxSessions`. Subdomain mirroring is optional and does not block `/ready`.

Admin API: `PUT/GET/DELETE /api/admin/config/{section}` with `Authorization: Bearer {Admin.apiKey}`. `GET Admin` returns `{ "configured": true }` (key is never echoed).

Changing `Forwarding` or `Hosting` kills all active sessions.

---

## 5. Session lifecycle

1. React motor fetches `/api/public/client-config` and reads `speculum_client_token` cookie (or receives a new token from the hub).
2. Motor connects SignalR to `/vhub` (same origin).
3. `StartSessionAsync(clientUrl, w, h, SessionIdentity?)` resolves identity → internal `session_id`, returns client token.
4. Hub checks `IsOperational`, `MaxSessions`, loads Tier 4 browser state by `session_id`.
5. Sidecar: import state → exact Xvfb → Chrome → confirm viewport → screencast → frames.
6. Runtime `ResizeAsync` awaits sidecar `resizeResult` and emits `Motor.ResizeApplied` / `Rejected` / `Failed`.
7. Disconnect → CDP export (cookies, localStorage, IndexedDB, history) → SQLite relational store.

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
- `/health`, `/ready`, `/api/admin/config/status`, `/api/public/client-config`, `/vhub` negotiate — public (same origin as the SPA)
- `StartSessionAsync` throws `HubException` until Forwarding and MaxSessions are configured

Per-profile mirroring status is in `hosting.profiles`; it does not block base motor readiness.

---

## 8. Docker and deploy

Services: `traefik`, `sidecar`, `api` (`speculum-api`), `web` (`speculum-web`).

**Canonical deploy:** [dockup](../deploy/README.md) from `deploy/` with `--root ..`.

When subdomain mirroring is enabled on a **Hosting** profile, `EdgeSynchronizer` materializes per-domain files under `/data/traefik/`:

- `cloudflare-{domain-sanitized}.env` — Cloudflare DNS API token for DNS-01
- `dynamic/wildcard-{domain-sanitized}.yml` — HTTPS + HTTP→HTTPS redirect for mirrored subdomains
- `dynamic/motor.yml` — apex/www routers and shared `speculum-acme` redirect middleware

Traefik reloads via file watch (`providers.file.watch=true`) and optional SIGHUP from the API (`Traefik__DockerSocket`).

Optional reference compose (without dockup): [deploy/compose/docker-compose.reference.yml](../deploy/compose/docker-compose.reference.yml).

Env (infra only): `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl`, `Traefik__Root`, `Traefik__DynamicDir`, `Cors__AllowedOrigins`, `ASPNETCORE_ENVIRONMENT`. Motor domains in SQLite `Hosting`.
