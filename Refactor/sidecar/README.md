# Speculum sidecar (Refactor) — Patchright BrowserSession over gRPC

## Run

```bash
# interactive harness (no Chrome) — ~60 fps JPEG scene + full input feedback
SPECULUM_BROWSER=mock SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start

# mock smoke (asserts a real JPEG frame)
SPECULUM_BROWSER=mock npm run smoke

# units (domain allowlist + viewport bounds)
npm run unit

# production host (requires Chrome + Xvfb on Linux)
SPECULUM_BROWSER=patchright SPECULUM_GRPC_PORT=50051 SPECULUM_HEALTH_PORT=3001 npm start
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
docker run --rm -p 50051:50051 -p 3001:3001 --shm-size=2g speculum-sidecar-grpc
# then: SPECULUM_SMOKE_TARGET=127.0.0.1:50051 npm run smoke:remote
```

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
| `SPECULUM_GL_FALLBACK` | unset | Ops-only SwiftShader / webgl-spoof |
| `SPECULUM_V4L2_DEVICE` | unset | Reserved — media ingress not implemented |

## Media ingress (TODO)

`pushCameraFrame` / `pushMicrophoneAudio` fail closed (`FAILED_PRECONDITION` / `media_ingress_not_implemented`).
Per-session v4l2loopback + Chrome `getUserMedia` binding is not implemented yet.

## Api surface (Refactor)

- `Sidecar:GrpcAddress` / `Sidecar__GrpcAddress` (e.g. `http://sidecar:50051`) — no WS live path.
- `ISessionConnection.GetNotificationReader()` — location, navigation blocked, editable focus, crash.
- `SetCameraPermissionHandler` / `SetMicrophonePermissionHandler` — async hooks; default deny.
