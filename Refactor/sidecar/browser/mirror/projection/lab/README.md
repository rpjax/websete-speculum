# Projection lab (dev-only)

End-to-end PageProjection V4 **as a caller of `BrowserSession`**. The lab does not launch Chromium
or call `page.evaluate` / CDP itself — [`V4ProjectionBrowserSession`](../session/V4ProjectionBrowserSession.ts)
owns Patchright, inject, dataplane, and probes.

Production `PatchrightBrowserSession` / `LivePageProjection` is unchanged until M1 cutover.

## What it does

1. HTTP serves the **lab client** shell + fixtures (humans).
2. Client opens `ws://…/lab/session`.
3. On **Start**, `LabSession` creates a V4 `BrowserSession`, `launch` + `navigate`.
4. Session-owned dataplane receives frames; lab relays bytes → client WS for apply.
5. **Run** tab / **CLI** compose probes (CPU, invariants, isomorphism) and write `report.json`.

## Human UI

```bash
cd Refactor/sidecar
npm run lab:projection
# SPECULUM_LAB_HEADED=1 for visible Chrome
```

Open http://127.0.0.1:4077/ → Connect → Start Virtual. Panels: Stream, Activity, Config, **Run**.

## Agent CLI

```bash
cd Refactor/sidecar
npm run lab:run -- fixtures/demo.html 15s --cpu --iso --out lab-runs
# equivalent:
npm run lab:run -- --url fixtures/demo.html --duration 15s --cpu --iso
```

Prints the path to `lab-runs/<timestamp>-<slug>/report.json` (start diagnosis there).
Exit `0` if every requested check is `pass` or explicit `skipped`; `1` if any `fail`.
Prefer the positional form on Windows — npm may swallow dashed flags (`--url`, `--iso`). Words without dashes still work: `iso`, `cpu`, `headed`.

| Flag | Meaning |
|------|---------|
| `--url` or 1st positional | `http(s)://…` or `fixtures/<file>` |
| `--duration` or 2nd positional | `15000` / `15s` / `1m` |
| `--cpu` or `cpu` | CDP CPU probe |
| `--iso` or `iso` | coherent snapshot probe: O2 + table digest + tree at sequence S (client side skipped without UI apply surface) |
| `--no-invariants` | skip wire monitor |
| `--telemetry off` | inject default-off caps |
| `--headed` | visible Chrome |
| `--out` | report root (default `lab-runs/`) |

`scripts/profile-virtual.js`, `perf-projection-lab.js`, and `collect-validation-telemetry.js` are thin wrappers of this CLI.

Env: `SPECULUM_LAB_HOST` / `PORT` / `HEADED` as before.

## Layout

```text
lab/
  index.ts                 UI server entry
  server.ts                HTTP + client WS
  session.ts               lab caller (no Chromium)
  runCli.ts                agent port
  runTools.ts              run suite → report.json
  isomorphism.ts           halt/flush/snapshot/O2 composition
  assetRoots.ts            static/fixture paths
  cpuProfile.ts            CDP Profiler (used only inside the session)
session/
  V4ProjectionBrowserSession.ts
  projectionDataPlaneHost.ts
```

**Probes vs telemetry.** Spec: [docs/page-projection/spec/observability.md](../../../../../../docs/page-projection/spec/observability.md).
CLI `--iso` proves Virtual O2 + digest at S (after `takeRecords` + drain), not two-sided isomorphism — client table/tree are `skipped` without an apply surface. O1/O4/O5 are not implemented. Event telemetry is time-series only. `FrameInvariantMonitor` is wire-bytes only.
