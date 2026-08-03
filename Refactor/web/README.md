# Speculum Web

React **single-page application** for Speculum: Session Lab / Live (Motor surfaces), first-run **Setup**, and the **Admin** operator control plane. Built with Vite, TypeScript, Tailwind CSS v4, and **shadcn-style** Radix UI primitives. Talks to `Speculum.Api` (REST + SignalR MessagePack).

**Standards (mandatory for UI work):** [../docs/frontend-standards.md](../docs/frontend-standards.md) · [../docs/frontend-patterns.md](../docs/frontend-patterns.md) · Cursor rule [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc)

**Admin build-contract (DNA):** [../../frontend/wireframe/](../../frontend/wireframe/) — implement Admin/Setup from wireframe markdown + Refactor APIs. Do not invent routes, copy, or flows. The legacy API-key Admin UI was removed.

---

## Routes

Control plane is under **`/w7s/*`**. Any other path is **Live** (path → StartSession).

| Path | Feature | Auth |
|------|---------|------|
| `*` (not `/w7s…`) | Immersive Live — browser path is the virtual start URL | — |
| `/w7s/lab` | Session lab (debug / wire) | — |
| `/w7s/setup` | Readiness gate | setup / public status |
| `/w7s/setup/configure` | Guided first-config wizard | bearer to apply |
| `/w7s/admin/login` | Username/password sign-in | public |
| `/w7s/admin/session-expired` | Soft landing after refresh fail | public |
| `/w7s/admin` | Operator home (ready + NBA + shortcuts) | Bearer |
| `/w7s/admin/change-password` | Change password | Bearer |
| `/w7s/admin/sessions` | Live sessions list | Bearer |
| `/w7s/admin/sessions/:sessionId` | Live session detail | Bearer |
| `/w7s/admin/profiles` | Persisted profiles list | Bearer |
| `/w7s/admin/profiles/:profileId` | Profile detail | Bearer |
| `/w7s/admin/profiles/:profileId/delete` | Delete confirm | Bearer |
| `/w7s/admin/scripts` | Scripts (library \| injections) | Bearer |
| `/w7s/admin/scripts/upload` | Upload stored `.js` (max 512 KB) | Bearer |
| `/w7s/admin/scripts/injections/new` | Injection create flow | Bearer |
| `/w7s/admin/scripts/injections/:index/edit` | Injection edit flow | Bearer |
| `/w7s/admin/scripts/injections/:index/remove` | Remove + apply | Bearer |
| `/w7s/admin/configurations` | Engine sections hub | Bearer |
| `/w7s/admin/configurations/:section` | Section editor / apply | Bearer |
| `/w7s/admin/host-resources` | Host capacity status + preview/apply | Bearer |
| `/w7s/admin/diagnostics` | Diagnostics job hub | Bearer |
| `/w7s/admin/diagnostics/health` | Observe health | Bearer |
| `/w7s/admin/diagnostics/timeline` | Investigate timeline | Bearer |
| `/w7s/admin/diagnostics/investigate` | Investigate probes | Bearer |
| `/w7s/admin/diagnostics/governance` | Govern | Bearer |

HTTP: `/w7s/api/*`, `/w7s/vhub`, `/w7s/health/*`, `/w7s/vtransport`, `/w7s/assets/*`.

Bookmark redirect: `/w7s/admin/script-injection` → `/w7s/admin/scripts?tab=injections`.

Hard cut (no redirects): former `/admin`, `/lab`, `/live`, `/setup`, `/api`, `/vhub`, `/health`.

---

## Architecture

```
web (nginx in prod)
  ├─ static assets (Vite build)
  └─ SPA fallback → index.html

Browser ──► same host (relative `/w7s/api`, `/w7s/vhub`)
  ├─ Admin: Bearer access + refresh (sessionStorage)
  ├─ Lab/Live: SignalR /w7s/vhub + WebTransport /w7s/vtransport
  └─ Public: /w7s/api/public/client-config
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
