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
(telemetry toggles + `frameRateHz` — Start relaunches Virtual with inject), **Benchmark**
(see below).

Env:

| Var | Default | Meaning |
|-----|---------|---------|
| `SPECULUM_LAB_HOST` | `127.0.0.1` | Bind address |
| `SPECULUM_LAB_PORT` | `4077` | Port |
| `SPECULUM_LAB_HEADED` | unset | `1` = visible Virtual Chrome |

## Layout

```text
lab/
  index.ts                 entry
  server.ts                HTTP + WS
  session.ts                1 client ↔ 1 Virtual Chrome; also owns Benchmark orchestration
  virtualBrowser.ts         Patchright + inject (+ lazy cdp() accessor for CPU profiling)
  cpuProfile.ts             CDP CPU-profile capture + self-time aggregation (Virtual side only)
  frameInvariantMonitor.ts  decodes the wire frame stream, shadows topology, runs invariant checks
  virtualSnapshot.ts        loads the prebuilt DOM-snapshot bundle into the Virtual page
  structuralDiff.ts         Virtual-vs-Client TreeNode structural diff
  metricsAggregator.ts      telemetry → percentile stats (buildMs/opCount/bytes/applyMs)
  runReport.ts              report.json + .cpuprofile export → lab-runs/<ts>-<slug>/
  client/main.ts            lab UI + apply wiring (esbuild → static/client.js)
  static/                   client.html, client.js, fixtures/
../client/                  decode / applyDom / registry / surface (DOM apply) +
                             domTreeSnapshot.ts (esbuild-only: DOM-typed, excluded from tsc)
../models/                  treeNode.ts — pure TreeNode type shared by tsc-checked code
```

## Fixtures

| Path | Purpose |
|------|---------|
| `/fixtures/demo.html` | Auto-mutating smoke default |
| `/fixtures/static-dom.html` | Establish-only |
| `/fixtures/mutation-churn.html` | childList churn |
| `/fixtures/forms-state.html` | state sensors |
| `/fixtures/scroll.html` | scroll sensors |
| `/fixtures/stress-churn.html` | high-volume node churn, for CPU-profiling / scale probes |
| `/fixtures/prepend-stress.html` | `prependChild` / `resolvedBefore` worst-case ordering |

## Benchmark

The **Benchmark** tab (`static/client.html` → `lab/client/main.ts`) is the official,
UI-driven replacement for the ad-hoc `scripts/profile-*.js` runs from earlier in this project:
pick (or type) a URL, a duration, and which of the three optional steps to run, click
**Run Benchmark**, and read the rendered summary — no re-running through Cursor just to see a
number.

- **CPU profile** (Virtual/producer side only, via CDP — see `cpuProfile.ts`'s header comment
  for why the client side stays wall-clock `applyMs` instead). Self-time by function, an explicit
  our-code total (`OUR_FUNCTION_NAMES` allowlist), and a time-bucketed breakdown.
- **Invariants** (`frameInvariantMonitor.ts`) — decodes the wire frame stream itself (not the
  live browser's JS state) and checks sequence/generation monotonicity, dangling references,
  duplicate ids, topology consistency, and producer/client table-size agreement. Extensible:
  a future `CHECK`/`preTableHash` assertion is one more check function here, not a rearchitecture.
- **Structural diff** (`structuralDiff.ts` + `domTreeSnapshot.ts`) — topology-only (tags/
  attributes/text/tree shape, no pixel/visual layer yet) comparison of the Virtual page's DOM
  against the Client surface's DOM, walked in lockstep with the first N divergences reported by
  path.

Every run writes `Refactor/sidecar/lab-runs/<timestamp>-<url-slug>/report.json` (+ the raw
`.cpuprofile` alongside it, if CPU profiling was on) — `lab-runs/` is gitignored. Point Cursor at
that folder for offline diagnosis instead of re-running the benchmark just to generate more
transcript.

**CLI equivalents** (same shared modules, kept for cases the UI's `runBenchmark` — always
`transport: 'loopback'` against the lab's own data plane — can't reach: arbitrary real-site URLs
under `transport: 'discard'`, whose CSP `connect-src` blocks that loopback WebSocket):

| Script | What it measures |
|--------|-------------------|
| `scripts/profile-virtual.js <fixture\|url> [durationMs] [settleMs]` | CDP CPU profile after a settle window (skips SPA boot burst) |
| `scripts/profile-real-site-full.js <url> [totalDurationMs] [snapshotIntervalMs]` | CDP CPU profile from t=0 of navigation, with table-growth snapshots + time-bucketed breakdown |
| `scripts/perf-projection-lab.js [fixture] [durationMs] [frameRateHz]` | Spawns the lab server, drives it over its own WS protocol, reports `MetricsAggregator` percentiles |

All three write the same `report.json` shape as the UI's Benchmark tab (via `runReport.ts`).

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
