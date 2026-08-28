# Projection lab — Docker

Canonical environment for PageProjection lab (headed Chrome on Xorg dummy).
PP input is **sparse-cdp** (CDP id-addressed click) — it does **not** require `/dev/uinput`.

`/dev/uinput` may still appear in Compose for VideoStreaming / legacy OS paths on other hosts; PP blueprints do not depend on it.

## Run

From ``:

```bash
docker compose -f sidecar/docker-compose.lab.yml up --build
```

Or from `sidecar/`:

```bash
npm run lab:docker
```

Lab UI: http://127.0.0.1:4103/

## Input blueprints (sparse-cdp)

Run a blueprint inside the lab image, e.g. click:

```bash
docker compose -f docker-compose.lab.yml run --rm lab \
  node dist/browser/mirror/projection/lab/runner/cli.js --blueprint input-click --out /app/lab-runs/input-click-smoke --headed
```

Or attach to a running lab and use `npm run lab:run` / the UI.

Blueprints assert Virtual effect (DOM/scroll). Click delivery is `resolveAndClickDomInput` → ByNodeId → sparse-cdp.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| Host port | 4103 | Published lab HTTP/WS |
| `SPECULUM_LAB_HEADED` | 1 | Chromium on Xorg dummy |
| `CHROME_EXECUTABLE` | `/usr/bin/google-chrome` | Required for PP session launch |
| `SPECULUM_INPUT_BACKEND` | os | VideoStreaming only — not used by PP sparse-cdp |

## Chrome LNA (loopback / local WS)

Display Chrome in this image loads **system-wide** managed policies from
`/etc/opt/chrome/policies/managed/` (see `sidecar/chrome-policies/managed/`).
Those policies allow Local Network Access for lab loopback origins.
