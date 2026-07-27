# Deploy — Speculum Refactor

Dockup manifest for the refactor stack (gRPC sidecar + Api + copied web).

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
| **`dev`** | `patchright` (Chrome) | Prod-shaped stack on localhost — real browsing |
| **`smoke`** | `mock` | Fast harness / CI — no Chrome |
| **`assert`** | `patchright` + motor-fixture | Act→Assert SessionsAssertive (CI also uses compose) |

Both `dev` and `smoke` publish Traefik on host **`:8080`** and WebTransport on **`:8443`** — run only one at a time.
`assert` / compose sessions-assert uses **`:18090`** (API) so it can run beside local stacks.
Sidecar uses Docker `init: true` (reaps Chrome/Xvfb zombies). Volumes are env-scoped
(`speculum-refactor-dev-data` / `speculum-refactor-smoke-data`).

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

Open **http://localhost:8080** — SPA at `/`; Traefik routes `/vhub` and `/health`
to the api (nginx in the web image also proxies them same-origin).

`dev` keeps `ASPNETCORE_ENVIRONMENT=Production` (container has no ASP.NET
dev cert) and sets `SPECULUM_ENABLE_DEV_BACKDOOR=true` so the lab maps
`GET/PUT /api/dev/engine-config` (Hosting + Navigation via
`IConfigurationService`). Local `dotnet run` under Development maps the same
route without the flag. It also seeds `Navigation.DefaultTargetHost=www.google.com`
and an open allowlist (`AllowedMainFrameUrls[0].Domain.Scope=Any`).
`smoke` omits the backdoor flag and stays locked to `example.com`.

Stop / wipe:

```bash
cd out/dev
docker compose down        # stop
docker compose down -v     # also wipe SQLite volume
```

Sidecar health `startPeriod` is **60s** (Chrome + Xvfb warm-up). First boot can
take a minute before Traefik comes up.

Generated compose lives under `out/dev/` (gitignored). Do not hand-edit it.

## Smoke

Sidecar runs in **`SPECULUM_BROWSER=mock`** (interactive harness, no Chrome).

From `Refactor/deploy/`:

```bash
dockup validate -c dockup.json --root ..
dockup deploy --env smoke -c dockup.json --root .. --skip-push
cd out/smoke
docker compose --env-file .env up -d
```

Open **http://localhost:8080**.

Generated compose lives under `out/smoke/` (gitignored). Do not hand-edit it.

## WebTransport (frames)

WebTransport is HTTPS + HTTP/3 only and cannot pass through Traefik/nginx. Both
dockup envs publish the API data plane on **`https://localhost:8443`** (TCP+UDP)
with an ephemeral ECDSA cert. The web image is built with
`VITE_SPECULUM_TRANSPORT_ORIGIN=https://localhost:8443`; the client fetches
`/health/webtransport-cert` (via Traefik on `:8080`) and pins the cert with
`serverCertificateHashes`.

If you cleared Wire overrides in localStorage, hard-refresh so the baked transport
origin applies — or set Transport origin to `https://localhost:8443` in the Wire tab.

## Assert (SessionsAssertive)

Chrome + `tests/motor-fixture` for Act→Assert input/resize. CI uses compose on `:18090`.

```bash
docker compose -f Refactor/deploy/compose/docker-compose.sessions-assert.yml up -d --build
# wait for http://127.0.0.1:18090/health/ready + fixture health
./Refactor/deploy/compose/seed-sessions-assert.sh   # explicit Journal enable only
dotnet test Refactor/Speculum.Api.Assert.Tests --filter Category=SessionsAssertive
```

Opt-in journal (`Sessions.InputApplied` / `ResizeApplied` / `ResizeRejected`) stays off until seed or smoke Config toggles — never by env alone. See [`../Speculum.Api.Assert.Tests/MATRIX.md`](../Speculum.Api.Assert.Tests/MATRIX.md).

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
| `sidecar` | gRPC (`:50051` internal) — mock in smoke, Chrome in dev |
| `api` | Refactor Speculum.Api (`Sidecar__GrpcAddress`) |
| `web` | Copied SPA (`Refactor/web`) |

Build contexts are relative to `Refactor/` (`--root ..`).

The API image installs `libmsquic` so Kestrel can serve HTTP/3 for WebTransport
inside Linux containers.
