# Speculum sidecar (Refactor) — Patchright BrowserSession over gRPC

## Run

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

Build from `Refactor/`:

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
# from Refactor/
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
| `SPECULUM_GL_FALLBACK` | unset (on) | Always-on SwiftShader + `extensions/webgl-spoof`. Set `0` to disable (lab only). |
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
