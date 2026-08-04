# Deploy — Speculum Refactor

Dockup manifest for the refactor stack (gRPC sidecar + Api + optional web lab).

## Prerequisites

- Docker Engine + Compose v2
- Node.js 22+
- [@rodrigopjax/dockup](https://github.com/rpjax/npm-dockup) `>= 2.0.2`

```bash
npm install -g @rodrigopjax/dockup
```

## Environments

| Env | Sidecar browser | Purpose |
|-----|-----------------|---------|
| **`dev`** | `patchright` (Chrome); input defaults to **uinput** (`os`) | Local lab — Traefik + web + API; `SPECULUM_BYPASS_API_AUTH`. WSL/no-uinput: set `SPECULUM_INPUT_BACKEND=patchright`. |
| **`prod`** | `patchright` + **`SPECULUM_INPUT_BACKEND=patchright`** | VPS production — Traefik `:80`/`:443`, web admin SPA, no auth bypass; images push to Docker Hub `websete/*`. CDP input until OS→Chrome X11 delivery is proven. |
| **`test`** | `patchright` + motor-fixture + **`SPECULUM_INPUT_BACKEND=patchright`** | Act→Assert `SessionsTest` (CI also uses compose) |

`dev` publishes Traefik on host **`:8080`**; `prod` on **`:80`/`:443`**. Both publish
WebTransport on **`:8443`** — run only one at a time.
`test` / compose sessions-test uses **`:18090`** (API) so it can run beside local stacks.
Sidecar uses Docker `init: true` (reaps Chrome/Xvfb zombies). Volumes are env-scoped
(`speculum-refactor-dev-data` / `speculum-refactor-data` / `speculum-refactor-test-data`).
Sidecar compose mounts `/dev/uinput` (OS path WIP). **`prod` / `test` force CDP input**
(`SPECULUM_INPUT_BACKEND=patchright`) so Session input Act→Assert and VPS sessions work
while Chrome under Patchright still ignores X11 CorePointer/CoreKeyboard events.
`dev` leaves the backend unset (`os`) for Linux hosts developing the uinput path.
After deploy, sidecar `/ready` is 200 when Chrome (+ uinput when backend=`os`) is present.

First-boot mandatory config: `dev` / `test` seed Sessions + ResourceManagement +
Navigation via env so `/w7s/health/ready` can pass. `prod` seeds Sessions +
ResourceManagement only — Navigation stays empty until an operator Applies it
(pending-config / StartSession gated). Docker `depends_on` / container healthchecks
for `dev` and `prod` use `/w7s/health/live` (process up) so Traefik stays reachable
while pending config is fixed via `/w7s/api/configurations`. `test` / compose still
wait on `/w7s/health/ready`. The API uses `UsePathBase("/w7s")`; Traefik routes
`/w7s/api`, `/w7s/vhub`, `/w7s/health` to the API and everything else to the SPA
(Live catch-all + `/w7s/admin` / `/w7s/lab` / `/w7s/setup`).

## Dev (localhost, real Chrome)

Same topology as a production-shaped deploy (Traefik → web/api, api → sidecar),
HTTP-only on localhost — no ACME / public domains. Sidecar launches Chrome via
Patchright (`SPECULUM_BROWSER=patchright`).

From `Refactor/deploy/`:

```bash
dockup validate -c dockup.json --root ..
dockup deploy --env dev -c dockup.json --root .. --skip-push
```

`--skip-push` builds images locally and writes compose under `out/dev/` without
pushing to Docker Hub. Then:

```bash
cd out/dev
docker compose --env-file .env up -d
```

**Docker Desktop / no `/dev/uinput`:** the sidecar device mount fails on Windows.
Use the override (CDP input, no uinput mount) instead of hand-editing `out/`:

```bash
cd out/dev
docker compose -f docker-compose.yml -f ../../compose/docker-compose.dev.nouinput.yml --env-file .env up -d
```

Open **http://localhost:8080** — Live catch-all at `/`; control plane under
`/w7s/*` (Admin `/w7s/admin`, Lab `/w7s/lab`). Traefik routes `/w7s/vhub`,
`/w7s/health`, and `/w7s/api` to the api (nginx also proxies them same-origin).

`dev` keeps `ASPNETCORE_ENVIRONMENT=Production` (container has no ASP.NET
dev cert) and sets `SPECULUM_BYPASS_API_AUTH=true` so lab/harness and
configurations API work without a Bearer token. Local `dotnet run` also needs
`SPECULUM_BYPASS_API_AUTH=true` (or login via `POST /w7s/api/auth/login` and
`Authorization: Bearer <accessToken>`) — Development alone does not bypass auth. First-boot
env (or lab PUT) must supply Navigation + Sessions + ResourceManagement before
StartSession / `/w7s/health/ready`. Container health for Traefik depends on
`/w7s/health/live`, not ready.

Stop / wipe:

```bash
cd out/dev
docker compose down        # stop
docker compose down -v     # also wipe SQLite volume
```

Sidecar health `startPeriod` is **60s** (Chrome + Xvfb warm-up). First boot can
take a minute before Traefik comes up.

Generated compose lives under `out/dev/` (gitignored). Do not hand-edit it.

## Host resources (admin uncap)

Sidecar Docker `shm_size` starts at **2gb** (Chrome IPC floor). Admins can raise
live `/dev/shm` (and optional ulimits) without redeploy via:

- UI: **Admin → Capacity → Host resources**
- API: `GET/POST /w7s/api/admin/host-resources` (+ `/preview`, `/apply`)

The API sizes from host procfs (`Telemetry.Host.ProcPath`, typically `/host/proc`)
using a RAM **budget** (`maxRamBytes` ceiling optional — use this on shared
developer machines). Sidecar only executes the precomputed remount.

**Caveats:** Docker Desktop reflects the **Linux VM** RAM, not the Windows host.
Sidecar restart resets shm to the compose floor until Apply is run again (no
automatic reapply on boot).

## Prod (VPS)

Chrome sidecar + API + Traefik + admin SPA. No `SPECULUM_BYPASS_API_AUTH`.
Images build/push to Docker Hub under namespace `websete`. The prod manifest
pull tag is **`:latest`**; CI also pushes semver tags (`:1.2.3`) on each GitHub
Release (see [Releases](#releases-and-image-publish) below). Traefik publishes
**`:80`/TCP `:443`**; WebTransport **UDP `:443`** (→ Kestrel `:8443`) plus
fallback **`:8443`** TCP+UDP.

**Auth (required):** default operator is `admin` / `admin` (seeded on first boot).
Obtain tokens via `POST /w7s/api/auth/login`, then send
`Authorization: Bearer <accessToken>` on configuration / journal / session harness
APIs. Refresh with `POST /w7s/api/auth/refresh`. Do **not** set
`SPECULUM_BYPASS_API_AUTH` in prod. Change the password after first boot
(`POST /w7s/api/auth/change-password`).

**Pending Navigation:** prod does **not** seed `Navigation` (no
`www.example.com` / open allowlist). After first boot, `/w7s/health/ready` stays
unhealthy and StartSession is blocked until an operator Applies Navigation
(and confirms Sessions / ResourceManagement) via
`PUT /w7s/api/configurations` with a Bearer access token.

**TLS:** Traefik terminates HTTPS **TCP** `:443` with Let's Encrypt (HTTP-01 via
entrypoint `web`, resolver `le`). HTTP `:80` redirects to HTTPS. Set
`PUBLIC_HOST` / `ACME_EMAIL` in `dockup.json` prod `env` (routers are
`Host(\`${PUBLIC_HOST}\`)`). WebTransport cannot pass Traefik/nginx: prod
publishes Kestrel QUIC on host **UDP `:443`** (`443:8443/udp`) so the client
uses same-origin `https://${PUBLIC_HOST}/w7s/vtransport` (mobile-friendly). Cert
pin still comes from `/w7s/health/webtransport-cert` on Traefik TCP `:443`. Host
`:8443` TCP+UDP stays published as a lab/fallback edge. When Sessions
`dataStreamTransport` is `webSocket`, the SPA uses `/w7s/vstream` (proxied like
`/w7s/vhub` via nginx/Traefik) — no UDP/H3 required for the data plane.

```bash
dockup validate -c dockup.json --root ..
dockup deploy --env prod -c dockup.json --root ..
# compose + .env under out/prod/ — deploy that compose to the VPS (Hostinger Docker Manager)
```

Local dry-run without registry push:

```bash
dockup deploy --env prod -c dockup.json --root .. --skip-push
cd out/prod
docker compose --env-file .env up -d
```

Then login and Apply Navigation (example):

```bash
TOKENS=$(curl -sf -X POST http://127.0.0.1/w7s/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}')
ACCESS=$(echo "$TOKENS" | jq -r .accessToken)
curl -sf -X PUT http://127.0.0.1/w7s/api/configurations/Navigation \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"defaultTargetHost":"www.example.com","allowedMainFrameUrls":[{"domain":{"scope":"Any","labels":[]}}]}'
```

Generated compose lives under `out/prod/` (gitignored). Do not hand-edit it.

## WebTransport (frames)

WebTransport is HTTPS + HTTP/3 only and cannot pass through Traefik/nginx.
**dev** publishes **`https://localhost:8443`** (TCP+UDP) with an ephemeral
ECDSA cert (`VITE_SPECULUM_TRANSPORT_ORIGIN=https://localhost:8443`).
**prod** maps host **UDP `:443` → Kestrel `:8443`** and builds the web image
with `VITE_SPECULUM_TRANSPORT_ORIGIN=https://${PUBLIC_HOST}` so Chromium dials
QUIC on the standard HTTPS port (works on cellular where UDP `:8443` is often
blocked). The client fetches `/w7s/health/webtransport-cert` (via Traefik TCP
`:443` → api `:8080`) and pins the cert with
`serverCertificateHashes`.

If you cleared Wire overrides in localStorage, hard-refresh so the baked transport
origin applies (dockup bakes `VITE_SPECULUM_TRANSPORT_ORIGIN=https://localhost:8443`).

## Test (SessionsTest)

Chrome + `tests/motor-fixture` for Act→Assert input/resize. CI uses compose on `:18090`.

```bash
docker compose -f Refactor/deploy/compose/docker-compose.sessions-test.yml up -d --build
# wait for http://127.0.0.1:18090/w7s/health/ready + fixture health
./Refactor/deploy/compose/seed-sessions-test.sh   # explicit Journal enable only
dotnet test Refactor/Speculum.Api.SessionsTest.Tests --filter Category=SessionsTest
```

Opt-in journal (`Telemetry.Sessions.Input.Applied` / `ResizeApplied` / `ResizeRejected`) stays off until seed
(`PUT /w7s/api/configurations/Journal`) — never by env alone. See
[`../Speculum.Api.SessionsTest.Tests/MATRIX.md`](../Speculum.Api.SessionsTest.Tests/MATRIX.md).

## Process-local (no Docker)

Fast iteration without Traefik/nginx images:

1. Sidecar (mock): `SPECULUM_BROWSER=mock SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start` in `Refactor/sidecar`.
2. Api: `ASPNETCORE_ENVIRONMENT=Development dotnet run` in `Refactor/Speculum.Api` (Kestrel serves `https://localhost:5001` with HTTP/3 for `/w7s/vtransport`).
3. Web: `npm run dev` in `Refactor/web` — Vite proxies `/w7s/vhub` + `/w7s/vstream` + `/w7s/health` + `/w7s/api` to `https://localhost:5001`. For WebTransport frames, set the transport origin to `https://localhost:5001` in the **Wire** tab; WebSocket data plane can stay same-origin via the Vite `/w7s/vstream` proxy (Sessions `dataStreamTransport`).

Trust the dev cert once with `dotnet dev-certs https --trust` so the browser accepts WebTransport.

For real Chrome without dockup, run the sidecar with `SPECULUM_BROWSER=patchright`
(and `CHROME_EXECUTABLE` on the host). Prefer **`dockup --env dev`** for prod-parity.

## Containers

| id | Role |
|----|------|
| `traefik` | HTTP entry on host `:8080` |
| `sidecar` | gRPC (`:50051` internal) — Chrome via patchright |
| `api` | Refactor Speculum.Api (`Sidecar__GrpcAddress`) |
| `web` | Lab SPA (`Refactor/web`) — **dev only** |

Build contexts are relative to `Refactor/` (`--root ..`).

The API image installs `libmsquic` so Kestrel can serve HTTP/3 for WebTransport
inside Linux containers.

## Releases and image publish

Hub images published by CI (not by local `dockup deploy` on a laptop):

| Image | Tags on each GitHub Release |
|-------|-----------------------------|
| `websete/speculum-api` | `X.Y.Z` and `latest` |
| `websete/speculum-sidecar` | `X.Y.Z` and `latest` |
| `websete/speculum-web` | `X.Y.Z` and `latest` |

Flow: Conventional Commits on `main` → Release Please **Release PR** → merge →
tag `vX.Y.Z` → workflow **Publish images** waits for **CI** green on that SHA →
`dockup deploy --env prod` with a runner-only tag patch to `X.Y.Z`, then retags
`:latest`. Traefik stays on Docker Hub `traefik:…` (`imageRef`) and is not
republished.

**VPS:** pull/redeploy remains **manual**. After a release, regenerate compose
(`dockup deploy --env prod …`, or pull `:latest` / a pinned version on the host)
and restart the stack when you choose — no Watchtower / auto-update from CI.

**Secrets (repo):** `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (`gh secret set …`).
Branch protection should require CI + PR title; prefer squash merges. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
