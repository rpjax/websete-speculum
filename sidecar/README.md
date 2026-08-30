# Speculum sidecar (Refactor) — BrowserSession over gRPC

Two ways to run this tree:

| Path | What it is | Ports | Chrome |
|------|------------|-------|--------|
| **gRPC host** (`npm start`) | Production-shaped sidecar for Api | `50051` gRPC, `3001` health | mock or sealed factory (PP / video) |
| **PageProjection lab** (`npm run lab:projection`) | Dev-only V4 engine as a `BrowserSession` caller. No gRPC, no .NET. | `4077` HTTP + WS | Patchright (one Virtual per client session) |

Live composition uses `createSealedBrowserSessionFactory`: Launch `mirrorMode=pageProjection` → `PageProjectionBrowserSession`; otherwise `VideoStreamingBrowserSession`. `LivePageProjection` is deleted. Lab detail: [browser/mirror/projection/lab/README.md](browser/mirror/projection/lab/README.md). Lab **target design**: [docs/page-projection/spec/lab-design.md](../../docs/page-projection/spec/lab-design.md). Spec index: [docs/page-projection/spec/README.md](../../docs/page-projection/spec/README.md).

## PageProjection lab (local)

Dev surface for Projected Live. The lab process **does not** launch Chromium or call CDP itself — `PageProjectionBrowserSession` owns Patchright, inject, dataplane, and probes. HTTP serves the client shell + fixtures; frames are relayed on the lab WebSocket for apply.

### Prerequisites

- Node 20+ (Docker image uses 22). From this directory: `sidecar`.
- `npm ci` (or `npm install`) once.
- Chrome/Chromium that Patchright can launch (same machine). Headless by default.

```bash
cd sidecar
npm ci
```

### Human UI (deploy the lab)

```bash
npm run lab:projection
# Windows PowerShell, visible Chrome:
# $env:SPECULUM_LAB_HEADED='1'; npm run lab:projection
# Unix:
# SPECULUM_LAB_HEADED=1 npm run lab:projection
```

That script builds `virtual.js`, the lab client, the snapshot bundle, runs `tsc`, then starts the server.

Open **http://127.0.0.1:4077/** → **Connect**.

| Control | Effect |
|---------|--------|
| **Browse → Start Virtual** | Free navigation; stays up until Stop |
| **Browse → Stop** | Stops Virtual; exports dossier |
| **Run → Start run** | Cold blueprint run; progress + verdicts; stops Virtual when done |
| **Clear surface** | Empties the projected iframe |

**Restart after code changes:** `npm run lab:restart` (kill port 4077, rebuild, start host).

**Turnstile widget parity (a readoption vs b dead nested):** with Browse live and Projected diverged, DevTools on the **lab UI tab** (not Virtual Chrome):

```javascript
document.dispatchEvent(new CustomEvent('speculum-widget-parity'))
// or: __speculumLabWidgetParity()
```

Or one-shot (lab must already be live + connected): `npm run lab:widget-parity` → `lab-runs/widget-parity-last.json`.

Bind: `SPECULUM_LAB_HOST` (default `127.0.0.1`), `SPECULUM_LAB_PORT` (default `4077`). Fixtures: `http://127.0.0.1:4077/fixtures/demo.html`.

This is **not** the gRPC sidecar. Do not point `Sidecar:GrpcAddress` at 4077.

### Agent CLI

```bash
npm run lab:run -- --blueprint soak fixtures/demo.html 15s --cpu --iso --out lab-runs
```

Prints the dossier directory (last line). Start at `report.json` (pointer) → `verdicts.json` / `manifest.json`. Exit `0` if no `fail`.

On Windows, prefer positional / bare words (`iso`, `cpu`, `headed`) — npm may swallow dashed flags.

| Flag | Meaning |
|------|---------|
| `--blueprint` / `-b` | Blueprint id (`soak`, `cssom-foundation`, `cssom-heavy`) |
| `--url` or positional | `http(s)://…` or `fixtures/<file>` |
| `--duration` or positional | `15000` / `15s` / `1m` |
| `--cpu` / `cpu` | CDP CPU probe |
| `--iso` / `iso` | Coherent snapshot iso |
| `--no-invariants` | Skip wire invariants in fold |
| `--headed` | Visible Chrome |
| `--out` | Report root (default `lab-runs/`) |

```bash
npm run lab:cssom-foundation
npm run lab:cssom-heavy
```

Sugar only — same runner. Foundation suite then runs small `cssom-scale` soak `--iso` children.

### Lab env

| Variable | Default | Meaning |
|----------|---------|---------|
| `SPECULUM_LAB_HOST` | `127.0.0.1` | HTTP/WS bind |
| `SPECULUM_LAB_PORT` | `4077` | HTTP/WS port |
| `SPECULUM_LAB_HEADED` | unset | `1` = visible Chrome |

Smoke: `npm run smoke:projection-lab`. Units: `npm run unit` (includes V4 session tests).

## Run (gRPC host)

```bash
# interactive harness (no Chrome) — ~60 fps JPEG scene + full input feedback
SPECULUM_BROWSER=mock SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start

# mock smoke (asserts a real JPEG frame)
SPECULUM_BROWSER=mock npm run smoke

# units (domain allowlist + viewport bounds)
npm run unit

# production host (Chrome + Xorg+dummy; input: set SPECULUM_INPUT_BACKEND=patchright until OS path works)
SPECULUM_BROWSER=patchright SPECULUM_INPUT_BACKEND=patchright SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start
```

### Mock harness

When `SPECULUM_BROWSER=mock`, the sidecar does **not** launch Chrome. It runs an
interactive in-process scene (`MockBrowserSession` + `HarnessScene`) that:

- Emits real JPEG frames at ~60 fps (16 ms target; quality auto-drops if encode is slow)
- Visualizes all `BrowserInput` types (mouse, wheel, keys, type/text, touch, goback/goforward)
- Emits location / editable-focus / navigation-blocked events like a real session

Use with the Api demo (`Speculum.Api/wwwroot`) for daily stream + input feel testing.

## Docker

Build from ``:

```bash
docker build -f sidecar/Dockerfile -t speculum-sidecar-grpc .
docker run --rm -p 50051:50051 -p 3001:3001 --shm-size=2g --cap-add=SYS_ADMIN speculum-sidecar-grpc
# then: SPECULUM_SMOKE_TARGET=127.0.0.1:50051 npm run smoke:remote
```

`--shm-size=2g` is the create-time floor. Admins can remount a larger `/dev/shm`
at runtime via API `ApplyHostResources` (requires `SYS_ADMIN`, already set in
dockup). Restart returns to the floor until Apply is run again.

Compose (Api + sidecar, gRPC only — no WS):

```bash
# from 
docker compose up --build

# or from repo root
docker compose -f deploy/compose/docker-compose.refactor-grpc.yml up --build
```

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `SPECULUM_BROWSER` | _(required)_ | `mock` (interactive harness) or `patchright` |
| `SPECULUM_GRPC_PORT` | `50051` | gRPC listen port |
| `SPECULUM_HEALTH_PORT` | `3001` | `GET /health`, `GET /ready` |
| `CHROME_EXECUTABLE` | `/usr/bin/google-chrome` | Chrome binary (patchright only) |
| `SPECULUM_V4L2_DEVICE` | unset | Reserved — media ingress not implemented |
| `SPECULUM_INPUT_BACKEND` | `os` | `os` (uinput / X11 — Linux lab) or `patchright` (CDP). **Prod/test dockup force `patchright`** until OS→Chrome delivery is proven. |

## Multi-session input isolation (manual)

When running **multiple live sessions on the same sidecar** (`MaxSessions` > 1), verify OS input stays per-session:

1. Deploy with `SPECULUM_INPUT_BACKEND=os` on Linux with `/dev/uinput` (not Docker Desktop WSL2).
2. Open two sessions in parallel (two browser tabs / clients).
3. Click, type, and touch in session A — session B must not move cursor, receive keys, or see touch contacts.
4. Repeat after starting session B while A is already live (hotplug path).
5. Stop one session — the other must keep accepting input normally.

Unit coverage: `npm run unit` (`xorg input isolation flags`, `display isolation registry`).

## Input telemetry

The sidecar exposes input pressure through pull/sample telemetry, not per-input events:

- `sidecar.queues.inputDepth`: admitted input still in flight inside the sidecar
  (coalesced pending move/touch flushes + serialized inject backlog)
- `sidecar.queues.inputChainDepth`: just the serialized inject-chain backlog
- `sidecar.queues.droppedTotal`: cumulative DropOldest loss on bounded sidecar bridge queues

This is sampled by `CollectTelemetry`; it is outside the input hot path.

## Media ingress (TODO)

`pushCameraFrame` / `pushMicrophoneAudio` fail closed (`FAILED_PRECONDITION` / `media_ingress_not_implemented`).
Per-session v4l2loopback + Chrome `getUserMedia` binding is not implemented yet.

## Api surface (Refactor)

- `Sidecar:GrpcAddress` / `Sidecar__GrpcAddress` (e.g. `http://sidecar:50051`) — no WS live path.
- `ISessionConnection.GetNotificationReader()` — location, navigation blocked, editable focus, crash.
- `SetCameraPermissionHandler` / `SetMicrophonePermissionHandler` — async hooks; default deny.
