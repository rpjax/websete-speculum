# Speculum sidecar

Node.js service that runs **real Chromium** (via [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)) on a virtual framebuffer (Xvfb). The API connects over WebSocket; the sidecar manages browser lifecycle, CDP screencast, input injection, navigation guarding, and Chrome profile capture.

This container is **never exposed** to the public internet in production stacks — only `Speculum.Api` talks to it on the Docker network.

---

## Table of contents

- [Role in the stack](#role-in-the-stack)
- [Project layout](#project-layout)
- [Prerequisites](#prerequisites)
- [Run locally](#run-locally)
- [Environment](#environment)
- [WebSocket protocol](#websocket-protocol)
- [Binary messages to clients](#binary-messages-to-clients)
- [Tests](#tests)
- [Docker](#docker)
- [Operational notes](#operational-notes)

---

## Role in the stack

```
Speculum.Api  ──ws://sidecar:3000──►  sidecar
                                         ├─ DisplayManager (Xvfb displays)
                                         ├─ Session (Chrome + CDP)
                                         ├─ ScreencastCapture → JPEG
                                         └─ ProfileMerger (on shutdown)
```

Each API session maps to one sidecar `Session` with its own display number, viewport, navigation allowlist, and optional profile BLOB restore.

---

## Project layout

```
sidecar/
├── src/
│   ├── index.ts              HTTP /health + WebSocket server
│   ├── Session.ts            Chrome lifecycle, message routing
│   ├── BrowserManager.ts     Patchright launch and CDP
│   ├── ScreencastCapture.ts  JPEG frame pipeline
│   ├── Protocol.ts           JSON control messages
│   ├── ProfileMerger.ts      Chrome profile merge for snapshots
│   ├── DisplayManager.ts     Xvfb display allocation
│   └── test/                 Node built-in test runner
├── extensions/webgl-spoof/   Optional extension payload
├── Dockerfile                Production image (Chrome + Xvfb + deps)
└── package.json
```

---

## Prerequisites

- Node.js **22.x**
- Linux or Docker (Chrome + Xvfb are Linux-oriented; local Windows dev typically uses Docker for the sidecar)

---

## Run locally

```bash
cd sidecar
npm ci
npm run build
npm start
```

Health check: `curl http://localhost:3000/health` → `ok`

For interactive debugging without Docker, you need Xvfb and Chromium dependencies matching the `Dockerfile`.

---

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `SIDECAR_PORT` | `3000` | HTTP + WebSocket listen port |
| `NODE_ENV` | — | Set to `production` in composed stacks |

---

## WebSocket protocol

Control plane uses **JSON** messages (see `Protocol.ts`). Key inbound types:

| Type | Purpose |
|------|---------|
| `create` | Start session: `sessionId`, `width`, `height`, `url`, `scripts`, `allowedNavigationDomains`, optional `profileBlob` |
| `input` | Pointer/keyboard events from motor client |
| `navigate` | Programmatic navigation |
| `eval` | JavaScript evaluation in page context |
| `destroy` | Tear down session and capture profile |
| `mergeProfiles` | Merge two profile BLOBs (API-assisted snapshot merge) |

---

## Binary messages to clients

Relayed through API SignalR to the web motor (see [../docs/motor-reference.md](../docs/motor-reference.md)):

| Type | Name | Payload |
|------|------|---------|
| `0x04` | URL update | UTF-8 URL |
| `0x05` | Console | level + message |
| `0x06` | Eval result | id + ok + value |
| `0x08` | Screencast | JPEG bytes |
| `0x09` | Status | JSON snapshot (~1 s) |
| `0x0A` | Redirect | UTF-8 URL (leave virtual browser) |

---

## Tests

```bash
npm test
```

Runs `session-coherence.test.ts` after TypeScript compile — validates session state transitions without launching full Chrome where mocked.

---

## Docker

```bash
docker build -t speculum-sidecar .
```

Required capabilities in compose:

- `cap_add: [SYS_ADMIN]` — Chrome sandbox / namespace needs
- `shm_size: 2gb` — avoid Chromium shared-memory crashes

Image is referenced as `speculum-sidecar` in [dockup config](../deploy/speculum.dockup.example.json).

---

## Operational notes

- **Memory:** each session runs a full Chromium instance; size `MaxSessions` accordingly.
- **Navigation guard:** only main-frame document URLs are checked against `allowedNavigationDomains` from API config.
- **Build output:** `dist/` is gitignored; Docker and CI always compile inside the image or test pipeline.

Parent docs: [../readme.md](../readme.md) · [../docs/architecture.md](../docs/architecture.md)
