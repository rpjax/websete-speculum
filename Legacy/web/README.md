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
| `/setup` | Guided first-run wizard | — |
| `/admin/login` | Admin login | — |
| `/admin` | Dashboard overview (health + needs attention) | Bearer |
| `/admin/diagnostics` | Diagnostics overview | Bearer |
| `/admin/diagnostics/timeline` | Narrative timeline (motor story) | Bearer |
| `/admin/diagnostics/analysis` | Analysis & report (independent mandate) | Bearer |
| `/admin/diagnostics/investigate` | Browser probes | Bearer |
| `/admin/diagnostics/governance` | Diagnostics config / governance | Bearer |
| `/admin/diagnostics/telemetry` | Telemetry monitor | Bearer |
| `/admin/sessions` | Persisted sessions list | Bearer |
| `/admin/sessions/:sessionId` | Session detail (tabs) | Bearer |
| `/admin/hosting` | Hosting profiles | Bearer |
| `/admin/forwarding` | Forwarding section | Bearer |
| `/admin/capacity` | Max sessions + policy + JsBridge | Bearer |
| `/admin/scripts` | Uploaded scripts | Bearer |
| `/admin/script-injection` | Structured injection entries | Bearer |
| `/admin/api-key` | Rotate admin key | Bearer |
| `/admin/openapi` | OpenAPI (demoted / technical) | Bearer |

Legacy redirects: `/admin/max-sessions`, `/admin/js-bridge`, `/admin/session-policy` → `/admin/capacity`; `/admin/diagnostics/activity` → `/admin/diagnostics/timeline`.

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
| `VITE_MOCK` | Set to `1` to activate **mock mode** — the SPA runs with simulated API data, no backend needed. Admin and Setup work fully; Motor shows a placeholder. |

---

## Development

```bash
npm ci
npm run dev
```

Default dev server: `http://localhost:5173`.

### Mock mode (standalone frontend)

Run the SPA **without a backend** — perfect for UI-only development:

```bash
VITE_MOCK=1 npm run dev      # Linux / macOS
$env:VITE_MOCK='1'; npm run dev   # PowerShell
```

What works in mock mode:

- **Admin** — all pages, config sections, sessions, scripts, diagnostics. Data is in-memory fixtures with synthetic latency.
- **Setup** — wizard and status with simulated profiles.
- **Motor** — shows a placeholder; live browsing requires SignalR + sidecar.

Auth is bypassed (`isAuthenticated()` → `true`), so `/admin/login` auto-redirects.

Fixtures live in `src/lib/mock/fixtures/`. To adjust mock data, edit fixtures and refresh.

```bash
npm test
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
│   │   └── mapping/        syncClientLocation
│   ├── admin/              Admin pages, diagnostics sub-routes
│   └── setup/              Setup wizard
├── components/
│   ├── ui/                 shadcn primitives
│   └── admin/              facilitators (Save strip, EmptyState, Timeline, …)
├── lib/
│   ├── mock/              Mock mode fixtures + API implementations
│   ├── hooks/             Custom React hooks
│   └── …                  api, auth, diagnosticsApi, env, clientConfig
├── App.tsx
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

Protocol details: [../docs/motor-reference.md](../docs/motor-reference.md).

---

## Admin panel

- API key on `/admin/login` → `sessionStorage`
- Config section paths use PascalCase via `ConfigSections`
- Diagnostics SPA also uses `GET /api/admin/diagnostics/v1/overview` and `POST …/recover`
- UX follows frontend standards (revealing UI, enrichment, complex viz)

---

## Production build

```bash
npm test
npm run lint
npm run build
```

---

## Docker

```bash
docker build -t speculum-web .
```

Parent docs: [../readme.md](../readme.md) · [../deploy/README.md](../deploy/README.md) · [../docs/frontend-standards.md](../docs/frontend-standards.md)
