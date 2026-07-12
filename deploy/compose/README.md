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
| Traefik ports | `8080` / `8443` | `80` / `443` |
| TLS (local) | Self-signed on `:8443` | ACME-oriented (needs real DNS for LE) |
| CORS / VITE_API_URL | Includes `:8443` for dev | Uses `https://${TRAEFIK_API_DOMAIN}` without port |

For local HTTPS on `:8443`, use **dockup dev** instead.

---

See [../README.md](../README.md) for the full deploy guide.
