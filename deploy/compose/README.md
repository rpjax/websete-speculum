# Reference Docker Compose

Optional **production-style** stack without [dockup](../README.md). Use this only when dockup is unavailable; the canonical deploy path remains `dockup deploy` from the parent `deploy/` directory.

---

## When to use

| Use dockup | Use this reference compose |
|------------|----------------------------|
| Normal dev and prod workflows | Quick experiment on a machine without Node/dockup |
| Regenerating `out/dev` and `out/prod` | Manual `docker compose` with host ports 80/443 |
| Validated manifest + env substitution | Environments where dockup CLI is not installed |

---

## Run

From this directory (`deploy/compose/`):

```bash
export TRAEFIK_MOTOR_DOMAIN=speculum.example.com
export TRAEFIK_API_DOMAIN=api.speculum.example.com
export ACME_EMAIL=admin@example.com

docker compose -f docker-compose.reference.yml up -d --build
```

Build contexts point to component folders (`Speculum.Api/`, `web/`, `sidecar/`) — paths are relative to this file.

---

## Differences from dockup dev

| Aspect | dockup `dev` | This reference file |
|--------|--------------|---------------------|
| Traefik ports | `8080` (HTTP) | `80` / `443` |
| TLS (local) | None | ACME-oriented (needs real DNS for LE) |
| CORS / VITE_API_URL | `http://*.localhost:8080` | Uses `https://${TRAEFIK_API_DOMAIN}` without port |

For plug-and-play local dev without certificate setup, use **dockup dev** (`http://speculum.localhost:8080`).

---

See [../README.md](../README.md) for the full deploy guide.
