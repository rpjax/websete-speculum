# Speculum Web

React **single-page application** for Speculum: Session Lab / Live (Motor surfaces), first-run **Setup**, and the **Admin** operator control plane. Built with Vite, TypeScript, Tailwind CSS v4, and **shadcn-style** Radix UI primitives. Talks to `Speculum.Api` (REST + SignalR MessagePack).

**Standards (mandatory for UI work):** [../docs/frontend-standards.md](../docs/frontend-standards.md) · [../docs/frontend-patterns.md](../docs/frontend-patterns.md) · Cursor rule [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc)

**Admin build-contract (DNA):** [../../frontend/wireframe/](../../frontend/wireframe/) — implement Admin/Setup from wireframe markdown + Refactor APIs. Do not invent routes, copy, or flows. The legacy API-key Admin UI was removed.

---

## Routes

| Path | Feature | Auth |
|------|---------|------|
| `/` | Session lab | — |
| `/lab` | Same as `/` | — |
| `/live` | Immersive canvas (no lab chrome) | — |
| `/setup` | Readiness gate | setup / public status |
| `/setup/configure` | Guided first-config wizard | bearer to apply |
| `/admin/login` | Username/password sign-in | public |
| `/admin/session-expired` | Soft landing after refresh fail | public |
| `/admin` | Operator home (ready + NBA + shortcuts) | Bearer |
| `/admin/change-password` | Change password | Bearer |
| `/admin/sessions` | Live sessions list | Bearer |
| `/admin/sessions/:sessionId` | Live session detail | Bearer |
| `/admin/profiles` | Persisted profiles list | Bearer |
| `/admin/profiles/:profileId` | Profile detail | Bearer |
| `/admin/profiles/:profileId/delete` | Delete confirm | Bearer |
| `/admin/scripts` | Scripts (library \| injections) | Bearer |
| `/admin/scripts/upload` | Upload stored `.js` (max 512 KB) | Bearer |
| `/admin/scripts/injections/new` | Injection create flow | Bearer |
| `/admin/scripts/injections/:index/edit` | Injection edit flow | Bearer |
| `/admin/scripts/injections/:index/remove` | Remove + apply | Bearer |
| `/admin/configurations` | Engine sections hub | Bearer |
| `/admin/configurations/:section` | Section editor / apply | Bearer |
| `/admin/host-resources` | Host capacity status + preview/apply | Bearer |
| `/admin/diagnostics` | Diagnostics job hub | Bearer |
| `/admin/diagnostics/health` | Observe health | Bearer |
| `/admin/diagnostics/timeline` | Investigate timeline | Bearer |
| `/admin/diagnostics/investigate` | Investigate probes | Bearer |
| `/admin/diagnostics/governance` | Govern | Bearer |

Bookmark redirect: `/admin/script-injection` → `/admin/scripts?tab=injections`.

Removed (no redirects): `/admin/api-key`, `/admin/openapi`, `/admin/forwarding`, `/admin/capacity`, `/admin/hosting`, legacy diagnostics god-tree.

---

## Architecture

```
web (nginx in prod)
  ├─ static assets (Vite build)
  └─ SPA fallback → index.html

Browser ──► same host (relative `/api`, `/vhub`)
  ├─ Admin: Bearer access + refresh (sessionStorage)
  ├─ Lab/Live: SignalR /vhub + WebTransport
  └─ Public: /api/public/client-config
```

Same-origin by default (`API_URL = ''`). Optional `VITE_API_URL` for cross-origin Vite dev.

---

## Prerequisites

- Node.js **22.x**
- Running `Speculum.Api` (and sidecar for live motor)

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Optional — omit for same-origin. |
| `VITE_MOCK` | `1` = mock fixtures (Lab/Admin may still need live API for new Admin auth). |
| `VITE_SPECULUM_HUB_ORIGIN` | Optional SignalR hub origin. |
| `VITE_SPECULUM_TRANSPORT_ORIGIN` | WebTransport origin (HTTP/3). |
| `VITE_SPECULUM_API_PROXY` | Dev proxy target for `/vhub` + `/health`. |

---

## Development

```bash
npm install
npm run dev
```

```bash
npm test
npm run lint
npm run build
```

---

## Project structure

```
src/
├── features/
│   ├── sessions/           Lab + Live motor surfaces
│   ├── admin/              DNA Admin by domain (shell, auth, home, sessions, …)
│   └── setup/              Readiness + guided first config
├── components/ui/          shadcn primitives only
├── lib/
│   ├── adminAuth.ts        Tokens in memory + sessionStorage
│   ├── adminFetch.ts       Bearer + single-flight refresh
│   └── …
├── App.tsx
└── main.tsx
```

---

## Admin panel

- **Contract:** [../../frontend/wireframe/](../../frontend/wireframe/) (`ia-map`, domain DNA, components DNA).
- **Auth:** `POST /api/auth/login` → access + refresh tokens; `adminFetch` refreshes once on 401; failure → `/admin/session-expired`.
- **Default install:** username `admin` / password `admin` until changed (`/admin/change-password`).
- Domain modules mirror wireframe folders. Helpers live under `features/admin/components/` (not a second UI kit).
- Config JSON: camelCase + camelCase string enums.

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
