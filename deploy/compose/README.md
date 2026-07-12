# Reference Docker Compose

Optional **production-style** stack without [dockup](../README.md). Use this only when dockup is unavailable; the canonical deploy path remains `dockup deploy` from the parent `deploy/` directory.

---

## When to use

| Use dockup | Use this reference compose |
|------------|----------------------------|
| Normal dev and prod workflows | Quick experiment on a machine without Node/dockup |
| Regenerating `out/dev` and `out/prod` | Visual Studio Docker Compose project (`docker-compose.dcproj`) |
| Validated manifest + env substitution | Manual `docker compose` with host ports 80/443 |

---

## Run

From this directory (`deploy/compose/`):

```bash
export TRAEFIK_MOTOR_DOMAIN=speculum.example.com
export TRAEFIK_API_DOMAIN=api.speculum.example.com
export ACME_EMAIL=admin@example.com

docker compose -f docker-compose.reference.yml up -d --build
```

Build contexts point to the repository root (`../../`) and component folders — paths are relative to this file.

---

## Differences from dockup dev

| Aspect | dockup `dev` | This reference file |
|--------|--------------|---------------------|
| Traefik ports | `8080` / `8443` | `80` / `443` |
| TLS (local) | Self-signed on `:8443` | ACME-oriented (needs real DNS for LE) |
| CORS / VITE_API_URL | Includes `:8443` for dev | Uses `https://${TRAEFIK_API_DOMAIN}` without port |

For local HTTPS on `:8443`, use **dockup dev** instead.

---

## Visual Studio

`docker-compose.dcproj` at the solution root references `docker-compose.reference.yml` for Container Tools integration. Set startup project to **docker-compose** in Visual Studio to launch the stack.

---

See [../README.md](../README.md) for the full deploy guide.
