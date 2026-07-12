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
| **Domain flexibility** | No hard-coded target site; `Forwarding` section defines the remote site host and navigation allowlist |
| **Operational clarity** | `/ready` and `/api/admin/config/status` expose whether the motor can start sessions |
| **Same-origin edge** | React SPA, REST, and SignalR share one motor host; EdgeWriter routes `/api` and `/vhub` to the API container |
| **Repeatable deploy** | [dockup](../deploy/README.md) generates environment-specific compose stacks |

---

## Logical view

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  End-user browser                                                            │
│    speculum.<domain>  →  React SPA + /api + /vhub (same origin)           │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTPS (REST, static assets)
                                │ WSS + MessagePack (SignalR /vhub)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Speculum.Api (.NET 10) — Traefik routes /api, /vhub, /health, /ready       │
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
│    Navigation guard, browser state export/import, script injection           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component responsibilities

| Layer | Repository path | Responsibility |
|-------|-----------------|----------------|
| **Edge** | Traefik (dockup) | TLS, HTTP→HTTPS redirect, host-based routing |
| **Web** | `web/` | Motor UI, setup wizard, admin panel |
| **API** | `Speculum.Api/` | Sessions, config store, frame relay, admin REST |
| **Sidecar** | `sidecar/` | Chrome lifecycle, input, screencast, browser state export/import |

---

## Physical deployment

Production and development both use **four containers** on a shared Docker network:

| Service | Image | Exposed | Traefik rule |
|---------|-------|---------|--------------|
| `traefik` | `traefik:v3.6.1` | Host ports | EdgeWriter file provider + docker provider |
| `web` | `speculum-web` | Via Traefik | Apex/www + wildcard subdomains (mirroring) |
| `api` | `speculum-api` | Via Traefik | PathPrefix `/api`, `/vhub`, `/health`, … |
| `sidecar` | `speculum-sidecar` | Internal only | — |

**Canonical workflow:** `cd deploy && dockup deploy --env dev|prod --root ..`

See [deploy/README.md](../deploy/README.md) for ports, TLS, and VPS transfer.

### Development vs production

| Aspect | Dev (`dockup --env dev`) | Prod (`dockup --env prod`) |
|--------|--------------------------|----------------------------|
| Traefik ports | `8080` (HTTP) | `80` / `443` |
| TLS | None (plug-and-play) | Let's Encrypt (`ACME_EMAIL` + Hosting profiles) |
| Public URL | `http://speculum.localhost:8080` | `https://<profile-domain>` |
| CORS | Dev origins + `localhost:5173` | Known Hosting hosts (mirrored subdomains when operational) |

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
    W->>A: GET /ready (same origin)
    alt not operational
        W->>U: Redirect /setup
    end
    W->>A: SignalR connect /vhub
    W->>A: StartSessionAsync(url, w, h, SessionIdentity)
    A->>A: Check MaxSessions, resolve session_id
    A->>S: WebSocket create session (+ browser state import)
    S->>S: Launch Chrome on Xvfb
    S-->>A: JPEG frames (0x08)
    A-->>W: Relay frames via SignalR
    W-->>U: Draw on canvas
```

### Session identity and URL sync

- The motor stores a **`client_token`** in a cookie (`speculum_client_token`). The API maps it to an internal **`session_id`** (SQLite primary key).
- `StartSessionAsync(clientUrl, w, h, SessionIdentity?)` accepts `{ clientToken }` and optional indexers; returns the effective client token.
- **URL is never persisted or restored.** Initial navigation uses `MotorUrlAdapter` + `InitialUrlBuilder` (apex+NSO or subdomain mirroring per **Hosting** profile).
- On disconnect, browser state (cookies, localStorage, IndexedDB, history) is exported via CDP and stored relationally in SQLite (`browser_sessions` + child tables).
- There is **no HTTP session cookie** for the motor; persistence is client token + server state.

### Motor URL modes

| Mode | Trigger | Client URL bar | Cookie domain |
|------|---------|----------------|---------------|
| **Apex + NSO** | `Hosting.profiles[].subdomainMirroringEnabled = false` | Apex motor host + `_w7s_nso` query param (path sync only) | Host-only |
| **Subdomain mirroring** | Profile mirroring ON **and** operational | Server-mapped motor subdomains (`www.speculum.com` ↔ `www.olx.com.br`) | `.<profile.domain>` when mirroring ON |

Mirroring is **per domain profile** in SQLite section `Hosting`. When enabled but misconfigured, `/api/admin/config/status` exposes `hosting.profiles[].missing`.

In apex+NSO mode the server encodes target subdomain in `_w7s_nso`; the client uses `history.pushState` only. When mirroring is operational, subdomain changes use `window.location.href`.

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
| `Cors__AllowedOrigins` | `http://localhost:5173;...` | Dev SPA origins (semicolon-separated) |
| `Traefik__Root` | `/data/traefik` | EdgeWriter materialization root |
| `Traefik__DynamicDir` | `/data/traefik/dynamic` | Traefik file provider directory |
| `Traefik__DockerSocket` | `/var/run/docker.sock` | Optional — SIGHUP reload after edge writes |
| `ASPNETCORE_ENVIRONMENT` | `Development` / `Production` | NSO encrypt off in Development |
| `ADMIN_BOOTSTRAP_KEY` | (optional) | Override first-boot admin API key |

Motor domains, TLS, and mirroring live in SQLite **`Hosting`** (Admin UI), not in container env.

### Layer 2 — Motor runtime (SQLite + Admin API)

| Section | Required | Description |
|---------|----------|-------------|
| `Forwarding` | Yes | `host` (target site FQDN) + `domains` (navigation allowlist) |
| `MaxSessions` | Yes | Concurrent session cap |
| `ScriptInjection` | No | Injected script ids or URLs |
| `SessionPolicy` | No | e.g. `{ "ttlDays": 30 }` (alias: `SnapshotPolicy`) |
| `Hosting` | No | Per-domain TLS, mirroring, Cloudflare credentials |
| `JsBridge` | No | `{ "enable": true \| false }` |

`Forwarding.host` is the site the motor opens (`https://{host}{path}`). It is independent of motor **Hosting** profile domains (Traefik edge hostnames).

Changing `Forwarding` or `Hosting` terminates all active sessions.

### Layer 3 — Admin credentials (SQLite, seeded once)

On first boot, `Admin.apiKey` is generated randomly (or taken from `ADMIN_BOOTSTRAP_KEY`). The key appears in container logs in Development; Production logs only a prefix. Admin UI stores the key in `sessionStorage` as a Bearer token.

---

## Security model

| Surface | Auth | Notes |
|---------|------|-------|
| `/health`, `/ready` | Public | Liveness / readiness (`/ready` does not require subdomain mirroring) |
| `GET /api/admin/config/status` | Public | Setup UI; includes `hosting.profiles` (+ legacy `subdomainMirroring` aggregate) |
| `GET /api/public/client-config` | Public | Motor profiles, mirroring flags, NSO param name |
| `/vhub` (SignalR) | Public | Edge protection expected from Traefik / network policy |
| `/api/admin/*`, `/openapi/*` | Bearer `Admin.apiKey` | Enforced by `AdminAuthMiddleware` |
| Script URL resolution | SSRF guard | `SsrfGuard` + custom DNS resolver for remote script fetches |

When subdomain mirroring is operational, CORS allows motor apex/subdomains plus bootstrap `Cors__AllowedOrigins` (so Vite dev on `localhost:5173` still works).

Defence in depth: Traefik TLS and network policy are expected at the edge; the API does not authenticate `/vhub` — restrict exposure in production.

---

## Persistence

| Store | Location | Contents |
|-------|----------|----------|
| SQLite | `Database__Path` | `config_sections`, `browser_sessions` (+ cookies/LS/IDB/history tables), injected scripts metadata |
| Docker volume | `speculum-data` | SQLite file + Traefik dynamic config (`/data/traefik/`) in deployed stacks |
| Client | Cookie | `speculum_client_token` (domain depends on subdomain mirroring mode) |
| Client | `sessionStorage` | Admin Bearer token |

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
