# Speculum Web

React **single-page application** for the Speculum motor, first-run setup, and administration. Built with Vite, TypeScript, Tailwind CSS v4, and Radix-based UI primitives. Communicates with `Speculum.Api` over cross-origin HTTP/HTTPS (REST + SignalR with MessagePack).

---

## Table of contents

- [Routes](#routes)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Project structure](#project-structure)
- [Motor client](#motor-client)
- [Admin panel](#admin-panel)
- [Production build](#production-build)
- [Docker](#docker)

---

## Routes

| Path | Feature | Auth |
|------|---------|------|
| `/` | Virtual browser motor (canvas + SignalR) | — |
| `/setup` | Configuration status when API is not operational | — |
| `/admin` | Login | — |
| `/admin/dashboard` | Overview | Bearer (sessionStorage) |
| `/admin/forwarding` | Forwarding section | Bearer |
| `/admin/max-sessions` | MaxSessions section | Bearer |
| `/admin/js-bridge` | JsBridge section | Bearer |
| `/admin/subdomain-mirroring` | SubdomainMirroring (opt-in) | Bearer |
| `/admin/session-policy` | SessionPolicy section | Bearer |
| `/admin/script-injection` | ScriptInjection section | Bearer |
| `/admin/scripts` | Upload / list injected scripts | Bearer |
| `/admin/sessions` | Browser sessions drill-down | Bearer |
| `/admin/api-key` | Rotate admin key | Bearer |
| `/admin/openapi` | Embedded OpenAPI viewer | Bearer |

---

## Architecture

```
web (nginx in prod)
  ├─ static assets (Vite build)
  └─ SPA fallback → index.html

Browser ──► API host (VITE_API_URL)
  ├─ fetch /ready, /api/admin/*
  └─ SignalR /vhub (MessagePack, credentials)
```

The motor and admin call the **API origin** (`VITE_API_URL`), not the motor origin. CORS on the API must list the web origin.

---

## Prerequisites

- Node.js **22.x**
- Running `Speculum.Api` (and sidecar for live motor)

---

## Environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Full origin of Speculum.Api (no trailing slash) |

Examples:

```bash
# Local dotnet run + Vite
VITE_API_URL=http://localhost:8080

# Dockup dev (Traefik HTTP on :8080)
VITE_API_URL=http://api.speculum.localhost:8080

# Production (baked into image at build time)
VITE_API_URL=https://api.speculum.yourdomain.com
```

`VITE_*` variables are embedded at **build time**. Changing them requires a rebuild (or `npm run dev` restart in development).

---

## Development

```bash
npm ci
npm run dev
```

Default dev server: `http://localhost:5173`.

Ensure API `Cors__AllowedOrigins` includes `http://localhost:5173`.

---

## Project structure

```
web/src/
├── features/
│   ├── motor/          Canvas motor, useMotorHub, frame-decode worker
│   ├── admin/          Admin pages and layout
│   └── setup/          Setup / status page
├── components/ui/      shadcn-style primitives (button, card, …)
├── lib/
│   ├── api.ts          REST helpers
│   ├── auth.ts         sessionStorage Bearer token
│   ├── session-id.ts   client_token cookie + client-config fetch
│   └── env.ts          VITE_API_URL accessor
├── App.tsx             React Router routes
└── main.tsx
```

---

## Motor client

| Module | Responsibility |
|--------|----------------|
| `useMotorHub.ts` | SignalR connection lifecycle, reconnect, hub method calls |
| `motor-engine.ts` | Canvas render, input capture, redirect handling, stream teardown |
| `frame-decode.worker.ts` | Off-main-thread JPEG decode with latest-frame coalescing |

Session identity: `speculum_client_token` cookie (domain depends on subdomain mirroring mode). Passed to `StartSessionAsync` for Tier 4 browser state restore. URL is never persisted.

Protocol details: [../docs/motor-reference.md](../docs/motor-reference.md).

---

## Admin panel

- API key entered on `/admin` login → stored in `sessionStorage`
- All config mutations use `Authorization: Bearer <key>`
- OpenAPI page fetches `/openapi/v1.json` from API host

---

## Production build

```bash
npm run lint
npm run build
```

Output: `dist/` (gitignored). CI runs lint + build on every push/PR.

Preview locally:

```bash
npm run preview
```

---

## Docker

```bash
docker build --build-arg VITE_API_URL=https://api.example.com -t speculum-web .
```

`web/Dockerfile` builds the SPA and serves it with **nginx**. CSP `connect-src` is generated from `VITE_API_URL` (scheme-aware `ws`/`wss`).

In dockup stacks, `VITE_API_URL` is set per environment in `speculum.dockup.example.json` build args.

Parent docs: [../readme.md](../readme.md) · [../deploy/README.md](../deploy/README.md)
