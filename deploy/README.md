# Deploy — Speculum

**Canonical deployment** for Speculum uses [@rodrigopjax/dockup](https://github.com/rpjax/npm-dockup) v2. Dockup reads a declarative JSON manifest, generates a Docker Compose stack per environment, builds images, and writes output to `deploy/out/`.

> **Do not hand-edit `deploy/out/`** — it is generated and gitignored. Change `speculum.dockup.json` (or the tracked example) and re-run dockup.

---

## Table of contents

- [Why dockup](#why-dockup)
- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Configuration reference](#configuration-reference)
- [Commands](#commands)
- [Environments](#environments)
- [Generated output layout](#generated-output-layout)
- [Post-deploy configuration](#post-deploy-configuration)
- [Production VPS workflow](#production-vps-workflow)
- [Partial deploys](#partial-deploys)
- [Troubleshooting](#troubleshooting)
- [Alternative: reference compose](#alternative-reference-compose)

---

## Why dockup

| Benefit | Description |
|---------|-------------|
| **Single manifest** | One JSON file defines dev and prod with shared container definitions |
| **Environment substitution** | `${namespace}`, `${network}`, and container env resolved per env |
| **Reproducible output** | `out/dev` and `out/prod` are disposable, regenerable artifacts |
| **CI-friendly** | `dockup validate` catches config errors before deploy |

Each service owns its image: `Speculum.Api/Dockerfile`, `web/Dockerfile`, `sidecar/Dockerfile`. Dockup resolves those contexts from the repo root (`--root ..`).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker Engine + Compose v2 | Linux recommended for production |
| Node.js 22+ | For global dockup CLI |
| DNS (prod) | Apex (+ optional `www`) → server IP; wildcard via DNS-01 when mirroring ON |
| Ports | Dev: `8080` (HTTP); Prod: `80`/`443` |

Install dockup (once):

```bash
npm install -g @rodrigopjax/dockup
dockup --version   # must be >= 2.0.2 (Windows: fixes docker build on paths with spaces)
```

---

## First-time setup

```bash
cd deploy
cp speculum.dockup.example.json speculum.dockup.json
```

Edit `speculum.dockup.json` for production domains and ACME email. The file is **gitignored** — never commit secrets or production-specific hostnames if they are sensitive.

Validate before first deploy:

```bash
dockup validate --root ..
```

Deploy local dev stack:

```bash
dockup deploy --env dev --root ..
```

Open **http://speculum.localhost:8080** — dev uses plain HTTP so no certificate trust step is required.

---

## Configuration reference

### Top-level keys (`speculum.dockup.json`)

Each environment (`dev`, `prod`) defines:

| Field | Purpose |
|-------|---------|
| `namespace` | Docker object prefix (e.g. `websete`) |
| `network` | Docker network name |
| `env` | Variables substituted into labels and container env |
| `containers` | Service definitions (Traefik, sidecar, api, web) |
| `volumes` | Named volumes (`speculum-data`, `traefik-letsencrypt` in prod) |

### Required environment variables

Containers are **domain-agnostic**. No `Motor__PublicDomain`, `VITE_API_URL`, or Traefik `Host()` labels in the manifest.

| Variable | Purpose |
|----------|---------|
| `HttpAddress`, `Database__Path`, `Sidecar__BaseUrl` | API bootstrap |
| `Traefik__Root`, `Traefik__DynamicDir`, `Traefik__DockerSocket` | EdgeSynchronizer + Traefik reload |
| `Cors__AllowedOrigins` | Dev-only SPA origins (`localhost:5173`) |
| `ADMIN_BOOTSTRAP_KEY` | Optional first-boot admin key (dev) |
| `SPECULUM_DIAGNOSTICS_PROFILE` | Optional first-boot Diagnostics seed on the API container (`Assertive` for CI / full observability; otherwise `Development` or `Production` from `ASPNETCORE_ENVIRONMENT`) |

CI motor-assertive (GitHub Actions only): compose file `deploy/compose/docker-compose.motor-assert.yml` + seed script `deploy/compose/seed-motor-assert.sh`. Not intended for laptop day-to-day use.

### Web image

Same-origin: the web image uses **relative** `/api` and `/vhub` paths. No `VITE_API_URL` build arg.

### Bootstrap (virgin VPS)

1. Deploy stack — Traefik serves HTTP catch-all via `bootstrap.yml` (any Host, including IP).
2. Open `http://<VPS-IP>/admin` — configure **Hosting** (domains, TLS email, mirroring) and **Forwarding** (target site).
3. EdgeSynchronizer materializes Traefik static/dynamic files; apex HTTPS via HTTP-01; wildcard per profile via DNS-01 when mirroring is ON.

---

## Commands

Always run from `deploy/` with `--root ..` (repository root as build context):

```bash
cd deploy

# Validate manifest and generated compose
dockup validate --root ..

# Build images + start stack
dockup deploy --env dev --root ..
dockup deploy --env prod --root ..

# Regenerate compose/files without starting (inspect out/)
dockup deploy --env dev --generate-only --root ..

# Deploy single service (e.g. API-only rollout)
dockup deploy --env prod --only api --root ..
```

---

## Environments

| | **dev** | **prod** |
|---|---------|----------|
| Traefik host ports | `8080` → 80 (HTTP only) | `80`, `443` |
| TLS | None (plug-and-play local dev) | Let's Encrypt HTTP (apex) + DNS challenge prep for optional wildcard |
| Public URL | `http://speculum.localhost:8080` (same-origin `/api`, `/vhub`) | `https://<profile-domain>` per Hosting config |
| Output directory | `deploy/out/dev/` | `deploy/out/prod/` |

### Services (both environments)

| ID | Image | Public |
|----|-------|--------|
| `traefik` | `traefik:v3.6.1` | Edge ports |
| `sidecar` | `speculum-sidecar` (build) | Internal |
| `api` | `speculum-api` (build) | Via Traefik (same host as web) |
| `web` | `speculum-web` (build) | Via Traefik (EdgeSynchronizer routes) |

---

## Generated output layout

After `dockup deploy --generate-only` or full deploy:

```
deploy/out/
├── dev/
│   ├── docker-compose.yml
│   └── .env                    # substituted variables
└── prod/
    ├── docker-compose.yml
    └── .env
```

`deploy/out/` is **gitignored**. On a VPS you typically copy `out/prod/` only.

---

## Post-deploy configuration

Infrastructure env vars are set by dockup. **Motor** configuration is still required in SQLite:

1. Sign in at `http://<motor-domain>/admin` with API key **`password`** (dev default from `ADMIN_BOOTSTRAP_KEY`). If the DB was created before this key was set, run `docker compose down -v` in `out/dev` and redeploy.

2. Open `https://<motor-domain>/admin` and configure:
   - **Hosting** — motor domain(s), ACME email, optional subdomain mirroring + Cloudflare token
   - **Forwarding** — `host` = target site apex (e.g. `www.olx.com.br`); `domains` = navigation allowlist
   - **MaxSessions** — concurrent browser cap

3. Verify readiness:
   ```bash
   curl -sk https://<motor-domain>/ready
   ```

---

## Production VPS workflow

On your workstation:

```bash
cd deploy
# Ensure speculum.dockup.json prod domains and ACME_EMAIL are correct
dockup deploy --env prod --generate-only --root ..
```

Transfer to server:

```bash
scp -r out/prod/ user@vps:/opt/speculum
```

On the VPS:

```bash
cd /opt/speculum
docker compose pull    # if using registry; otherwise images built locally
docker compose up -d
docker compose ps
```

Ensure firewall allows `80` and `443`. DNS for each Hosting profile apex must point to the VPS before ACME succeeds.

### Optional: subdomain mirroring (wildcard TLS)

Configure in Admin → **Hosting**: one profile per motor domain. Enable **Subdomain mirroring** and provide Cloudflare credentials. Add a wildcard to **Forwarding.domains** (e.g. `*.example.com`). EdgeSynchronizer materializes `cloudflare-{domain}.env` and `wildcard-{domain}.yml` under `/data/traefik/`. Restart Traefik if wildcard certs do not appear (multi-domain Cloudflare tokens may require manual cert upload — see architecture docs).

---

## Partial deploys

Roll out a single container after API or web changes:

```bash
dockup deploy --env prod --only api --root ..
dockup deploy --env prod --only web --root ..
```

Sidecar changes require rebuilding `speculum-sidecar`; active sessions should drain gracefully (API `GracefulShutdownHostedService`).

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Traefik 404 on motor paths | EdgeSynchronizer not run / empty Hosting | Configure Hosting in Admin; check `/data/traefik/dynamic/` |
| Traefik docker provider errors / all routes 404 | Docker 29+ with Traefik **< 3.6.1** | Use `traefik:v3.6.1` or newer in the manifest |
| CORS errors in browser | `Cors__AllowedOrigins` missing dev origin | Include `http://localhost:5173` and `http://speculum.localhost:8080` in dev |
| Motor cannot connect SignalR | Traefik routing or not same-origin | Same-origin stack: no `VITE_API_URL`; verify `/vhub` reaches API |
| `ready` returns 503 | Forwarding / MaxSessions not configured | Use `/admin` or Admin API |
| Mirrored subdomain 404 on `/api` or `/vhub` | Wildcard routers missing API paths | Redeploy API with current EdgeSynchronizer; check `wildcard-*.yml` includes `speculum-api-wildcard` |
| ACME failure (prod) | DNS or port 80 blocked | Verify A records and firewall |
| Chrome crashes in sidecar | Low `/dev/shm` | Confirm `shm_size: 2gb` in manifest |
| `dockup validate` fails | JSON syntax or missing `--root` | Run from `deploy/` with `--root ..` |
| `docker buildx build requires 1 argument` (Windows) | dockup **< 2.0.2** on a repo path with spaces | `npm install -g @rodrigopjax/dockup@2.0.2` |
| `npm ci` fails in sidecar build | `package-lock.json` out of sync with `package.json` | Run `npm install` in `sidecar/` and rebuild |

Logs:

```bash
cd deploy/out/dev   # or prod
docker compose logs -f api
docker compose logs -f sidecar
docker compose logs -f web
```

---

## Alternative: reference compose

If you cannot use dockup, a hand-maintained production-style compose file is available:

**[compose/docker-compose.reference.yml](compose/docker-compose.reference.yml)**

```bash
cd deploy/compose
export ACME_EMAIL=admin@example.com
docker compose -f docker-compose.reference.yml up -d --build
```

Configure **Hosting** in Admin after first boot — Traefik routes are materialized by EdgeSynchronizer, not compose env vars.

See [compose/README.md](compose/README.md). **Prefer dockup** for parity with documented dev/prod workflows.

---

## Related documentation

- [../readme.md](../readme.md) — project overview
- [../docs/architecture.md](../docs/architecture.md) — system design
- [speculum.dockup.example.json](speculum.dockup.example.json) — tracked template manifest
- [dockup upstream docs](https://github.com/rpjax/npm-dockup)
