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
export ACME_EMAIL=admin@example.com

docker compose -f docker-compose.reference.yml up -d --build
```

Build contexts point to component folders (`Speculum.Api/`, `web/`, `sidecar/`) — paths are relative to this file.

After first boot, open `/admin` and configure **Hosting** (domains, TLS). EdgeWriter materializes Traefik routes; no split API subdomain env vars.

---

## Differences from dockup dev

| Aspect | dockup `dev` | This reference file |
|--------|--------------|---------------------|
| Traefik ports | `8080` (HTTP) | `80` / `443` |
| TLS (local) | None | ACME-oriented (needs real DNS for LE) |
| CORS | `Cors__AllowedOrigins` + localhost Vite | Same-origin; configure Hosting in Admin |

For plug-and-play local dev without certificate setup, use **dockup dev** (`http://speculum.localhost:8080`).

---

See [../README.md](../README.md) for the full deploy guide.
