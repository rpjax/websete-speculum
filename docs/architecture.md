# Architecture

Speculum is a **remote browser isolation** platform. A real Chromium instance runs on the server; end users interact through a low-latency JPEG screencast rendered in a React canvas. The stack is deliberately **domain-agnostic**: Traefik terminates TLS at the edge, and all motor behaviour is configured at runtime through SQLite and the Admin API.

---

## Table of contents

- [Design goals](#design-goals)
- [Logical view](#logical-view)
- [Physical deployment](#physical-deployment)
- [Request and session flows](#request-and-session-flows)
- [Configuration layers](#configuration-layers)
- [Security model](#security-model)
- [Persistence](#persistence)
- [Technology choices](#technology-choices)

---

## Design goals

| Goal | How it is achieved |
|------|-------------------|
| **Isolation** | Browsing happens in server-side Chrome; only pixels and input events cross the wire |
| **Domain flexibility** | No hard-coded target site; `Forwarding` section defines apex host and navigation allowlist |
| **Operational clarity** | `/ready` and `/api/admin/config/status` expose whether the motor can start sessions |
| **Split front/back** | React SPA on motor domain; API + SignalR on API subdomain with explicit CORS |
| **Repeatable deploy** | [dockup](../deploy/README.md) generates environment-specific compose stacks |

---

## Logical view

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  End-user browser                                                            │
│    speculum.<domain>  →  React SPA (motor, setup, admin)                    │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTPS (REST, static assets)
                                │ WSS + MessagePack (SignalR /vhub)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  api.speculum.<domain>  →  Speculum.Api (.NET 10)                           │
│    • BootstrapConfig (env)                                                   │
│    • ISpeculumConfigStore → SQLite runtime sections                          │
│    • VirtualizationHub → session orchestration                               │
│    • VSession → sidecar WebSocket relay                                      │
│    • Admin API + OpenAPI                                                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ ws://sidecar:3000 (internal Docker network)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  sidecar (Node.js + Patchright)                                              │
│    Xvfb → Chrome (non-headless) → CDP screencast → JPEG frames              │
│    Navigation guard, profile capture, script injection                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component responsibilities

| Layer | Repository path | Responsibility |
|-------|-----------------|----------------|
| **Edge** | Traefik (dockup) | TLS, HTTP→HTTPS redirect, host-based routing |
| **Web** | `web/` | Motor UI, setup wizard, admin panel |
| **API** | `Speculum.Api/` | Sessions, config store, frame relay, admin REST |
| **Sidecar** | `sidecar/` | Chrome lifecycle, input, screencast, profile merge |

---

## Physical deployment

Production and development both use **four containers** on a shared Docker network:

| Service | Image | Exposed | Traefik rule |
|---------|-------|---------|--------------|
| `traefik` | `traefik:v3.3` | Host ports | Routes by `Host()` label |
| `web` | `speculum-web` | Via Traefik | `TRAEFIK_MOTOR_DOMAIN` |
| `api` | `speculum-api` | Via Traefik | `TRAEFIK_API_DOMAIN` |
| `sidecar` | `speculum-sidecar` | Internal only | — |

**Canonical workflow:** `cd deploy && dockup deploy --env dev|prod --root ..`

See [deploy/README.md](../deploy/README.md) for ports, TLS, and VPS transfer.

### Development vs production

| Aspect | Dev (`dockup --env dev`) | Prod (`dockup --env prod`) |
|--------|--------------------------|----------------------------|
| Traefik ports | `8080` / `8443` | `80` / `443` |
| TLS | Traefik default cert (self-signed) | Let's Encrypt (`ACME_EMAIL`) |
| Motor URL | `https://speculum.localhost:8443` | `https://<TRAEFIK_MOTOR_DOMAIN>` |
| API URL | `https://api.speculum.localhost:8443` | `https://<TRAEFIK_API_DOMAIN>` |
| CORS | Dev origins + `localhost:5173` | Motor origin only |

---

## Request and session flows

### Motor startup (happy path)

```mermaid
sequenceDiagram
    participant U as User browser
    participant W as speculum-web
    participant A as Speculum.Api
    participant S as sidecar

    U->>W: Open /
    W->>A: GET /ready (API host)
    alt not operational
        W->>U: Redirect /setup
    end
    W->>A: SignalR connect /vhub
    W->>A: StartSessionAsync(url, w, h, sessionId?)
    A->>A: Check MaxSessions, load snapshot
    A->>S: WebSocket create session
    S->>S: Launch Chrome on Xvfb
    S-->>A: JPEG frames (0x08)
    A-->>W: Relay frames via SignalR
    W-->>U: Draw on canvas
```

### Session identity

- The motor stores `sessionId` in `localStorage` under `speculum_session_id`.
- `StartSessionAsync` accepts an optional client id and **returns** the effective id (server may normalize).
- On disconnect, Chrome profile data is snapshotted and merged into SQLite (`browser_snapshots`).
- There is **no HTTP session cookie**; persistence is client id + server BLOB.

### Navigation guard

Runtime `Forwarding.domains` controls **main-frame document** navigation only. Assets, `fetch`, XHR, and sub-frames are not restricted by this list. External main-frame navigation triggers `MSG_REDIRECT (0x0A)` and the client performs `window.location.href` to leave the virtual browser.

Details: [motor-reference.md](motor-reference.md#2-forwarding-model).

---

## Configuration layers

### Layer 1 — Infrastructure (environment)

Required for API boot. Never stored in SQLite.

| Variable | Example | Purpose |
|----------|---------|---------|
| `HttpAddress` | `0.0.0.0:8080` | Kestrel bind |
| `Database__Path` | `/data/speculum.db` | SQLite file |
| `Sidecar__BaseUrl` | `ws://sidecar:3000` | Sidecar WebSocket |
| `Cors__AllowedOrigins` | `https://speculum.localhost:8443;...` | Semicolon-separated SPA origins |
| `ASPNETCORE_ENVIRONMENT` | `Development` / `Production` | ASP.NET environment |
| `ADMIN_BOOTSTRAP_KEY` | (optional) | Override first-boot admin API key |

### Layer 2 — Motor runtime (SQLite + Admin API)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | `host` (apex FQDN) + `domains` (navigation allowlist) |
| `MaxSessions` | Yes | Concurrent session cap |
| `ScriptInjection` | No | Injected script ids or URLs |
| `SnapshotPolicy` | No | e.g. `{ "ttlDays": 30 }` |
| `JsBridge` | No | `{ "enable": true \| false }` |

`Forwarding.host` is the site the motor opens (`https://{host}{path}`). It is independent of Traefik motor/API hostnames.

### Layer 3 — Admin credentials (SQLite, seeded once)

On first boot, `Admin.apiKey` is generated randomly (or taken from `ADMIN_BOOTSTRAP_KEY`). The key appears in container logs in Development; Production logs only a prefix. Admin UI stores the key in `sessionStorage` as a Bearer token.

---

## Security model

| Surface | Auth | Notes |
|---------|------|-------|
| `/health`, `/ready` | Public | Liveness / readiness |
| `GET /api/admin/config/status` | Public | Setup UI needs this |
| `/vhub` (SignalR) | Public | Edge protection expected from Traefik / network policy |
| `/api/admin/*`, `/openapi/*` | Bearer `Admin.apiKey` | Enforced by `AdminAuthMiddleware` |
| Script URL resolution | SSRF guard | `SsrfGuard` + custom DNS resolver for remote script fetches |

**Defence in depth:** restrict API host exposure in production (firewall, internal network, or Traefik middleware) if `/vhub` public access is not desired.

---

## Persistence

| Store | Location | Contents |
|-------|----------|----------|
| SQLite | `Database__Path` | `config_sections`, `browser_snapshots`, injected scripts metadata |
| Docker volume | `speculum-data` | SQLite file in deployed stacks |
| Client | `localStorage` | `speculum_session_id` |
| Client | `sessionStorage` | Admin Bearer token |

Changing `Forwarding` terminates all active sessions.

---

## Technology choices

| Area | Choice | Rationale |
|------|--------|-----------|
| API | .NET 10, SignalR + MessagePack | Strong typing, efficient binary hub protocol |
| Web | React 19, Vite, Tailwind | Modern SPA; canvas motor with Web Worker JPEG decode |
| Sidecar | Patchright (Chromium), Xvfb | Real browser fingerprint; non-headless screencast |
| Config | SQLite | Single-file ops model; no separate config service |
| Deploy | dockup v2 | Declarative multi-env compose generation |

---

## Related documents

- [Motor reference](motor-reference.md) — protocol bytes, config store algorithm, setup mode
- [Deploy guide](../deploy/README.md) — dockup commands, VPS workflow
- [API README](../Speculum.Api/README.md) — project layout and local run
- [Web README](../web/README.md) — routes and environment variables
- [Sidecar README](../sidecar/README.md) — Chrome sidecar internals
