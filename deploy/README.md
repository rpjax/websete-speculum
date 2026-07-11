# Speculum deploy

Docker build and deploy via [@rodrigopjax/dockup](https://github.com/rpjax/npm-dockup) v2.

## Install (once)

```bash
npm install -g @rodrigopjax/dockup
```

Requires dockup **>= 2.0.1** (`dockup --version`).

## Setup

```bash
cd deploy
cp speculum.dockup.example.json speculum.dockup.json
```

Edit `speculum.dockup.json` — `TRAEFIK_DOMAIN`, `ACME_EMAIL`, and `namespace` if needed.

Runtime motor config (`Forwarding`, etc.) stays in SQLite / Admin API — not in this file.

## Run

Always from `deploy/` with `--root ..` (repository root):

```bash
cd deploy
dockup validate --root ..
dockup deploy --env dev --root ..
dockup deploy --env prod --root ..
dockup deploy --env prod --only app --root ..
dockup deploy --env dev --generate-only --root ..
```

| Environment | Host (default) | TLS | Ports |
|-------------|----------------|-----|-------|
| **dev** | `speculum.websete.localhost` | Self-signed (Traefik default cert) | `8080` → HTTP, `8443` → HTTPS |
| **prod** | `speculum.websete.org` | Let's Encrypt (HTTP challenge) | `80`, `443` |

**Dev local:** open `https://speculum.websete.localhost:8443` and accept the browser warning for the self-signed certificate.

## VPS

```bash
scp -r out/prod/ user@vps:/opt/speculum
ssh user@vps
cd /opt/speculum
docker compose pull
docker compose up -d
```

Configure `Forwarding` and other runtime sections via Admin API after the stack is up.

**Bootstrap key:** on first boot the host seeds a random Admin API key. In **Development**, the full key is logged once. In **Production**, only an 8-character prefix is logged — set `ADMIN_BOOTSTRAP_KEY` in the app container env before first boot to supply your own key. Rotate via `PUT /api/admin/config/Admin`.

Full dockup documentation: [github.com/rpjax/npm-dockup](https://github.com/rpjax/npm-dockup)
