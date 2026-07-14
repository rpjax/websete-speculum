# Speculum Web

React **single-page application** for the Speculum motor, first-run setup, and administration. Built with Vite, TypeScript, Tailwind CSS v4, and **shadcn-style** Radix UI primitives. Communicates with `Speculum.Api` on the same host (REST + SignalR with MessagePack).

**Standards (mandatory for UI work):** [../docs/frontend-standards.md](../docs/frontend-standards.md) · [../docs/frontend-patterns.md](../docs/frontend-patterns.md) · Cursor rule [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc)

---

## Table of contents

- [Standards](#standards)
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

## Standards

| Document | Role |
|----------|------|
| [../docs/frontend-standards.md](../docs/frontend-standards.md) | Frontend UX constitution (shadcn-only, revealing UI, complex viz, anti-god-page) |
| [../docs/frontend-patterns.md](../docs/frontend-patterns.md) | Approved recipes and decision trees |
| [../docs/engineering-standards.md](../docs/engineering-standards.md) | Repo-wide engineering / tests / CI |
| [../docs/naming.md](../docs/naming.md) | Speculum / Motor / W7S vocabulary |

**UI kit lock:** extend `src/components/ui/` (shadcn). Do not introduce a second component library.

---

## Routes

| Path | Feature | Auth |
|------|---------|------|
| `/` | Virtual browser motor (canvas + SignalR) | — |
| `/setup` | Configuration status when API is not operational | — |
| `/admin/login` | Admin login | — |
| `/admin` | Dashboard overview | Bearer (sessionStorage) |
| `/admin/forwarding` | Forwarding section | Bearer |
| `/admin/max-sessions` | MaxSessions section | Bearer |
| `/admin/js-bridge` | JsBridge section | Bearer |
| `/admin/hosting` | Hosting profiles (TLS, mirroring) | Bearer |
| `/admin/session-policy` | SessionPolicy section | Bearer |
| `/admin/script-injection` | ScriptInjection section | Bearer |
| `/admin/scripts` | Upload / list injected scripts | Bearer |
| `/admin/sessions` | Browser sessions list | Bearer |
| `/admin/sessions/:sessionId` | Session detail drill-down | Bearer |
| `/admin/diagnostics` | Diagnostics operator UI | Bearer |
| `/admin/api-key` | Rotate admin key | Bearer |
| `/admin/openapi` | Embedded OpenAPI viewer | Bearer |

---

## Architecture

```
web (nginx in prod)
  ├─ static assets (Vite build)
  └─ SPA fallback → index.html

Browser ──► same host (relative `/api`, `/vhub`)
  ├─ fetch /ready, /api/admin/*
  └─ SignalR /vhub (MessagePack, credentials)
```

Same-origin by default (`API_URL = ''`). Traefik routes API paths on the motor host. Optional `VITE_API_URL` only for cross-origin Vite dev.

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
| `VITE_API_URL` | Optional — omit for same-origin (dockup/prod). Set for cross-origin local dev only. |

Examples:

```bash
# Same-origin (default) — leave unset in .env

# Vite dev against dotnet on :8080
VITE_API_URL=http://localhost:8080
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

```bash
npm test          # Vitest (unit)
npm run lint
npm run build
```

---

## Project structure

```
web/src/
├── features/
│   ├── motor/
│   │   ├── live/           MotorEngine facade, SignalR, screencast, input, vcon
│   │   └── mapping/        syncClientLocation (address-bar only)
│   ├── admin/              Admin pages and layout
│   └── setup/              Setup / status page
├── components/ui/          shadcn-style primitives (button, card, …)
├── lib/
│   ├── api.ts              REST helpers + ConfigSections (PascalCase)
│   ├── auth.ts             sessionStorage Bearer token
│   ├── clientConfig.ts     client_token cookie + client-config fetch
│   └── env.ts              API_URL (empty = same-origin)
├── App.tsx                 React Router routes
└── main.tsx
```

---

## Motor client

| Module | Responsibility |
|--------|----------------|
| `live/useMotorHub.ts` | React adapter for MotorEngine |
| `live/MotorEngine.ts` | Session orchestration facade |
| `live/MotorConnection.ts` | SignalR `/vhub`, streams, StartSession |
| `live/MotorScreencast.ts` | JPEG worker + canvas + FPS |
| `live/MotorInput.ts` | Pointer/keyboard + NavigateAsync |
| `live/MotorVcon.ts` | Console opcodes + `window.vcon` |
| `live/frame-decode.worker.ts` | Off-main-thread JPEG decode |
| `mapping/syncClientLocation.ts` | pushState / mirroring redirect |

Session identity: `speculum_client_token` cookie (domain depends on mirroring mode). Passed as `SessionIdentity` to `StartSessionAsync` for browser state restore. URL is never persisted.

Protocol details: [../docs/motor-reference.md](../docs/motor-reference.md).

---

## Admin panel

- API key entered on `/admin/login` → stored in `sessionStorage`
- Config section paths use exact PascalCase via `ConfigSections` in `lib/api.ts`
- All config mutations use `Authorization: Bearer <key>`
- OpenAPI page fetches `/openapi/v1.json` (same origin)
- UX must follow [../docs/frontend-standards.md](../docs/frontend-standards.md) (revealing UI, enrichment, complex-viz)

---

## Production build

```bash
npm test
npm run lint
npm run build
```

Output: `dist/` (gitignored). CI runs lint + test + build on every push/PR.

Preview locally:

```bash
npm run preview
```

---

## Docker

```bash
docker build -t speculum-web .
```

`web/Dockerfile` serves the SPA with **nginx**. CSP uses `connect-src 'self'` (same-origin API/SignalR via Traefik).

Parent docs: [../readme.md](../readme.md) · [../deploy/README.md](../deploy/README.md) · [../docs/frontend-standards.md](../docs/frontend-standards.md)
