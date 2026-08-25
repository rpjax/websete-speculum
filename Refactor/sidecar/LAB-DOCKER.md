# Projection lab — Docker (canonical for OS input)

Lab + PP sessions that need **uinput ABS** run on Linux with `/dev/uinput`.
On Windows hosts, use Compose — not bare `npm run lab:projection` for input E2E.

## Run

From `Refactor/`:

```bash
docker compose -f sidecar/docker-compose.lab.yml up --build
```

Or from `Refactor/sidecar/`:

```bash
npm run lab:docker
```

Lab UI: http://127.0.0.1:4103/

## Input battery (OS)

All of these **require** `/dev/uinput`. On Windows, use the `:docker` scripts.

| Command | What |
|---------|------|
| `npm run lab:docker:spike` | D-UI-20 ABS hit-test oracle |
| `npm run smoke:input-os` | Spike + suite (compose if no local uinput) |
| `npm run lab:input-suite:docker` | All `input-*` blueprints (click/forms/scroll/iframe/stress) |
| `npm run lab:input-e2e:docker` | UI-driven capture → OS path (browse scenarios) |

Blueprints assert Virtual effect (DOM/scroll). Suite also asserts `probes/input-pipeline.json` has `backend: "os"`.

## Spike D-UI-20

```bash
npm run lab:docker:spike
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| Host port | 4103 | Published lab HTTP/WS |
| `SPECULUM_LAB_HEADED` | 1 | Chromium on Xorg dummy (required for ABS) |
| `SPECULUM_INPUT_BACKEND` | os | Fail closed without uinput |
| `SPECULUM_LAB_EXTERNAL` | — | `1` = E2E attaches to already-running lab |

Bare Windows Node lab remains usable only for DOM/CSSOM/assets experiments that do not need OS pointer inject. Input blueprints and cutover E2E **require** this Docker path.
