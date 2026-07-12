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
| **Environment substitution** | `${TRAEFIK_MOTOR_DOMAIN}` and build args resolved per env |
| **Reproducible output** | `out/dev` and `out/prod` are disposable, regenerable artifacts |
| **CI-friendly** | `dockup validate` catches config errors before deploy |

Each service owns its image: `Speculum.Api/Dockerfile`, `web/Dockerfile`, `sidecar/Dockerfile`. Dockup resolves those contexts from the repo root (`--root ..`).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker Engine + Compose v2 | Linux recommended for production |
| Node.js 22+ | For global dockup CLI |
| DNS (prod) | Apex + `api.speculum.<apex>` → server IP |
| Ports | Dev: `8080`/`8443`; Prod: `80`/`443` |

Install dockup (once):

```bash
npm install -g @rodrigopjax/dockup
dockup --version   # must be >= 2.0.1
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

Open **https://speculum.localhost:8443** and accept the self-signed certificate.

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

### Required environment variables (in manifest `env` array)

| Variable | Dev example | Prod example |
|----------|-------------|--------------|
| `TRAEFIK_MOTOR_DOMAIN` | `speculum.localhost` | `seudominio.com` |
| `TRAEFIK_API_DOMAIN` | `api.speculum.localhost` | `api.speculum.seudominio.com` |
| `ACME_EMAIL` | `""` (empty — dev uses default cert) | `admin@example.com` |

### API container env (set in manifest)

| Variable | Dev | Prod |
|----------|-----|------|
| `Cors__AllowedOrigins` | `https://speculum.localhost:8443;http://localhost:5173` | `https://${TRAEFIK_MOTOR_DOMAIN}` |
| `ASPNETCORE_ENVIRONMENT` | `Development` | `Production` |

### Web build arg

| Build arg | Dev | Prod |
|-----------|-----|------|
| `VITE_API_URL` | `https://api.speculum.localhost:8443` | `https://${TRAEFIK_API_DOMAIN}` |

**Important:** Dev Traefik listens on host **8443** → HTTPS URLs must include `:8443` in CORS and `VITE_API_URL`.

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
| Traefik host ports | `8080` → 80, `8443` → 443 | `80`, `443` |
| TLS | Default/self-signed | Let's Encrypt HTTP challenge |
| Motor URL | `https://speculum.localhost:8443` | `https://<TRAEFIK_MOTOR_DOMAIN>` |
| API URL | `https://api.speculum.localhost:8443` | `https://<TRAEFIK_API_DOMAIN>` |
| Output directory | `deploy/out/dev/` | `deploy/out/prod/` |

### Services (both environments)

| ID | Image | Public |
|----|-------|--------|
| `traefik` | `traefik:v3.3` | Edge ports |
| `sidecar` | `speculum-sidecar` (build) | Internal |
| `api` | `speculum-api` (build) | Via Traefik API host |
| `web` | `speculum-web` (build) | Via Traefik motor host |

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

1. Read bootstrap admin key from API logs:
   ```bash
   docker logs <namespace>-api-1 2>&1 | grep -i bootstrap
   ```
   Or set `ADMIN_BOOTSTRAP_KEY` in the manifest before first boot.

2. Open `https://<motor-domain>/admin` and configure:
   - **Forwarding** — `host` = target site apex (not Traefik hostname)
   - **MaxSessions** — concurrent browser cap

3. Verify readiness:
   ```bash
   curl -sk https://<api-domain>/ready
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

Ensure firewall allows `80` and `443`. DNS for motor and API hosts must point to the VPS before ACME succeeds.

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
| CORS errors in browser | `Cors__AllowedOrigins` missing web origin or wrong port | Dev must include `:8443` on HTTPS origins |
| Motor cannot connect SignalR | Wrong `VITE_API_URL` baked into web image | Rebuild `web` with correct build arg |
| `ready` returns 503 | Forwarding / MaxSessions not configured | Use `/admin` or Admin API |
| ACME failure (prod) | DNS or port 80 blocked | Verify A records and firewall |
| Chrome crashes in sidecar | Low `/dev/shm` | Confirm `shm_size: 2gb` in manifest |
| `dockup validate` fails | JSON syntax or missing `--root` | Run from `deploy/` with `--root ..` |
| `docker buildx build requires 1 argument` (Windows) | Repo path with spaces + dockup 2.0.1 `shell:true` breaks `docker build` | Upgrade dockup to **>= 2.0.2**, or clone repo to a path without spaces |
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
export TRAEFIK_MOTOR_DOMAIN=speculum.example.com
export TRAEFIK_API_DOMAIN=api.speculum.example.com
export ACME_EMAIL=admin@example.com
docker compose -f docker-compose.reference.yml up -d --build
```

See [compose/README.md](compose/README.md). **Prefer dockup** for parity with documented dev/prod workflows.

---

## Related documentation

- [../readme.md](../readme.md) — project overview
- [../docs/architecture.md](../docs/architecture.md) — system design
- [speculum.dockup.example.json](speculum.dockup.example.json) — tracked template manifest
- [dockup upstream docs](https://github.com/rpjax/npm-dockup)
