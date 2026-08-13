# Projection lab (dev-only)

End-to-end PageProjection without gRPC, .NET, Traefik, or the product web app.

## What it does

1. HTTP serves the **lab client** shell + fixtures + `virtual.js`.
2. Client opens `ws://…/lab/session` (one WS = one session).
3. On **Start**, the lab boots a **Patchright Chromium** (Virtual), injects real
   `buildConfigPreScript` + `virtual.js`, navigates to the target URL.
4. Virtual connects to `ws://…/lab/virtual/{sessionId}` (data plane).
5. Lab relays opaque PP frame bytes → client WS; client **decodes/applies DOM**
   into a sandboxed double-buffer surface (DOM seal — no CSSOM / SignalR).
6. Client reports `applyResult` via `{ type: 'clientTelemetry' }` → Activity feed.

No production sidecar entrypoint is involved (`index.ts` / gRPC stay untouched).

## Run

```bash
cd Refactor/sidecar
npm run lab:projection
# optional visible Chrome:
# set SPECULUM_LAB_HEADED=1

npm run smoke:projection-lab   # establish + live apply + capability gate
```

Open http://127.0.0.1:4077/ → **Connect** → **Start Virtual** (default fixture auto-mutates).

Panels: **Stream** (frames/seq/establish/apply), **Activity** (telemetry), **Config**
(telemetry toggles + `frameRateHz` — Start relaunches Virtual with inject).

Env:

| Var | Default | Meaning |
|-----|---------|---------|
| `SPECULUM_LAB_HOST` | `127.0.0.1` | Bind address |
| `SPECULUM_LAB_PORT` | `4077` | Port |
| `SPECULUM_LAB_HEADED` | unset | `1` = visible Virtual Chrome |

## Layout

```text
lab/
  index.ts           entry
  server.ts          HTTP + WS
  session.ts         1 client ↔ 1 Virtual Chrome
  virtualBrowser.ts  Patchright + inject
  client/main.ts     lab UI + apply wiring (esbuild → static/client.js)
  static/            client.html, client.js, fixtures/
../client/           decode / applyDom / registry / surface (DOM apply)
```

## Fixtures

| Path | Purpose |
|------|---------|
| `/fixtures/demo.html` | Auto-mutating smoke default |
| `/fixtures/static-dom.html` | Establish-only |
| `/fixtures/mutation-churn.html` | childList churn |
| `/fixtures/forms-state.html` | state sensors |
| `/fixtures/scroll.html` | scroll sensors |

## Telemetry

Virtual pushes on `PlaneChannel.Telemetry` (JSON). Lab session implements
`ProjectionTelemetrySink` → client WSS `{ type: 'telemetry', message }`.
Client apply reports via `{ type: 'clientTelemetry' }`.

**Default-on (cheap):** `establish*`, `frameEmitted`, `transportDeferred`, `aggregate`,
`builderStats`, `handoff`, `applyResult`, `desynced`, `applyOverrun`, `clockStalled` / `rateChanged`.

**Debug pack (lab on, product default off):** `frameDecision` (childList mode / existing vs fresh /
`appendFromEmpty`, dirty cards), `parityFingerprint` (title/h1/tags/anchors + duplicate concat),
`applyDecision` (append onto non-empty parent), `encoder` (part split).

Disabled capabilities early-return before allocation. Lab Config toggles match
`ProjectionTelemetryConfig`; Start relaunches Virtual with inject.

`handoff.lastChildListsSeeded === false` plus `frameDecision.appendFromEmptyCount > 0` plus
`parityFingerprint.duplicateH1` is the establish→live append-on-empty failure mode
(should stay at 0 after `seedChildLists` + `isSuffixAppend` empty-prev guard).
