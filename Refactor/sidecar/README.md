# Speculum sidecar (Refactor) — Patchright BrowserSession over gRPC

## Run

```bash
# mock (no Chrome) — local smoke
SPECULUM_BROWSER=mock npm run smoke

# units (domain allowlist + viewport bounds)
npm run unit

# production host (requires Chrome + Xvfb on Linux)
npm start
```

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
| `SPECULUM_BROWSER` | `patchright` | Set `mock` for in-memory sessions |
| `SPECULUM_GRPC_PORT` | `50051` | gRPC listen port |
| `SPECULUM_HEALTH_PORT` | `3001` | `GET /health`, `GET /ready` |
| `CHROME_EXECUTABLE` | `/usr/bin/google-chrome` | Chrome binary |
| `SPECULUM_GL_FALLBACK` | unset | Ops-only SwiftShader / webgl-spoof |
| `SPECULUM_V4L2_DEVICE` | unset | Reserved — media ingress not implemented |

## Media ingress (TODO)

`pushCameraFrame` / `pushMicrophoneAudio` fail closed (`FAILED_PRECONDITION` / `media_ingress_not_implemented`).
Per-session v4l2loopback + Chrome `getUserMedia` binding is not implemented yet.

## Api surface (Refactor)

- `Sidecar:GrpcAddress` / `Sidecar__GrpcAddress` (e.g. `http://sidecar:50051`) — no WS live path.
- `ISessionConnection.GetNotificationReader()` — location, navigation blocked, editable focus, crash.
- `SetCameraPermissionHandler` / `SetMicrophonePermissionHandler` — async hooks; default deny.
