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
| **`dev`** | `patchright` (Chrome) | Local lab — Traefik + web + API; `SPECULUM_BYPASS_API_AUTH` |
| **`prod`** | `patchright` (Chrome) | Production posture — no web lab, no auth bypass |
| **`test`** | `patchright` + motor-fixture | Act→Assert `SessionsTest` (CI also uses compose) |

`dev` and `prod` publish Traefik on host **`:8080`** and WebTransport on **`:8443`** — run only one at a time.
`test` / compose sessions-test uses **`:18090`** (API) so it can run beside local stacks.
Sidecar uses Docker `init: true` (reaps Chrome/Xvfb zombies). Volumes are env-scoped
(`speculum-refactor-dev-data` / `speculum-refactor-prod-data` / `speculum-refactor-test-data`).

First-boot mandatory config: `dev` / `test` seed Sessions + ResourceManagement +
Navigation via env so `/health/ready` can pass. `prod` seeds Sessions +
ResourceManagement only — Navigation stays empty until an operator Applies it
(pending-config / StartSession gated). Docker `depends_on` / container healthchecks
for `dev` and `prod` use `/health/live` (process up) so Traefik stays reachable
while pending config is fixed via `/api/configurations`. `test` / compose still
wait on `/health/ready`.

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

Open **http://localhost:8080** — SPA at `/`; Traefik routes `/vhub`, `/health`,
and `/api` to the api (nginx in the web image also proxies them same-origin).

`dev` keeps `ASPNETCORE_ENVIRONMENT=Production` (container has no ASP.NET
dev cert) and sets `SPECULUM_BYPASS_API_AUTH=true` so lab/harness and
configurations API work without a Bearer token. Local `dotnet run` also needs
`SPECULUM_BYPASS_API_AUTH=true` (or `SPECULUM_API_AUTH_TOKEN` +
`Authorization: Bearer …`) — Development alone does not bypass auth. First-boot
env (or lab PUT) must supply Navigation + Sessions + ResourceManagement before
StartSession / `/health/ready`. Container health for Traefik depends on
`/health/live`, not ready.

Stop / wipe:

```bash
cd out/dev
docker compose down        # stop
docker compose down -v     # also wipe SQLite volume
```

Sidecar health `startPeriod` is **60s** (Chrome + Xvfb warm-up). First boot can
take a minute before Traefik comes up.

Generated compose lives under `out/dev/` (gitignored). Do not hand-edit it.

## Prod (no web lab)

Chrome sidecar + API + Traefik (`/vhub` + `/health` + `/api`). No SPA image,
no `SPECULUM_BYPASS_API_AUTH`, no Dev backdoor.

**Auth (required):** set `SPECULUM_API_AUTH_TOKEN` in the generated compose /
`.env` before `up`. Configuration / journal / session harness APIs accept only
`Authorization: Bearer <token>` (constant-time compare). Without the env var,
those routes return `503 auth_not_configured` (fail closed).

**Pending Navigation:** prod does **not** seed `Navigation` (no
`www.example.com` / open allowlist). After first boot, `/health/ready` stays
unhealthy and StartSession is blocked until an operator Applies Navigation
(and confirms Sessions / ResourceManagement) via
`PUT /api/configurations` with the Bearer token.

**TLS:** dockup prod is production *posture* on HTTP `:8080` for local/private
networks. For internet exposure, terminate TLS at your edge (or extend Traefik
with an HTTPS entrypoint + certificates). WebTransport remains direct
`https://…:8443` with a cert pin fetched from `/health/webtransport-cert`.

```bash
dockup validate -c dockup.json --root ..
dockup deploy --env prod -c dockup.json --root .. --skip-push
cd out/prod
# Required — choose a strong secret before first up:
#   echo SPECULUM_API_AUTH_TOKEN=… >> .env
#   (or export into the api service environment in compose)
docker compose --env-file .env up -d
```

Then Apply Navigation (example):

```bash
curl -sf -X PUT http://127.0.0.1:8080/api/configurations/Navigation \
  -H "Authorization: Bearer $SPECULUM_API_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"defaultTargetHost":"www.example.com","allowedMainFrameUrls":[{"domain":{"scope":"Any","labels":[]}}]}'
```

Generated compose lives under `out/prod/` (gitignored). Do not hand-edit it.

## WebTransport (frames)

WebTransport is HTTPS + HTTP/3 only and cannot pass through Traefik/nginx. Both
dockup envs that publish a data plane use **`https://localhost:8443`** (TCP+UDP)
with an ephemeral ECDSA cert. The web image (dev) is built with
`VITE_SPECULUM_TRANSPORT_ORIGIN=https://localhost:8443`; the client fetches
`/health/webtransport-cert` (via Traefik on `:8080`) and pins the cert with
`serverCertificateHashes`.

If you cleared Wire overrides in localStorage, hard-refresh so the baked transport
origin applies — or set Transport origin to `https://localhost:8443` in the Wire tab.

## Test (SessionsTest)

Chrome + `tests/motor-fixture` for Act→Assert input/resize. CI uses compose on `:18090`.

```bash
docker compose -f Refactor/deploy/compose/docker-compose.sessions-test.yml up -d --build
# wait for http://127.0.0.1:18090/health/ready + fixture health
./Refactor/deploy/compose/seed-sessions-test.sh   # explicit Journal enable only
dotnet test Refactor/Speculum.Api.SessionsTest.Tests --filter Category=SessionsTest
```

Opt-in journal (`Telemetry.Sessions.Input.Applied` / `ResizeApplied` / `ResizeRejected`) stays off until seed
(`PUT /api/configurations/Journal`) — never by env alone. See
[`../Speculum.Api.SessionsTest.Tests/MATRIX.md`](../Speculum.Api.SessionsTest.Tests/MATRIX.md).

## Process-local (no Docker)

Fast iteration without Traefik/nginx images:

1. Sidecar (mock): `SPECULUM_BROWSER=mock SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start` in `Refactor/sidecar`.
2. Api: `ASPNETCORE_ENVIRONMENT=Development dotnet run` in `Refactor/Speculum.Api` (Kestrel serves `https://localhost:5001` with HTTP/3 for `/vtransport`).
3. Web: `npm run dev` in `Refactor/web` — Vite proxies `/vhub` + `/health` to `https://localhost:5001`. For frames, set the transport origin to `https://localhost:5001` in the **Wire** tab.

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
